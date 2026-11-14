import geopandas as gpd
import numpy as np
import pytest
from affine import Affine
from shapely.geometry import box

from pipeline.municipalities import (
    exposure_by_municipality,
    load_fixture_municipalities,
    parse_population_table,
)


def test_fixture_municipalities_loads():
    gdf = load_fixture_municipalities()
    assert len(gdf) >= 5
    assert gdf.crs is not None
    assert "code" in gdf.columns and "name" in gdf.columns
    assert gdf.geometry.is_valid.all()


def test_parse_population_table():
    # SIDRA-like payload: list of dicts with V (value) and municipality code
    payload = [
        {"D1C": "4300104", "D1N": "Aceguá", "V": "4724"},
        {"D1C": "4300203", "D1N": "Água Santa", "V": "3823"},
    ]
    pop = parse_population_table(payload)
    assert pop == {"4300104": 4724, "4300203": 3823}


def test_exposure_intersects_flood():
    # two municipalities side by side in EPSG:32722 coords
    muni = gpd.GeoDataFrame(
        {"code": ["A", "B"], "name": ["A", "B"], "population": [1000, 2000]},
        geometry=[
            box(500000, 6700000, 510000, 6710000),   # flood covers left half
            box(520000, 6700000, 530000, 6710000),
        ],
        crs="EPSG:32722",
    )
    transform = Affine(10, 0, 505000, 0, -10, 6710000)
    # flood only in A's area: x 500-510k -> cols 0-500 of the grid
    mask = np.zeros((10000, 10000), dtype=bool)
    mask[:1000, :500] = True
    out = exposure_by_municipality(muni, mask, transform, "EPSG:32722")
    a = out[out.code == "A"].iloc[0]
    b = out[out.code == "B"].iloc[0]
    assert a["flooded_m2"] > 0 and b["flooded_m2"] == 0
    assert a["flood_frac"] > 0 and b["flood_frac"] == 0
    assert b["pop_exposed"] == 0  # zero-intersection municipality, no NaN/div0
