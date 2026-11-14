import numpy as np
from affine import Affine

from pipeline.terrain import slope_deg, susceptibility


def _flat_dem(v=50.0, shape=(10, 10)):
    return np.full(shape, v, dtype="float32")


def test_slope_flat_is_zero():
    dem = _flat_dem()
    t = Affine(30, 0, 0, 0, -30, 0)  # 30 m pixels
    assert slope_deg(dem, t).max() == 0.0


def test_slope_known_gradient():
    # 1 m drop every 30 m pixel in x -> ~1.91 degrees
    dem = np.tile(np.arange(10, dtype="float32") * -1.0, (10, 1))
    t = Affine(30, 0, 0, 0, -30, 0)
    s = slope_deg(dem, t)
    assert np.isclose(np.nanmean(s[2:-2, 2:-2]), np.degrees(np.arctan(1 / 30)), atol=0.05)


def test_susceptibility_low_flat_true_high_steep_false():
    # left half low+flat, right half high+steep
    dem = np.zeros((20, 20), dtype="float32")
    dem[:, 10:] = 200
    dem[:, 10:] += np.linspace(0, 50, 20)[:, None]  # gradient on the high side
    t = Affine(30, 0, 0, 0, -30, 0)
    sus = susceptibility(dem, t, elev_thresh_m=100.0, slope_thresh_deg=5.0)
    assert sus[:, 3].all()
    assert not sus[:, 15].any()


def test_susceptibility_nodata_stays_false():
    dem = _flat_dem()
    dem[0, 0] = np.nan
    t = Affine(30, 0, 0, 0, -30, 0)
    sus = susceptibility(dem, t, 100.0, 5.0)
    assert not sus[0, 0]
