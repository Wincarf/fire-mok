"""Merge exposure + meteo + terrain into the municipal risk index."""

import logging
import sys
from pathlib import Path

import geopandas as gpd
import pandas as pd

from pipeline.risk import categorize, risk_score

logger = logging.getLogger("build_risk")

DATA = Path(__file__).resolve().parents[2] / "data"


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    vec = DATA / "vector"
    expo = gpd.read_file(vec / "municipalities_exposure_may2024.geojson")
    meteo = gpd.read_file(vec / "municipalities_meteo_2024-04-15_2024-05-31.geojson")
    terr = pd.read_csv(vec / "municipalities_terrain.csv", dtype={"code": str})

    muni = expo[["code", "name", "population", "flooded_m2", "flood_frac", "pop_exposed", "geometry"]].merge(
        meteo[["code", "precip_total_mm", "precip_max7d_mm", "soil_moisture_mean", "missing_frac"]].drop(columns="geometry", errors="ignore"),
        on="code", how="left",
    ).merge(
        terr[["code", "sus_frac", "elev_mean", "slope_mean"]], on="code", how="left"
    ).fillna({"precip_max7d_mm": 0, "soil_moisture_mean": 0, "sus_frac": 0, "flood_frac": 0})

    muni["risk"] = muni.apply(
        lambda r: risk_score({
            "precip_max7d_mm": r.precip_max7d_mm,
            "soil_moisture_mean": r.soil_moisture_mean,
            "sus_frac": r.sus_frac,
            "flood_frac": r.flood_frac,
        }), axis=1,
    )
    muni["risk_category"] = muni.risk.map(categorize)

    out = vec / "municipalities_risk_may2024.geojson"
    muni.to_file(out, driver="GeoJSON")
    logger.info("risk -> %s", out)
    cols = ["name", "risk", "risk_category", "flood_frac", "precip_max7d_mm", "sus_frac"]
    print(muni.nlargest(12, "risk")[cols].to_string(index=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
