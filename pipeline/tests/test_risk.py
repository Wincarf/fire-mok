import pytest

from pipeline.risk import categorize, risk_score


def _f(**kw):
    base = {
        "precip_max7d_mm": 0.0,
        "soil_moisture_mean": 0.0,
        "sus_frac": 0.0,
        "flood_frac": 0.0,
    }
    base.update(kw)
    return base


def test_all_zero_is_low():
    r = risk_score(_f())
    assert r == 0.0 and categorize(r) == "low"


def test_extreme_inputs_saturate_to_one():
    r = risk_score(_f(precip_max7d_mm=500, soil_moisture_mean=0.9, sus_frac=1.0, flood_frac=0.5))
    assert r <= 1.0
    assert categorize(r) in ("high", "critical")


def test_moderate_combo():
    r = risk_score(_f(precip_max7d_mm=150, soil_moisture_mean=0.35, sus_frac=0.4, flood_frac=0.05))
    assert 0.2 < r < 0.7


def test_precip_alone_bounded():
    # huge rain on non-susceptible terrain should not reach critical
    r = risk_score(_f(precip_max7d_mm=400))
    assert r < 0.45


def test_categorize_bins():
    assert categorize(0.0) == "low"
    assert categorize(0.25) == "low"
    assert categorize(0.26) == "moderate"
    assert categorize(0.5) == "moderate"
    assert categorize(0.51) == "high"
    assert categorize(0.75) == "high"
    assert categorize(0.76) == "critical"
