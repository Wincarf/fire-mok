"""Generate per-municipality action plans from the risk layer."""

import json
import logging
import sys
from pathlib import Path

import geopandas as gpd

from pipeline.action_plan import build_action_plan

logger = logging.getLogger("build_action_plans")

DATA = Path(__file__).resolve().parents[2] / "data"


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    risk = gpd.read_file(DATA / "vector" / "municipalities_risk_may2024.geojson")
    plans = {}
    for _, m in risk[risk.flood_frac > 0].iterrows():
        p = build_action_plan(m.to_dict())
        plans[m["code"]] = p
    out = DATA / "vector" / "action_plans_may2024.json"
    out.write_text(json.dumps(plans, ensure_ascii=False, indent=1), encoding="utf-8")
    logger.info("plans for %d municipalities -> %s", len(plans), out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
