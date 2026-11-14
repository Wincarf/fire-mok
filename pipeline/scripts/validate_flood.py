"""Validate the May-2024 SAR water mask against Sentinel-2 NDWI (Planetary Computer).

Statistical upgrade over the 4-chip pilot:
- stratified random sampling (chips with flood water vs dry chips)
- S2 references ranked by temporal proximity to the SAR scene
- pooled F1 / IoU / Cohen's kappa per threshold + bootstrap 95% CI over chips
- nodata (SAR and optical) excluded from the valid pixel set

Output: data/reports/may2024_validation.md (regenerable).
"""

import argparse
import logging
import math
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import planetary_computer as pc
import rasterio
from pystac_client import Client
from rasterio.warp import Resampling, reproject, transform_bounds
from rasterio.windows import from_bounds

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pipeline.aoi import get_aoi
from pipeline.metrics import confusion_counts, f1, iou, summarize
from pipeline.water import water_mask

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("validate_flood")

DATA = Path(__file__).resolve().parents[2] / "data"
PC_URL = "https://planetarycomputer.microsoft.com/api/stac/v1"
CLOUD_SCL = {0, 3, 8, 9, 10, 11}  # nodata, shadow, cloud med/high, cirrus, snow
CHIP_DEG = 0.05
FLOOD_STRATUM_MIN = 0.05  # chip is "flood" stratum when >=5% of valid px are S2 water

THRESHOLDS = (-13.0, -15.0, -17.0, -19.0)
REPORT_THRESH = -17.0  # threshold shown in the per-chip table


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--chips", type=int, default=30, help="total chips (split between strata)")
    p.add_argument("--max-items", type=int, default=2, help="max S2 reference scenes")
    p.add_argument("--seed", type=int, default=7)
    p.add_argument("--report", type=Path, default=DATA / "reports" / "may2024_validation.md")
    return p.parse_args()


def sar_date_from_name(name: str) -> datetime | None:
    m = re.search(r"(\d{8})T\d{6}", name)
    if not m:
        return None
    return datetime.strptime(m.group(1), "%Y%m%d").replace(tzinfo=timezone.utc)


def find_s2_items(bbox, start, end, sar_date, max_items=2):
    """Best S2 references: closest in time to the SAR scene, overlap > 20%, cloud < 40%."""
    from shapely.geometry import box, shape

    catalog = Client.open(PC_URL)
    search = catalog.search(
        collections=["sentinel-2-l2a"],
        bbox=list(bbox),
        datetime=f"{start}/{end}",
        query={"eo:cloud_cover": {"lt": 40}},
        max_items=60,
    )
    aoi = box(*bbox)

    def overlap(i):
        return shape(i.geometry).intersection(aoi).area / aoi.area

    def days_from_sar(i):
        d = i.datetime or datetime.strptime(
            i.properties.get("datetime", "").replace("Z", "+00:00"), "%Y-%m-%dT%H:%M:%S%z"
        )
        return abs((d - sar_date).total_seconds()) / 86400.0

    ranked = sorted(
        [i for i in search.items() if overlap(i) > 0.2],
        key=lambda i: (days_from_sar(i), -overlap(i)),
    )
    return ranked[:max_items]


def read_window(asset_href, bounds_src_crs):
    signed = pc.sign(asset_href)
    with rasterio.open(signed) as src:
        win = from_bounds(*bounds_src_crs, transform=src.transform)
        arr = src.read(1, window=win, boundless=True, fill_value=0)
        transform = src.window_transform(win)
        return arr.astype("float32"), transform, src.crs


def stratum_of(s2_water_frac: float) -> str:
    """Stratify chips: flood stratum when the optical reference sees real water."""
    return "flood" if s2_water_frac >= FLOOD_STRATUM_MIN else "dry"


def collect_chips(aoi, items, sar_tif, n_chips, seed):
    """Stratified sample of evaluable chips; returns per-chip threshold rows."""
    rng = np.random.default_rng(seed)
    quotas = {"flood": math.ceil(n_chips / 2), "dry": n_chips - math.ceil(n_chips / 2)}
    rows: list[dict] = []
    per_item = max(1, math.ceil(n_chips / len(items)))
    attempts_max = n_chips * 6

    for item in items:
        ib = item.bbox
        lo = (max(aoi.bbox[0], ib[0]), max(aoi.bbox[1], ib[1]))
        hi = (min(aoi.bbox[2], ib[2]), min(aoi.bbox[3], ib[3]))
        if hi[0] - lo[0] < CHIP_DEG or hi[1] - lo[1] < CHIP_DEG:
            continue
        n_stratum = 0
        attempts = 0
        while n_stratum < per_item and attempts < attempts_max:
            attempts += 1
            min_lon = rng.uniform(lo[0], hi[0] - CHIP_DEG)
            min_lat = rng.uniform(lo[1], hi[1] - CHIP_DEG)
            chip = (min_lon, min_lat, min_lon + CHIP_DEG, min_lat + CHIP_DEG)

            b03, t3, s2_crs = read_window(
                item.assets["B03"].href, transform_bounds(4326, "EPSG:32722", *chip)
            )
            b08, _, _ = read_window(
                item.assets["B08"].href, transform_bounds(4326, "EPSG:32722", *chip)
            )
            scl, t_scl, scl_crs = read_window(
                item.assets["SCL"].href, transform_bounds(4326, "EPSG:32722", *chip)
            )
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

            water_frac = float((s2_water & valid).sum() / valid.sum())
            strat = stratum_of(water_frac)
            if quotas[strat] <= 0:
                continue

            # SAR after-water mask reprojected onto the S2 chip grid
            with rasterio.open(sar_tif) as sar:
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
            # SAR nodata can't vote either
            valid = valid & ~np.isnan(sar_db_chip)

            for thr in THRESHOLDS:
                sar_water = water_mask(sar_db_chip, thr)
                tp, fp, fn, tn = confusion_counts(s2_water, sar_water, valid)
                rows.append(
                    {
                        "item": item.id,
                        "chip": chip,
                        "stratum": strat,
                        "thr": thr,
                        "valid_px": int(valid.sum()),
                        "s2_water_px": int((s2_water & valid).sum()),
                        "sar_water_px": int((sar_water & valid).sum()),
                        "counts": (tp, fp, fn, tn),
                    }
                )
            quotas[strat] -= 1
            n_stratum += 1
            logger.info(
                "%s chip ok [%s] (%d valid px, %.1f%% water)",
                item.id[:40], strat, int(valid.sum()), 100.0 * water_frac,
            )
    return rows


def render_report(rows: list[dict], sar_tif_name: str, item_info: list[str]) -> str:
    """Markdown report from collected rows (pure — unit-testable)."""
    lines = [
        "# May-2024 flood validation\n",
        f"SAR after-scene: `{sar_tif_name}`",
        "S2 references (ranked by temporal proximity to the SAR scene):",
        *item_info,
        "Method: SAR water mask (sigma0 < threshold) vs S2 NDWI > 0.15, cloud-masked via SCL.",
        "Chips stratified: half with flood water present (>= 5% S2 water), half dry.",
        "Nodata (SAR + optical) excluded from all metrics. CI = bootstrap 95% over chips.\n",
    ]

    lines.append("| threshold | agreement | F1 [CI95] | IoU [CI95] | kappa |")
    lines.append("|---|---|---|---|---|")
    for thr in THRESHOLDS:
        thr_rows = [r for r in rows if r["thr"] == thr]
        if not thr_rows:
            continue
        s = summarize([r["counts"] for r in thr_rows])
        lines.append(
            f"| threshold {thr:+.0f} dB | agreement {100 * s['agreement']:.1f}% "
            f"| F1 {s['f1']:.3f} [{s['f1_ci95'][0]:.3f}, {s['f1_ci95'][1]:.3f}] "
            f"| IoU {s['iou']:.3f} [{s['iou_ci95'][0]:.3f}, {s['iou_ci95'][1]:.3f}] "
            f"| kappa {s['kappa']:.3f} |"
        )
    lines.append("(pooled pixel counts over all chips; F1/IoU of the water class)\n")

    rep = [r for r in rows if r["thr"] == REPORT_THRESH]
    if rep:
        s = summarize([r["counts"] for r in rep])
        lines.append(
            f"**At {REPORT_THRESH:+.0f} dB:** TP {s['tp']}, FP {s['fp']}, FN {s['fn']}, TN {s['tn']}\n"
        )
        for strat in ("flood", "dry"):
            sub = [r for r in rep if r["stratum"] == strat]
            if sub:
                ss = summarize([r["counts"] for r in sub])
                lines.append(
                    f"- `{strat}` stratum ({len(sub)} chips): agreement {100 * ss['agreement']:.1f}%"
                    f", F1 {ss['f1']:.3f} [{ss['f1_ci95'][0]:.3f}, {ss['f1_ci95'][1]:.3f}]"
                    f", IoU {ss['iou']:.3f}"
                )
        lines.append("")

    lines.append("| S2 item | chip bbox | stratum | valid px | S2 water px | SAR water px | agreement % | F1 | IoU |")
    lines.append("|---|---|---|---|---|---|---|---|---|")
    for r in rep:
        tp, fp, fn, tn = r["counts"]
        acc = 100 * (tp + tn) / max(tp + fp + fn + tn, 1)
        lines.append(
            f"| {r['item'][:45]} | ({r['chip'][0]:.3f}, {r['chip'][1]:.3f}) | {r['stratum']}"
            f" | {r['valid_px']} | {r['s2_water_px']} | {r['sar_water_px']}"
            f" | {acc:.1f} | {f1(tp, fp, fn):.3f} | {iou(tp, fp, fn):.3f} |"
        )
    lines.append(
        "\nInterpretation and known biases (temporal mismatch, turbid-water under-detection,"
        "\nurban false positives): see `docs/methodology.md` sections 4 and 6."
    )
    return "\n".join(lines) + "\n"


def main() -> int:
    args = parse_args()
    aoi = get_aoi("guaiba")
    after_tif = next((DATA / "sar").glob("*2024051*vv_db.tif"), None) or next(
        (DATA / "sar").glob("*_vv_db.tif")
    )
    logger.info("SAR after-scene: %s", after_tif.name)
    sar_date = sar_date_from_name(after_tif.name) or datetime(2024, 5, 11, tzinfo=timezone.utc)
    logger.info("SAR scene date: %s", sar_date.date())

    items = find_s2_items(aoi.bbox, "2024-05-05", "2024-05-31", sar_date, args.max_items)
    if not items:
        args.report.write_text("# Validation\n\nNo Sentinel-2 L2A scene found; validation skipped.\n")
        logger.warning("no S2 item; wrote skip report")
        return 0

    item_info = [
        f"- `{i.id}` ({(i.datetime or sar_date).date()} — "
        f"{abs(((i.datetime or sar_date) - sar_date).days)} d from SAR scene, "
        f"{i.properties.get('eo:cloud_cover', -1):.1f}% cloud)"
        for i in items
    ]
    rows = collect_chips(aoi, items, after_tif, args.chips, args.seed)
    if not rows:
        logger.warning("no evaluable chips collected")
        return 0

    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(render_report(rows, after_tif.name, item_info), encoding="utf-8")
    logger.info("report -> %s (%d chips)", args.report, len({r["chip"] for r in rows}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
