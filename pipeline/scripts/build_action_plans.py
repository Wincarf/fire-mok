"""Generate per-municipality action plans from the risk layer."""

import json
import logging
import sys
from pathlib import Path

import geopandas as gpd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pipeline.action_plan import build_action_plan

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
DATA = Path(__file__).resolve().parents[2] / "data"


def main() -> int:
    risk = gpd.read_file(DATA / "vector" / "municipalities_risk_may2024.geojson")
    plans = {}
    for _, m in risk[risk.flood_frac > 0].iterrows():
        p = build_action_plan(m.to_dict())
        plans[m["code"]] = p
    out = DATA / "vector" / "action_plans_may2024.json"
    out.write_text(json.dumps(plans, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(plans.get("4305108", {}), ensure_ascii=False, indent=1))  # Eldorado do Sul
    logging.getLogger("plans").info("plans for %d municipalities -> %s", len(plans), out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
