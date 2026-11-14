"""Validate the May-2024 SAR water mask against Sentinel-2 NDWI (Planetary Computer)."""

import logging
import sys
from pathlib import Path

import numpy as np
import planetary_computer as pc
import rasterio
from pystac_client import Client
from rasterio.warp import Resampling, reproject, transform_bounds
from rasterio.windows import from_bounds

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pipeline.aoi import get_aoi
from pipeline.water import water_mask

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("validate_flood")

DATA = Path(__file__).resolve().parents[2] / "data"
PC_URL = "https://planetarycomputer.microsoft.com/api/stac/v1"
CLOUD_SCL = {0, 3, 8, 9, 10, 11}  # nodata, shadow, cloud med/high, cirrus, snow
N_CHIPS = 4
CHIP_DEG = 0.05
THRESHOLDS = (-13.0, -15.0, -17.0, -19.0)


def find_s2_items(bbox, start, end, max_items=2):
    """Best S2 references: maximize AOI overlap, cloud < 40%."""
    from shapely.geometry import box, shape

    catalog = Client.open(PC_URL)
    search = catalog.search(
        collections=["sentinel-2-l2a"],
        bbox=list(bbox),
        datetime=f"{start}/{end}",
        query={"eo:cloud_cover": {"lt": 40}},
        max_items=30,
    )
    aoi = box(*bbox)
    ranked = sorted(
        search.items(),
        key=lambda i: shape(i.geometry).intersection(aoi).area / aoi.area,
        reverse=True,
    )
    return [i for i in ranked if shape(i.geometry).intersection(aoi).area / aoi.area > 0.2][
        :max_items
    ]


def read_window(asset_href, bounds_src_crs):
    signed = pc.sign(asset_href)
    with rasterio.open(signed) as src:
        win = from_bounds(*bounds_src_crs, transform=src.transform)
        arr = src.read(1, window=win, boundless=True, fill_value=0)
        transform = src.window_transform(win)
        return arr.astype("float32"), transform, src.crs


def main() -> int:
    aoi = get_aoi("guaiba")
    after_tif = next((DATA / "sar").glob("*2024051*vv_db.tif"), None) or next(
        (DATA / "sar").glob("*_vv_db.tif")
    )
    report = DATA / "reports" / "may2024_validation.md"
    logger.info("SAR after-scene: %s", after_tif.name)

    items = find_s2_items(aoi.bbox, "2024-05-05", "2024-05-31")
    if not items:
        report.write_text("# Validation\n\nNo Sentinel-2 L2A scene found; validation skipped.\n")
        logger.warning("no S2 item; wrote skip report")
        return 0

    results = []
    for item in items:
        logger.info(
            "S2 item: %s cloud=%.1f%%",
            item.id,
            item.properties.get("eo:cloud_cover", -1),
        )
        # sample chips inside AOI ∩ S2 footprint (chips outside the tile read all-nodata)
        ib = item.bbox
        lo = (max(aoi.bbox[0], ib[0]), max(aoi.bbox[1], ib[1]))
        hi = (min(aoi.bbox[2], ib[2]), min(aoi.bbox[3], ib[3]))
        if hi[0] - lo[0] < CHIP_DEG or hi[1] - lo[1] < CHIP_DEG:
            continue
        rng = np.random.default_rng(7)
        n_ok = 0
        for _ in range(N_CHIPS * 4):
            if n_ok >= N_CHIPS // len(items):
                break
            min_lon = rng.uniform(lo[0], hi[0] - CHIP_DEG)
            min_lat = rng.uniform(lo[1], hi[1] - CHIP_DEG)
            chip = (min_lon, min_lat, min_lon + CHIP_DEG, min_lat + CHIP_DEG)

            b03, t3, s2_crs = read_window(item.assets["B03"].href, transform_bounds(4326, "EPSG:32722", *chip))
            b08, _, _ = read_window(item.assets["B08"].href, transform_bounds(4326, "EPSG:32722", *chip))
            scl, t_scl, scl_crs = read_window(item.assets["SCL"].href, transform_bounds(4326, "EPSG:32722", *chip))
            if b03.size == 0 or scl.size == 0:
                continue
            # SCL is 20 m; align it to the 10 m B03 grid
            scl_al = np.zeros(b03.shape, dtype="float32")
            reproject(
                scl.astype("float32"), scl_al,
                src_transform=t_scl, src_crs=scl_crs,
                dst_transform=t3, dst_crs=s2_crs,
                resampling=Resampling.nearest, src_nodata=0, dst_nodata=0,
            )
            scl = scl_al.astype("uint8")
            if np.isin(scl, list(CLOUD_SCL)).mean() > 0.7:
                continue

            ndwi = np.where((b03 + b08) > 0, (b03 - b08) / (b03 + b08), np.nan)
            s2_water = (ndwi > 0.15) & ~np.isin(scl, list(CLOUD_SCL))
            valid = ~np.isin(scl, list(CLOUD_SCL)) & ~np.isnan(ndwi)
            if int(valid.sum()) == 0:
                continue

            # SAR after-water mask reprojected onto the S2 chip grid
            with rasterio.open(after_tif) as sar:
                sar_win = from_bounds(
                    *transform_bounds(4326, sar.crs, *chip), transform=sar.transform
                )
                sar_db = sar.read(1, window=sar_win, boundless=True, fill_value=np.nan)
                sar_transform = sar.window_transform(sar_win)
                sar_crs = sar.crs

            sar_db_chip = np.zeros(s2_water.shape, dtype="float32")
            reproject(
                sar_db, sar_db_chip,
                src_transform=sar_transform, src_crs=sar_crs,
                dst_transform=t3, dst_crs=s2_crs,
                resampling=Resampling.nearest, src_nodata=np.nan, dst_nodata=np.nan,
            )
            # threshold sweep: same chip evaluated at several sigma0 cutoffs
            for thr in THRESHOLDS:
                sar_water = sar_db_chip < thr
                agree = (s2_water == sar_water) & valid
                pct = 100.0 * agree.sum() / int(valid.sum())
                results.append((item.id, chip, thr, pct, int(s2_water.sum()), int(sar_water.sum())))
            n_ok += 1
            logger.info("%s chip done (%d valid px)", item.id[:40], int(valid.sum()))

    lines = [
        "# May-2024 flood validation\n",
        f"SAR after-scene: `{after_tif.name}`",
        "S2 references: " + ", ".join(f"`{i.id}` ({i.properties.get('eo:cloud_cover'):.1f}% cloud)" for i in items),
        "Method: SAR water mask (sigma0 < threshold) vs S2 NDWI > 0.15, cloud-masked via SCL.\n",
        "| S2 item | chip | thresh dB | agreement % | S2 water px | SAR water px |",
        "|---|---|---|---|---|---|",
    ]
    for iid, chip, thr, pct, s2w, sarw in results:
        lines.append(f"| {iid[:45]} | {chip} | {thr} | {pct:.1f} | {s2w} | {sarw} |")
    if results:
        lines.append("\n**Agreement by sigma0 threshold:**\n")
        lines.append("| thresh dB | mean agreement % |")
        lines.append("|---|---|")
        for thr in THRESHOLDS:
            m = np.mean([r[3] for r in results if r[2] == thr])
            lines.append(f"| {thr} | {m:.1f} |")
    report.write_text("\n".join(lines) + "\n", encoding="utf-8")
    logger.info("report -> %s", report)
    return 0


if __name__ == "__main__":
    sys.exit(main())
