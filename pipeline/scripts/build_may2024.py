"""May-2024 flood anchor: S1 RTC dry/wet -> flood extent COG + polygons + preview."""

import argparse
import logging
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import rasterio

from pipeline.aoi import get_aoi
from pipeline.masks import (
    clean_flood_extent,
    fetch_worldcover_for_bounds,
    permanent_water_mask,
    urban_mask,
)
from pipeline.raster import reproject_to_grid, write_mask_cog
from pipeline.sar_process import process_scene
from pipeline.sar_search import scene_coverage, search_s1_rtc
from pipeline.water import DEFAULT_THRESH_DB, filter_min_area, flood_extent, mask_to_polygons

logger = logging.getLogger("build_may2024")

DATA = Path(__file__).resolve().parents[2] / "data"
# No pre-flood S1 RTC exists on Planetary Computer for this AOI (checked 2024-01..05).
# Methodology: use the post-event recession scene (Jun 4) as the dry baseline;
# flood_extent(dry=jun04, wet=may11) yields the same flood footprint.
DRY_WINDOW = ("2024-06-01", "2024-06-15")
WET_WINDOW = ("2024-05-05", "2024-05-31")
THRESH_DB = DEFAULT_THRESH_DB


def pick(scenes, when, aoi_bbox, prefer_track=None):
    if not scenes:
        raise RuntimeError(f"no S1 RTC scenes in window {when}")
    candidates = [s for s in scenes if prefer_track is None or prefer_track in s.id] or scenes
    best = max(candidates, key=lambda s: scene_coverage(s, aoi_bbox))
    logger.info("picked %s (AOI coverage %.0f%%)", best.id, 100 * scene_coverage(best, aoi_bbox))
    return best


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    parser = argparse.ArgumentParser()
    parser.add_argument("--aoi", default="guaiba")
    parser.add_argument("--band", default="vv")
    parser.add_argument("--thresh", type=float, default=THRESH_DB)
    args = parser.parse_args()
    aoi = get_aoi(args.aoi)

    sar_dir = DATA / "sar"
    vec_dir = DATA / "vector"
    rep_dir = DATA / "reports"

    # same 08:49 descending track for both dates when possible
    dry = pick(search_s1_rtc(aoi.bbox, *DRY_WINDOW), "dry", aoi.bbox, prefer_track="0849")
    wet = pick(search_s1_rtc(aoi.bbox, *WET_WINDOW), "wet", aoi.bbox, prefer_track="0849")
    logger.info("dry: %s @ %s", dry.id, dry.datetime)
    logger.info("wet: %s @ %s", wet.id, wet.datetime)

    def cached(scene):
        out = sar_dir / f"{scene.id}_{args.band}_db.tif"
        if out.exists():
            logger.info("cache hit: %s", out.name)
            return out
        return process_scene(scene, args.band, aoi, sar_dir)

    dry_tif = cached(dry)
    wet_tif = cached(wet)

    with rasterio.open(dry_tif) as b:
        dry_db = b.read(1)
        profile = b.profile
        dst_transform, dst_crs = b.transform, b.crs
    with rasterio.open(wet_tif) as a:
        wet_db = a.read(1)
        wet_transform, wet_crs = a.transform, a.crs

    wet_al = reproject_to_grid(wet_db, wet_transform, wet_crs, dst_transform, dst_crs, dry_db.shape)

    flood = flood_extent(dry_db, wet_al, thresh_db=args.thresh)
    flood = filter_min_area(flood, min_px=25)
    frac = float(np.nanmean(flood[~np.isnan(dry_db)])) if (~np.isnan(dry_db)).any() else 0.0
    logger.info("flood pixels: %d (%.2f%% of valid)", int(flood.sum()), 100 * frac)

    # context masks (WorldCover): cut permanent-water and urban false positives
    ctx_dir = DATA / "context"
    try:
        wc = fetch_worldcover_for_bounds(aoi.bbox, dst_transform, dst_crs, dry_db.shape)
        permanent, urban = permanent_water_mask(wc), urban_mask(wc)
        write_mask_cog(permanent, profile, ctx_dir / "permanent_water_guaiba.tif")
        write_mask_cog(urban, profile, ctx_dir / "urban_guaiba.tif")
        flood, removed = clean_flood_extent(flood, permanent, urban)
        logger.info(
            "context cleaning: -%d permanent-water px, -%d urban px -> %d flood px",
            removed["removed_permanent"], removed["removed_urban"], removed["after_px"],
        )
    except Exception as exc:  # masks are context, not core — never block the build
        logger.warning("worldcover masks unavailable, extent NOT cleaned: %s", exc)

    flood_tif = write_mask_cog(flood, profile, sar_dir / "flood_extent_may2024.tif")
    polys = mask_to_polygons(flood, dst_transform, dst_crs)
    vec_dir.mkdir(parents=True, exist_ok=True)
    if len(polys):
        polys.to_crs(4326).to_file(vec_dir / "flood_polygons_may2024.geojson", driver="GeoJSON")
        logger.info("polygons: %d", len(polys))
    else:
        logger.warning("no flood polygons produced")

    rep_dir.mkdir(parents=True, exist_ok=True)
    fig, axes = plt.subplots(1, 3, figsize=(18, 6))
    for ax, arr, title in [
        (axes[0], dry_db, f"dry {dry.datetime[:10]}"),
        (axes[1], wet_al, f"wet {wet.datetime[:10]}"),
        (axes[2], wet_al, "flood extent (red)"),
    ]:
        ax.imshow(arr, cmap="gray", vmin=-30, vmax=0)
        ax.set_title(f"{title} sigma0 {args.band.upper()}")
    axes[2].imshow(np.ma.masked_where(~flood, flood), cmap="autumn", alpha=0.7)
    png = rep_dir / "may2024_preview.png"
    fig.savefig(png, dpi=110, bbox_inches="tight")
    logger.info("preview -> %s", png)
    print(f"flood COG -> {flood_tif}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
