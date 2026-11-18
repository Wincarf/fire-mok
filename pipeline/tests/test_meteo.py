import numpy as np

from pipeline.meteo import (
    aggregate_meteo,
    parse_open_meteo,
    max_window_sum,
)


def _payload(days=30, precip=10.0, sm=0.30):
    return {
        "daily": {
            "time": [f"2024-04-{d:02d}" for d in range(1, days + 1)],
            "precipitation_sum": [precip] * days,
        },
        "hourly": {
            "time": [f"2024-04-01T{h:02d}:00" for h in range(24)],
            "soil_moisture_0_to_7cm": [sm] * 24,
        },
    }


def test_parse_open_meteo_basic():
    d = parse_open_meteo(_payload())
    assert d["precip_total_mm"] == 300.0
    assert d["soil_moisture_mean"] == 0.30
    assert d["missing"]["precipitation_sum"] == 0


def test_missing_values_counted_not_imputed():
    p = _payload()
    p["daily"]["precipitation_sum"][5] = None
    p["hourly"]["soil_moisture_0_to_7cm"][0] = None
    d = parse_open_meteo(p)
    assert d["precip_total_mm"] == 290.0
    assert d["missing"]["precipitation_sum"] == 1
    assert d["missing"]["soil_moisture_0_to_7cm"] == 1
    assert np.isclose(d["soil_moisture_mean"], 0.30 * 23 / 23)


def test_max_window_sum():
    assert max_window_sum([1, 5, 2, 0, 9, 1, 1], 3) == 11  # window (2,0,9)
    assert max_window_sum([3, 3], 7) == 6  # window larger than series -> total
    assert max_window_sum([], 7) == 0.0


def test_aggregate_meteo_features():
    d = parse_open_meteo(_payload())
    f = aggregate_meteo(d)
    assert set(f) >= {
        "precip_total_mm",
        "precip_max7d_mm",
        "precip_max_day_mm",
        "soil_moisture_mean",
        "soil_moisture_max",
        "n_days",
        "missing_frac",
    }
    assert f["precip_max7d_mm"] == 70.0
    assert f["precip_max_day_mm"] == 10.0
