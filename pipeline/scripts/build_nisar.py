"""NISAR GCOV ingestion: public scene inventory -> (with Earthdata) L-band product.

Two-stage by design:
  1. ALWAYS: anonymous ASF search over the AOI -> data/vector/nisar_scenes.json
     (the /api/nisar payload; works without any credentials).
  2. IF Earthdata credentials exist (EARTHDATA_USER/EARTHDATA_PASS or netrc):
     download the most recent GCOV granule intersecting the AOI, convert
     HDF5 -> COG (dB) and write data/vector/nisar_status.json with the
     L-band open-water proxy stats over the AOI.

Exit code is always 0: the monitoring cron treats NISAR as optional until
the (free) Earthdata secrets are configured.
"""

import argparse
import datetime
import json
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pipeline.aoi import get_aoi
from pipeline.nisar import (
    download_gcov,
    duet_products,
    earthdata_session,
    gcov_to_cog,
    inventory_payload,
    lband_stats_over_bbox,
    search_nisar_gcov,
)
from pipeline.types import Scene

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("build_nisar")

DATA = Path(__file__).resolve().parents[2] / "data"
LOOKBACK_DAYS = 365


def newest_covering(scenes: list[Scene]) -> Scene | None:
    """Most recent scene (ISO datetimes sort lexicographically)."""
    return max(scenes, key=lambda s: s.datetime, default=None)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--aoi", default="guaiba")
    ap.add_argument("--lookback-days", type=int, default=LOOKBACK_DAYS)
    ap.add_argument("--pol", default="HHHH")
    args = ap.parse_args()
    aoi = get_aoi(args.aoi)

    end = datetime.date.today().isoformat()
    start = (datetime.date.today() - datetime.timedelta(days=args.lookback_days)).isoformat()
    scenes = search_nisar_gcov(aoi.bbox, start, end)
    logger.info("NISAR GCOV scenes over %s in [%s, %s]: %d", aoi.name, start, end, len(scenes))

    out_dir = DATA / "vector"
    out_dir.mkdir(parents=True, exist_ok=True)
    payload = inventory_payload(scenes, aoi.name, aoi.bbox, end)
    (out_dir / "nisar_scenes.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    logger.info("wrote %s", out_dir / "nisar_scenes.json")

    session = earthdata_session()
    if session is None:
        logger.warning("inventory-only run: no Earthdata credentials -> no L-band product")
        return 0

    scene = newest_covering(scenes)
    if scene is None:
        logger.warning("inventory-only run: no GCOV scene covers the AOI")
        return 0

    logger.info("downloading %s @ %s", scene.id, scene.datetime)
    h5 = download_gcov(scene, session, DATA / "nisar")
    cog = gcov_to_cog(h5, args.pol, DATA / "nisar" / f"{scene.id}_{args.pol}_db.tif")
    stats = lband_stats_over_bbox(cog, aoi.bbox)

    status = {
        "granule_id": scene.id,
        "scene_datetime": scene.datetime,
        "polarization": args.pol,
        "cog": cog.name,
        "source": "NISAR L2 GCOV — ASF DAAC (Earthdata)",
        "generated": end,
        "lband": stats,
    }
    try:
        s1 = DATA / "sar" / "flood_extent_may2024.tif"
        status["duet"] = duet_products(cog, aoi.bbox, None, s1, DATA / "nisar")
        logger.info("duet layers: %s", status["duet"])
    except Exception as exc:
        logger.warning("duet layers skipped: %s", exc)
    (out_dir / "nisar_status.json").write_text(
        json.dumps(status, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    logger.info("wrote %s", out_dir / "nisar_status.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
