"""Build RS municipality layer (IBGE + Census 2022) and May-2024 flood exposure."""

import logging
import sys
from pathlib import Path

import numpy as np
import rasterio

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pipeline.municipalities import exposure_by_municipality, load_municipalities
from pipeline.population import fetch_pop_density_grid

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("build_municipalities")

DATA = Path(__file__).resolve().parents[2] / "data"


def main() -> int:
    out_dir = DATA / "vector"
    out_dir.mkdir(parents=True, exist_ok=True)

    muni = load_municipalities()
    muni_path = out_dir / "municipalities_rs.geojson"
    muni.to_file(muni_path, driver="GeoJSON")
    logger.info("municipalities: %d -> %s", len(muni), muni_path)

    flood_tif = DATA / "sar" / "flood_extent_may2024.tif"
    if not flood_tif.exists():
        logger.warning("no flood COG; run build_may2024.py first")
        return 0

    with rasterio.open(flood_tif) as src:
        mask = src.read(1) == 1
        transform, crs = src.transform, src.crs

    from pipeline.aoi import get_aoi

    aoi = get_aoi("guaiba")
    density = fetch_pop_density_grid(
        aoi.bbox, transform, crs, mask.shape,
        DATA / "population" / "worldpop_bra_aoi.tif",
    )
    if density is not None:
        logger.info("pop exposure source: WorldPop grid (summed over flooded px)")
    else:
        logger.info("pop exposure source: uniform-density fallback")

    expo = exposure_by_municipality(muni, mask, transform, crs, pop_density=density)
    expo_path = out_dir / "municipalities_exposure_may2024.geojson"
    expo.to_file(expo_path, driver="GeoJSON")
    top = expo.nlargest(10, "pop_exposed")[["name", "flooded_m2", "flood_frac", "pop_exposed"]]
    logger.info("exposure -> %s\n%s", expo_path, top.to_string(index=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
