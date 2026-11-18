import os

import numpy as np
import pytest

from pipeline.power import cross_check_precip, parse_power_precip, power_for_point

POWER_PAYLOAD = {
    "properties": {
        "parameter": {
            "PRECTOTCORR": {
                "20240510": 26.42,
                "20240511": 37.09,
                "20240512": 54.12,
                "20240513": -999.0,
                "20240514": 0.03,
            }
        }
    }
}


def test_parse_power_precip_drops_fill():
    daily, n_missing = parse_power_precip(POWER_PAYLOAD)
    assert daily == {
        "2024-05-10": 26.42, "2024-05-11": 37.09, "2024-05-12": 54.12, "2024-05-14": 0.03,
    }
    assert n_missing == 1


def test_cross_check_precip_known_bias():
    om = {"a": 10.0, "b": 20.0, "c": 30.0, "d": 40.0}
    pw = {"a": 12.0, "b": 18.0, "c": 31.0, "d": 43.0}
    cc = cross_check_precip(om, pw)
    assert cc["n_overlap_days"] == 4
    assert cc["bias_mm"] == pytest.approx((2 - 2 + 1 + 3) / 4)  # +1.0
    assert cc["max_abs_diff_mm"] == pytest.approx(3.0)
    assert cc["max7d_open_meteo_mm"] == pytest.approx(100.0)
    assert cc["max7d_power_mm"] == pytest.approx(104.0)


def test_cross_check_precip_aligns_on_dates():
    # OM drops a day POWER has (and vice versa): the join is on dates, not
    # positions — a positional align would pair 30.0 with 32.0 off-by-one.
    om = {"d1": 10.0, "d2": 20.0, "d3": 30.0, "d4": 40.0}
    pw = {"d0": 99.0, "d1": 15.0, "d3": 33.0, "d4": 41.0}
    cc = cross_check_precip(om, pw)
    assert cc["n_overlap_days"] == 3
    assert cc["bias_mm"] == pytest.approx((5 + 3 + 1) / 3)


def test_cross_check_precip_empty_overlap():
    cc = cross_check_precip({}, {})
    assert cc["n_overlap_days"] == 0
    assert np.isnan(cc["bias_mm"])
    assert cc["max7d_open_meteo_mm"] == 0.0


@pytest.mark.skipif(not os.environ.get("FIREMOK_LIVE"), reason="live NASA POWER API; set FIREMOK_LIVE=1 to run")
def test_live_power_api_anchor_case():
    """May-2024 Guaíba point: POWER must show the storm days (live network)."""
    p = power_for_point(-30.03, -51.25, "2024-05-01", "2024-05-15")
    assert p["n_days"] == 15
    assert p["precip_total_mm"] > 100  # 74.8 + 27.8 + ... > 100 mm in 15 days
    assert p["precip_max7d_mm"] >= 100  # May 1-7 window is ~138 mm
