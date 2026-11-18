"""Terrain susceptibility layer: Copernicus DEM GLO-30 -> low+flat mask + per-muni stats."""

import logging
import sys
from pathlib import Path

import numpy as np
import planetary_computer as pc
import rasterio
import rasterio.io
from pystac_client import Client
from rasterio.features import geometry_mask
from rasterio.merge import merge
from rasterio.warp import Resampling, calculate_default_transform, reproject, transform_bounds
from rasterio.windows import from_bounds
from shapely.geometry import box

from pipeline.aoi import get_aoi
from pipeline.municipalities import load_municipalities
from pipeline.raster import write_float32_cog
from pipeline.stac import PC_STAC_URL
from pipeline.terrain import hand, slope_deg, susceptibility, susceptibility_hand

logger = logging.getLogger("build_terrain")

DATA = Path(__file__).resolve().parents[2] / "data"
ELEV_THRESH_M = 50.0      # fallback rule (only if HAND fails): Guaíba plain ~0-30 m
HAND_THRESH_M = 15.0      # HAND < 15 m ~ floodplain (Rennó et al. 2008)
SLOPE_THRESH_DEG = 5.0


def fetch_dem(aoi, out: Path) -> Path:
    catalog = Client.open(PC_STAC_URL)
    search = catalog.search(collections=["cop-dem-glo-30"], bbox=list(aoi.bbox), max_items=10)
    items = list(search.items())
    if not items:
        raise RuntimeError("no Cop DEM tiles for AOI")
    arrs, transforms = [], []
    crs = None
    for it in items:
        href = pc.sign(it.assets["data"].href)
        with rasterio.open(href) as src:
            b = transform_bounds(4326, src.crs, *aoi.bbox)
            win = from_bounds(*b, transform=src.transform)
            arrs.append(src.read(1, window=win, boundless=True, fill_value=np.nan))
            transforms.append(src.window_transform(win))
            crs = src.crs
    # same grid per tile (GLO-30 is tiled); mosaic via merge on datasets is
    # simpler but windows differ — concatenate requires identical cols. Use
    # rasterio.merge with in-memory sources instead.
    srcs = []
    for arr, t in zip(arrs, transforms):
        mem = rasterio.io.MemoryFile()
        with mem.open(
            driver="GTiff", height=arr.shape[0], width=arr.shape[1], count=1,
            dtype="float32", crs=crs, transform=t,
        ) as ds:
            ds.write(arr, 1)
        srcs.append(mem.open())
    dem, transform = merge(srcs)
    dem = dem[0]
    write_float32_cog(dem, transform, crs, out)
    logger.info("DEM %s px, CRS %s -> %s", dem.shape, crs, out)
    return out


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    aoi = get_aoi("guaiba")
    ter_dir = DATA / "terrain"
    dem_path = ter_dir / "cop_dem_glo30_guaiba.tif"
    if not dem_path.exists():
        fetch_dem(aoi, dem_path)

    with rasterio.open(dem_path) as src:
        dem = src.read(1)
        transform, crs = src.transform, src.crs
    if crs.is_geographic:
        # reproject DEM to metric UTM before slope (geomaster gate: units must agree)
        dst_crs = "EPSG:32722"
        dst_transform, w, h = calculate_default_transform(crs, dst_crs, dem.shape[1], dem.shape[0], *src.bounds)
        dem_m = np.full((h, w), np.nan, dtype="float32")
        reproject(
            dem, dem_m, src_transform=transform, src_crs=crs,
            dst_transform=dst_transform, dst_crs=dst_crs,
            resampling=Resampling.bilinear, src_nodata=np.nan, dst_nodata=np.nan,
        )
        dem, transform, crs = dem_m, dst_transform, rasterio.crs.CRS.from_user_input(dst_crs)

    slope = slope_deg(dem, transform)

    # HAND-based floodplain (Rennó 2008); fallback to elev+slope on failure.
    # hand_arr is computed once here and reused for the HAND raster + the mask.
    hand_ok = False
    try:
        hand_arr = hand(dem, acc_thresh_cells=1000)
        sus = susceptibility_hand(
            dem, transform, HAND_THRESH_M, SLOPE_THRESH_DEG, hand_arr=hand_arr
        )
        hand_ok = True
        logger.info("susceptibility: HAND < %.0f m (HAND range %.1f–%.1f m)",
                    HAND_THRESH_M, np.nanmin(hand_arr), np.nanmax(hand_arr))
    except Exception as exc:
        sus = susceptibility(dem, transform, ELEV_THRESH_M, SLOPE_THRESH_DEG)
        logger.warning("HAND failed (%s) — fell back to elev<%.0f m + slope", exc, ELEV_THRESH_M)

    hand_path = ter_dir / "hand_guaiba.tif"
    if hand_ok:
        write_float32_cog(hand_arr, transform, crs, hand_path)
    else:
        logger.warning("skipping %s — HAND unavailable", hand_path)

    sus_path = ter_dir / "susceptibility_guaiba.tif"
    with rasterio.open(
        sus_path, "w", driver="COG", height=sus.shape[0], width=sus.shape[1],
        count=1, dtype="uint8", crs=crs, transform=transform, compress="deflate",
    ) as ds:
        ds.write(sus.astype("uint8"), 1)
    logger.info(
        "susceptible area: %.1f%% of valid -> %s",
        100 * sus[~np.isnan(dem)].mean(), sus_path,
    )

    muni = load_municipalities().to_crs(crs)
    aoi_box = box(*aoi.bbox)
    rows = []
    for _, m in muni[muni.to_crs(4326).intersects(aoi_box)].iterrows():
        inside = geometry_mask([m.geometry], out_shape=sus.shape, transform=transform, invert=True)
        valid = inside & ~np.isnan(dem)
        if valid.sum() == 0:
            continue
        rows.append({
            "code": m["code"], "name": m["name"], "population": int(m["population"]),
            "sus_frac": float(sus[valid].mean()),
            "elev_min": float(np.nanmin(dem[valid])),
            "elev_mean": float(np.nanmean(dem[valid])),
            "slope_mean": float(np.nanmean(slope[valid])),
        })
    import pandas as pd

    stats = pd.DataFrame(rows)
    stats_path = DATA / "vector" / "municipalities_terrain.csv"
    stats.to_csv(stats_path, index=False)
    print(stats.nlargest(10, "sus_frac")[["name", "sus_frac", "elev_mean"]].to_string(index=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
