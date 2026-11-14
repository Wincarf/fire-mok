"""Auto-ingest: latest Sentinel-1 RTC scene over the AOI -> flood extent.

Monitoring mode for cron / scheduled CI: search the last N days, pick the
most recent full-coverage scene, build the flood extent against the previous
scene on the same orbit pass, apply the WorldCover context cleaning, and
write flood_extent_latest.tif + polygons. --dry-run prints the plan only.

This is what turns Fire Mok from a retrospective into a monitor: every new
S1 acquisition over the AOI produces a fresh extent without manual steps.
"""

import argparse
import logging
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import rasterio
from rasterio.warp import Resampling, reproject

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pipeline.aoi import get_aoi
from pipeline.masks import clean_flood_extent, fetch_worldcover_for_bounds
from pipeline.sar_process import process_scene
from pipeline.sar_search import search_s1_rtc
from pipeline.types import Scene
from pipeline.water import filter_min_area, flood_extent, mask_to_polygons, write_mask_cog

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("update_latest")

DATA = Path(__file__).resolve().parents[2] / "data"
LOOKBACK_DAYS = 14
THRESH_DB = -15.0


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--aoi", default="guaiba")
    p.add_argument("--band", default="vv")
    p.add_argument("--thresh", type=float, default=THRESH_DB)
    p.add_argument("--lookback-days", type=int, default=LOOKBACK_DAYS)
    p.add_argument("--dry-run", action="store_true", help="log the scene plan and exit")
    return p.parse_args()


def sensing_time(scene_id: str) -> datetime | None:
    m = re.search(r"(\d{8})T(\d{6})", scene_id)
    if not m:
        return None
    return datetime.strptime(m.group(1) + m.group(2), "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)


def pass_token(scene_id: str) -> str:
    """Sensing-start HHMM (same pass = same HHMM across days on the same orbit)."""
    m = re.search(r"(\d{8})T(\d{4})\d{2}", scene_id)
    return m.group(2) if m else ""


def coverage(scene: Scene, aoi_bbox) -> float:
    if not scene.bbox:
        return 0.0
    from shapely.geometry import box

    target = box(*aoi_bbox)
    return box(*scene.bbox).intersection(target).area / target.area


def choose_pair(scenes: list[Scene], aoi_bbox, min_coverage: float = 0.99) -> tuple[Scene, Scene] | None:
    """(latest, baseline) pair: newest full-coverage scene + previous scene on
    the same pass. Returns None when fewer than two usable scenes exist."""
    usable = sorted(
        (s for s in scenes if coverage(s, aoi_bbox) >= min_coverage and sensing_time(s.id)),
        key=lambda s: sensing_time(s.id),
        reverse=True,
    )
    if len(usable) < 2:
        return None
    latest = usable[0]
    token = pass_token(latest.id)
    baseline = next((s for s in usable[1:] if pass_token(s.id) == token), None)
    if baseline is None:
        baseline = usable[1]  # same pass unavailable: nearest previous scene
    return latest, baseline


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
    args = parse_args()
    aoi = get_aoi(args.aoi)
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=args.lookback_days)
    scenes = search_s1_rtc(aoi.bbox, start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d"))
    pair = choose_pair(scenes, aoi.bbox)
    if pair is None:
        logger.info("up to date: no new full-coverage scene pair in the last %d days", args.lookback_days)
        return 0
    after, before = pair
    logger.info("latest:  %s (%s)", after.id, after.datetime[:10])
    logger.info("baseline: %s (%s)", before.id, before.datetime[:10])
    if args.dry_run:
        logger.info("dry-run: nothing processed")
        return 0

    sar_dir = DATA / "sar"
    vec_dir = DATA / "vector"
    before_tif = sar_dir / f"{before.id}_{args.band}_db.tif"
    after_tif = sar_dir / f"{after.id}_{args.band}_db.tif"
    if not before_tif.exists():
        process_scene(before, args.band, aoi, sar_dir)
    if not after_tif.exists():
        process_scene(after, args.band, aoi, sar_dir)

    with rasterio.open(before_tif) as b:
        before_db, profile = b.read(1), b.profile
        dst_transform, dst_crs = b.transform, b.crs
    with rasterio.open(after_tif) as a:
        after_db = a.read(1)
    after_al = align(after_db, a.transform, a.crs, dst_transform, dst_crs, before_db.shape)

    flood = flood_extent(before_db, after_al, thresh_db=args.thresh)
    flood = filter_min_area(flood, min_px=25)
    try:
        wc = fetch_worldcover_for_bounds(aoi.bbox, dst_transform, dst_crs, before_db.shape)
        flood, removed = clean_flood_extent(
            flood,
            wc == 80,  # permanent water
            wc == 50,  # urban
        )
        logger.info("context cleaning: %d px left", removed["after_px"])
    except Exception as exc:
        logger.warning("worldcover unavailable, extent NOT cleaned: %s", exc)

    flood_tif = write_mask_cog(flood, profile, sar_dir / "flood_extent_latest.tif")
    polys = mask_to_polygons(flood, dst_transform, dst_crs)
    vec_dir.mkdir(parents=True, exist_ok=True)
    if len(polys):
        polys.to_crs(4326).to_file(vec_dir / "flood_polygons_latest.geojson", driver="GeoJSON")
    logger.info("latest flood extent -> %s (%d px)", flood_tif, int(flood.sum()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
