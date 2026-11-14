"""May-2024 flood anchor: S1 RTC before/after -> flood extent COG + polygons + preview."""

import argparse
import logging
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import rasterio
from rasterio.warp import Resampling, reproject

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pipeline.aoi import get_aoi
from pipeline.sar_process import process_scene
from pipeline.sar_search import search_s1_rtc
from pipeline.water import filter_min_area, flood_extent, mask_to_polygons, write_mask_cog

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("build_may2024")

DATA = Path(__file__).resolve().parents[2] / "data"
# No pre-flood S1 RTC exists on Planetary Computer for this AOI (checked 2024-01..05).
# Methodology: use the post-event recession scene (Jun 4) as the dry baseline;
# flood_extent(dry=jun04, wet=may11) yields the same flood footprint.
DRY_WINDOW = ("2024-06-01", "2024-06-15")
WET_WINDOW = ("2024-05-05", "2024-05-31")
THRESH_DB = -15.0


def pick(scenes, when, aoi_bbox, prefer_track=None):
    if not scenes:
        raise RuntimeError(f"no S1 RTC scenes in window {when}")
    from shapely.geometry import box

    target = box(*aoi_bbox)

    def coverage(s):
        return box(*s.bbox).intersection(target).area / target.area if s.bbox else 0.0

    candidates = [s for s in scenes if prefer_track is None or prefer_track in s.id] or scenes
    best = max(candidates, key=coverage)
    logger.info("picked %s (AOI coverage %.0f%%)", best.id, 100 * coverage(best))
    return best


def align(src_arr, src_transform, src_crs, dst_transform, dst_crs, shape):
    dst = np.full(shape, np.nan, dtype="float32")
    reproject(
        src_arr.astype("float32"), dst,
        src_transform=src_transform, src_crs=src_crs,
        dst_transform=dst_transform, dst_crs=dst_crs,
        resampling=Resampling.bilinear, src_nodata=np.nan, dst_nodata=np.nan,
    )
    return dst


def main() -> int:
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
    before = pick(search_s1_rtc(aoi.bbox, *DRY_WINDOW), "dry", aoi.bbox, prefer_track="0849")
    after = pick(search_s1_rtc(aoi.bbox, *WET_WINDOW), "wet", aoi.bbox, prefer_track="0849")
    logger.info("before: %s @ %s", before.id, before.datetime)
    logger.info("after:  %s @ %s", after.id, after.datetime)

    def cached(scene):
        out = sar_dir / f"{scene.id}_{args.band}_db.tif"
        if out.exists():
            logger.info("cache hit: %s", out.name)
            return out
        return process_scene(scene, args.band, aoi, sar_dir)

    before_tif = cached(before)
    after_tif = cached(after)

    with rasterio.open(before_tif) as b:
        before_db = b.read(1)
        profile = b.profile
        dst_transform, dst_crs = b.transform, b.crs
    with rasterio.open(after_tif) as a:
        after_db = a.read(1)
        after_transform, after_crs = a.transform, a.crs

    after_al = align(after_db, after_transform, after_crs, dst_transform, dst_crs, before_db.shape)

    flood = flood_extent(before_db, after_al, thresh_db=args.thresh)
    flood = filter_min_area(flood, min_px=25)
    frac = float(np.nanmean(flood[~np.isnan(before_db)])) if (~np.isnan(before_db)).any() else 0.0
    logger.info("flood pixels: %d (%.2f%% of valid)", int(flood.sum()), 100 * frac)

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
        (axes[0], before_db, f"before {before.datetime[:10]}"),
        (axes[1], after_al, f"after {after.datetime[:10]}"),
        (axes[2], after_al, "flood extent (red)"),
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
