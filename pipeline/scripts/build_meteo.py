"""Per-municipality precipitation + soil-moisture features (Open-Meteo archive).

--forecast adds a forward-looking precip_forecast_max7d_mm (next-7-days from
today, per municipality). Only meaningful for the *current* monitoring
snapshot — not for historical/archive builds like the May-2024 anchor.
"""

import argparse
import logging
import sys
from pathlib import Path

import geopandas as gpd
import pandas as pd

from pipeline.meteo import aggregate_meteo, forecast_max7d, load_parse
from pipeline.municipalities import load_municipalities
from pipeline.power import cross_check_precip, power_fallback_features, power_for_point

logger = logging.getLogger("build_meteo")

DATA = Path(__file__).resolve().parents[2] / "data"


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", default="2024-04-15")
    parser.add_argument("--end", default="2024-05-31")
    parser.add_argument("--aoi-only", action="store_true", help="only municipalities in municipalities_exposure output")
    parser.add_argument("--skip-power", action="store_true", help="skip NASA POWER cross-check (offline)")
    parser.add_argument("--forecast", action="store_true",
                        help="also fetch precip_forecast_max7d_mm (next-7-day forecast, monitoring builds only)")
    args = parser.parse_args()

    muni = load_municipalities()
    if args.aoi_only:
        expo_path = DATA / "vector" / "municipalities_exposure_may2024.geojson"
        expo = gpd.read_file(expo_path)
        muni = muni[muni.code.isin(expo[expo.flooded_m2 > 0].code)]
        logger.info("AOI-only: %d municipalities with flood intersection", len(muni))

    rows = []
    for _, m in muni.iterrows():
        pt = m.geometry.representative_point()
        p = None            # POWER payload — fetched at most once per municipality
        om_parsed = None    # parsed Open-Meteo payload (shared by features + cross-check)
        try:
            om_parsed = load_parse(pt.y, pt.x, args.start, args.end)
            f = aggregate_meteo(om_parsed)
        except Exception as exc:
            # Open-Meteo unavailable (429/5xx): NASA POWER MERRA-2 daily
            # precip as the documented fallback; soil moisture unknown ->
            # nan, risk_score treats unknowns as 0 and provenance marks it
            logger.warning("open-meteo failed for %s (%s); POWER fallback", m["name"], exc)
            f = {}
            if not args.skip_power:
                try:
                    p = power_for_point(pt.y, pt.x, args.start, args.end)
                    f = power_fallback_features(p)
                except Exception as exc2:
                    logger.warning("POWER fallback also failed for %s: %s", m["name"], exc2)
        if not args.skip_power and om_parsed is not None:
            # NASA POWER (MERRA-2) as an independent estimate of the same rain
            try:
                if p is None:
                    p = power_for_point(pt.y, pt.x, args.start, args.end)
                cc = cross_check_precip(om_parsed["precip_daily"], p["daily"])
                f["nasa_power_precip_max7d_mm"] = p["precip_max7d_mm"]
                f["power_vs_openmeteo_bias_mm"] = cc["bias_mm"]
                f["power_vs_openmeteo_maxabsdiff_mm"] = cc["max_abs_diff_mm"]
            except Exception as exc:
                logger.warning("POWER cross-check failed for %s: %s", m["name"], exc)
        if args.forecast:
            try:
                fc = forecast_max7d(pt.y, pt.x)
                f["precip_forecast_max7d_mm"] = fc["precip_forecast_max7d_mm"]
                f["n_forecast_days"] = fc["n_forecast_days"]
            except Exception as exc:
                logger.warning("forecast failed for %s: %s", m["name"], exc)
        rows.append({"code": m["code"], "name": m["name"], **f})

    if not rows:
        logger.error("no municipalities selected (check --aoi-only exposure file)")
        return 1

    out_dir = DATA / "vector"
    out_dir.mkdir(parents=True, exist_ok=True)
    df = pd.DataFrame(rows)
    out = muni.merge(df, on=["code", "name"], how="left").drop(
        columns=[c for c in ("population",) if c in muni.columns and c not in df.columns],
        errors="ignore",
    )
    path = out_dir / f"municipalities_meteo_{args.start}_{args.end}.geojson"
    out.to_file(path, driver="GeoJSON")
    logger.info("meteo features -> %s", path)
    top = out.nlargest(8, "precip_total_mm")[["name", "precip_total_mm", "precip_max7d_mm", "soil_moisture_mean"]]
    print(top.to_string(index=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
