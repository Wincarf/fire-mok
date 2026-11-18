"""IBGE municipalities + Census 2022 population + flood exposure."""

import json
import logging
from pathlib import Path

import geopandas as gpd
import httpx
import numpy as np
from affine import Affine
from rasterio.features import geometry_mask

from pipeline.population import exposed_population

logger = logging.getLogger(__name__)

MALHAS_URL = (
    "https://servicodados.ibge.gov.br/api/v3/malhas/estados/43"
    "?formato=application/vnd.geo+json&qualidade=minima&intrarregiao=municipio"
)
SIDRA_URL = (
    "https://apisidra.ibge.gov.br/values/t/4709/n6/in%20n3%2043/v/93/p/last?formato=json"
)
FIXTURE = Path(__file__).resolve().with_name("municipalities_fallback.geojson")


def parse_population_table(payload: list[dict]) -> dict[str, int]:
    """SIDRA rows -> {municipality_code: population}; skips header/separator rows."""
    out = {}
    for row in payload:
        try:
            out[str(row["D1C"])] = int(float(row["V"]))
        except (KeyError, TypeError, ValueError):
            continue
    return out


def fetch_population_rs(timeout: float = 60.0) -> dict[str, int]:
    return parse_population_table(httpx.get(SIDRA_URL, timeout=timeout).json())


def fetch_municipalities_rs(timeout: float = 60.0) -> gpd.GeoDataFrame:
    """Live IBGE mesh + Census 2022 population. Raises on network failure."""
    malhas = httpx.get(MALHAS_URL, timeout=timeout).json()
    gdf = gpd.GeoDataFrame.from_features(malhas["features"], crs="EPSG:4326")
    gdf = gdf.rename(columns={"codarea": "code"})
    names = httpx.get(
        "https://servicodados.ibge.gov.br/api/v1/localidades/estados/43/municipios",
        timeout=timeout,
    ).json()
    name_map = {str(n["id"]): n["nome"] for n in names}
    gdf["name"] = gdf["code"].map(name_map)
    gdf["population"] = gdf["code"].map(fetch_population_rs(timeout)).fillna(0).astype(int)
    return gdf[["code", "name", "population", "geometry"]]


def load_fixture_municipalities() -> gpd.GeoDataFrame:
    return gpd.read_file(FIXTURE)


def load_municipalities() -> gpd.GeoDataFrame:
    """Live IBGE data; falls back to committed fixture on outage."""
    try:
        return fetch_municipalities_rs()
    except Exception as exc:
        logger.warning("IBGE API failed (%s); using fixture GeoJSON", exc)
        return load_fixture_municipalities()


def exposure_by_municipality(
    muni: gpd.GeoDataFrame,
    mask: np.ndarray,
    transform: Affine,
    crs,
    pop_density: np.ndarray | None = None,
) -> gpd.GeoDataFrame:
    """Per-municipality flooded area, fraction, and exposed population.

    With pop_density (WorldPop grid on the same raster geometry, people per
    pixel): pop_exposed sums the actual grid over flooded municipality pixels.
    Without it: uniform density inside the municipality — screening estimate
    only. Mask must be in a metric projected CRS.
    """
    px_area = abs(transform.a * transform.e)
    out_crs = muni.crs or crs
    muni = muni.to_crs(crs)
    rows = []
    for _, row in muni.iterrows():
        inside = geometry_mask(
            [row.geometry], out_shape=mask.shape, transform=transform, invert=True
        )
        flooded = int((inside & mask).sum())
        total = max(int(inside.sum()), 1)
        frac = flooded / total
        pop, method = exposed_population(
            pop_density, inside, mask, px_area, int(row.get("population", 0)), frac
        )
        rows.append(
            {
                "code": row["code"],
                "name": row["name"],
                "population": int(row.get("population", 0)),
                "flooded_m2": flooded * px_area,
                "flood_frac": frac,
                "pop_exposed": pop,
                "pop_method": method,
                "geometry": row.geometry,
            }
        )
    return gpd.GeoDataFrame(rows, crs=crs).to_crs(out_crs)
