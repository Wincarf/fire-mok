"""Per-municipality precipitation + soil-moisture features (Open-Meteo archive)."""

import argparse
import logging
import sys
from pathlib import Path

import geopandas as gpd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pipeline.meteo import meteo_for_point
from pipeline.municipalities import load_municipalities

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("build_meteo")

DATA = Path(__file__).resolve().parents[2] / "data"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", default="2024-04-15")
    parser.add_argument("--end", default="2024-05-31")
    parser.add_argument("--aoi-only", action="store_true", help="only municipalities in municipalities_exposure output")
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
            logger.warning("meteo failed for %s: %s", m["name"], exc)
            f = {}
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
