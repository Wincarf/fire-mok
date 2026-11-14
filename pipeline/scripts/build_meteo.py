"""Per-municipality precipitation + soil-moisture features (Open-Meteo archive)."""

import argparse
import logging
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pipeline.meteo import load_parse, meteo_for_point
from pipeline.municipalities import load_municipalities
from pipeline.power import cross_check_precip, power_for_point

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("build_meteo")

DATA = Path(__file__).resolve().parents[2] / "data"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", default="2024-04-15")
    parser.add_argument("--end", default="2024-05-31")
    parser.add_argument("--aoi-only", action="store_true", help="only municipalities in municipalities_exposure output")
    parser.add_argument("--skip-power", action="store_true", help="skip NASA POWER cross-check (offline)")
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
        try:
            f = meteo_for_point(pt.y, pt.x, args.start, args.end)
        except Exception as exc:
            # Open-Meteo unavailable (429/5xx): NASA POWER MERRA-2 daily
            # precip as the documented fallback; soil moisture unknown ->
            # nan, risk_score treats unknowns as 0 and provenance marks it
            logger.warning("open-meteo failed for %s (%s); POWER fallback", m["name"], exc)
            f = {}
            if not args.skip_power:
                try:
                    p = power_for_point(pt.y, pt.x, args.start, args.end)
                    vals = list(p["daily"].values())
                    f = {
                        "precip_total_mm": p["precip_total_mm"],
                        "precip_max7d_mm": p["precip_max7d_mm"],
                        "precip_max_day_mm": float(np.max(vals)) if vals else 0.0,
                        "soil_moisture_mean": np.nan,
                        "soil_moisture_max": np.nan,
                        "n_days": p["n_days"],
                        "missing_frac": p["n_missing"] / max(p["n_days"], 1),
                        "precip_source": "NASA POWER MERRA-2 (fallback)",
                    }
                except Exception as exc2:
                    logger.warning("POWER fallback also failed for %s: %s", m["name"], exc2)
        if not args.skip_power:
            # NASA POWER (MERRA-2) as an independent estimate of the same rain
            try:
                p = power_for_point(pt.y, pt.x, args.start, args.end)
                parsed = load_parse(pt.y, pt.x, args.start, args.end)
                cc = cross_check_precip(parsed["precip"], p["daily"])
                f["nasa_power_precip_max7d_mm"] = p["precip_max7d_mm"]
                f["power_vs_openmeteo_bias_mm"] = cc["bias_mm"]
                f["power_vs_openmeteo_maxabsdiff_mm"] = cc["max_abs_diff_mm"]
            except Exception as exc:
                logger.warning("POWER cross-check failed for %s: %s", m["name"], exc)
        rows.append({"code": m["code"], "name": m["name"], **f})

    out_dir = DATA / "vector"
    out_dir.mkdir(parents=True, exist_ok=True)
    out = muni.merge(
        gpd.pd.DataFrame(rows), on=["code", "name"], how="left"
    ).drop(columns=[c for c in ("population",) if c in muni.columns and c not in rows[0]], errors="ignore")
    path = out_dir / f"municipalities_meteo_{args.start}_{args.end}.geojson"
    out.to_file(path, driver="GeoJSON")
    logger.info("meteo features -> %s", path)
    top = out.nlargest(8, "precip_total_mm")[["name", "precip_total_mm", "precip_max7d_mm", "soil_moisture_mean"]]
    print(top.to_string(index=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
