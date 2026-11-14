import numpy as np
import pytest
from affine import Affine

from pipeline.population import exposed_population

T10 = Affine(10.0, 0.0, 0.0, 0.0, -10.0, 0.0)  # 10 m px = 100 m²


def test_exposed_population_sums_grid_over_flood():
    # density grid in people per pixel: 50 people on each flooded pixel
    density = np.full((4, 4), 50.0, dtype="float32")
    inside = np.ones((4, 4), dtype=bool)
    mask = np.zeros((4, 4), dtype=bool)
    mask[:, :2] = True  # 2 columns flooded = 8 pixels
    pop, method = exposed_population(density, inside, mask, 100.0, 9999, 0.5)
    assert pop == 400 and method == "worldpop_grid"


def test_exposed_population_grid_municipality_clipped():
    density = np.full((4, 4), 10.0, dtype="float32")
    inside = np.zeros((4, 4), dtype=bool)
    inside[0, :] = True  # municipality covers only the first row
    mask = np.ones((4, 4), dtype=bool)
    pop, method = exposed_population(density, inside, mask, 100.0, 9999, 0.9)
    assert pop == 40 and method == "worldpop_grid"  # 4 flooded px inside


def test_exposed_population_nan_pixels_excluded():
    density = np.array([[10.0, np.nan], [np.nan, np.nan]], dtype="float32")
    inside = np.ones((2, 2), dtype=bool)
    mask = np.ones((2, 2), dtype=bool)
    pop, _ = exposed_population(density, inside, mask, 100.0, 500, 1.0)
    assert pop == 10


def test_exposed_population_fallback_when_no_grid():
    inside = np.ones((2, 2), dtype=bool)
    mask = np.array([[True, False], [False, False]])
    pop, method = exposed_population(None, inside, mask, 100.0, 4000, 0.25)
    assert pop == 1000 and method == "uniform_density"


def test_exposed_population_fallback_when_grid_all_nan():
    density = np.full((2, 2), np.nan, dtype="float32")
    inside = np.ones((2, 2), dtype=bool)
    mask = np.array([[True, False], [False, False]])
    pop, method = exposed_population(density, inside, mask, 100.0, 4000, 0.25)
    assert pop == 1000 and method == "uniform_density"


def test_density_grid_count_preserving(tmp_path):
    """Density conversion keeps totals: 1 source px of 1000 people spread onto
    a 10x finer grid still sums to ~1000 over the fine pixels."""
    import rasterio

    from pipeline.population import density_from_counts

    arr = np.zeros((4, 4), dtype="float32")
    arr[2, 2] = 1000.0  # one source pixel: 1000 people at 100 m px = 1 ha
    src_transform = Affine(100.0, 0, 0, 0, -100.0, 0)
    crs = "EPSG:32722"

    # target grid 10x finer (10 m px), same footprint
    dst_shape = (40, 40)
    dst_transform = Affine(10.0, 0, 0, 0, -10.0, 0)
    grid = density_from_counts(arr, src_transform, crs, dst_transform, crs, dst_shape)
    assert grid is not None
    assert float(np.nansum(grid)) == pytest.approx(1000.0, rel=0.05)

    # and back to a coarser grid (4x coarser): total still ~1000
    coarse = density_from_counts(
        arr, src_transform, crs, Affine(400.0, 0, 0, 0, -400.0, 0), crs, (1, 1)
    )
    assert float(np.nansum(coarse)) == pytest.approx(1000.0, rel=0.05)
