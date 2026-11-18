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
from pipeline.stac import scene_datetime_from_id
from pipeline.types import Scene
from pipeline.water import DEFAULT_THRESH_DB, filter_min_area, flood_extent, mask_to_polygons

logger = logging.getLogger("update_latest")

DATA = Path(__file__).resolve().parents[2] / "data"
LOOKBACK_DAYS = 14
THRESH_DB = DEFAULT_THRESH_DB


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--aoi", default="guaiba")
    p.add_argument("--band", default="vv")
    p.add_argument("--thresh", type=float, default=THRESH_DB)
    p.add_argument("--lookback-days", type=int, default=LOOKBACK_DAYS)
    p.add_argument("--dry-run", action="store_true", help="log the scene plan and exit")
    return p.parse_args()


def pass_token(scene_id: str) -> str:
    """Sensing-start HHMM (same pass = same HHMM across days on the same orbit)."""
    m = re.search(r"(\d{8})T(\d{4})\d{2}", scene_id)
    return m.group(2) if m else ""


def choose_pair(scenes: list[Scene], aoi_bbox, min_coverage: float = 0.99) -> tuple[Scene, Scene] | None:
    """(latest, baseline) pair: newest full-coverage scene + previous scene on
    the same pass. Returns None when fewer than two usable scenes exist."""
    usable = sorted(
        (s for s in scenes if scene_coverage(s, aoi_bbox) >= min_coverage and scene_datetime_from_id(s.id)),
        key=lambda s: scene_datetime_from_id(s.id),
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


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    args = parse_args()
    aoi = get_aoi(args.aoi)
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=args.lookback_days)
    scenes = search_s1_rtc(aoi.bbox, start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d"))
    pair = choose_pair(scenes, aoi.bbox)
    if pair is None:
        logger.info("up to date: no new full-coverage scene pair in the last %d days", args.lookback_days)
        return 0
    latest, baseline = pair
    logger.info("latest:   %s (%s)", latest.id, latest.datetime[:10])
    logger.info("baseline: %s (%s)", baseline.id, baseline.datetime[:10])
    if args.dry_run:
        logger.info("dry-run: nothing processed")
        return 0

    sar_dir = DATA / "sar"
    vec_dir = DATA / "vector"
    baseline_tif = sar_dir / f"{baseline.id}_{args.band}_db.tif"
    latest_tif = sar_dir / f"{latest.id}_{args.band}_db.tif"
    if not baseline_tif.exists():
        process_scene(baseline, args.band, aoi, sar_dir)
    if not latest_tif.exists():
        process_scene(latest, args.band, aoi, sar_dir)

    with rasterio.open(baseline_tif) as b:
        ref_db, profile = b.read(1), b.profile
        dst_transform, dst_crs = b.transform, b.crs
    with rasterio.open(latest_tif) as a:
        latest_db = a.read(1)
    latest_al = reproject_to_grid(latest_db, a.transform, a.crs, dst_transform, dst_crs, ref_db.shape)

    flood = flood_extent(ref_db, latest_al, thresh_db=args.thresh)
    flood = filter_min_area(flood, min_px=25)
    try:
        wc = fetch_worldcover_for_bounds(aoi.bbox, dst_transform, dst_crs, ref_db.shape)
        flood, removed = clean_flood_extent(flood, permanent_water_mask(wc), urban_mask(wc))
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
