import importlib.util
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

from pipeline.risk import risk_score

_spec = importlib.util.spec_from_file_location(
    "update_latest", Path(__file__).resolve().parents[1] / "scripts" / "update_latest.py"
)
ul = importlib.util.module_from_spec(_spec)
sys.modules["update_latest"] = ul
_spec.loader.exec_module(ul)

AOI = (-51.6, -30.4, -50.7, -29.7)


def _scene(sid, bbox=AOI):
    return SimpleNamespace(id=sid, bbox=bbox, datetime="", url="", assets={})


def test_pass_token_and_sensing_time():
    sid = "S1A_IW_GRDH_1SDV_20240511T084943_20240511T085008_053821_068A6E_rtc"
    assert ul.pass_token(sid) == "0849"
    t = ul.sensing_time(sid)
    assert (t.year, t.month, t.day) == (2024, 5, 11)


def test_choose_pair_same_pass_preferred():
    a = _scene("S1A_..._20240514T084942_..._rtc")
    b = _scene("S1A_..._20240502T084955_..._rtc")
    c = _scene("S1B_..._20240508T090001_..._rtc")  # different pass, intermediate date
    pair = ul.choose_pair([c, a, b], AOI)
    assert pair[0].id == a.id and pair[1].id == b.id  # skips c (different pass)


def test_choose_pair_falls_back_to_previous_scene():
    a = _scene("S1A_..._20240514T084942_..._rtc")
    c = _scene("S1B_..._20240508T090001_..._rtc")
    pair = ul.choose_pair([a, c], AOI)
    assert pair[0].id == a.id and pair[1].id == c.id


def test_choose_pair_needs_two_scenes():
    assert ul.choose_pair([_scene("S1A_..._20240514T084942_..._rtc")], AOI) is None


def test_choose_pair_ignores_partial_coverage():
    partial = _scene("S1A_..._20240514T084942_..._rtc", bbox=(-51.6, -30.4, -51.4, -30.2))
    ok = _scene("S1A_..._20240510T084944_..._rtc")
    # partial scene never anchors: with only one full-coverage scene there is no pair
    assert ul.choose_pair([partial, ok], AOI) is None
    # two full scenes beside a newer partial: the partial is skipped entirely
    ok2 = _scene("S1A_..._20240502T084955_..._rtc")
    pair = ul.choose_pair([partial, ok, ok2], AOI)
    assert pair[0].id == ok.id and pair[1].id == ok2.id


def test_risk_score_uses_forecast_when_bigger():
    base = {"precip_max7d_mm": 100.0, "soil_moisture_mean": 0.2, "sus_frac": 0.4, "flood_frac": 0.05}
    r1 = risk_score(base)
    r2 = risk_score({**base, "precip_forecast_max7d_mm": 300.0})
    assert r2 > r1
    # forecast above the cap saturates only the precip component
    assert r2 == pytest.approx(0.30 + 0.20 * 0.4 + 0.25 * 0.4 + 0.25 * (0.05 / 0.15), abs=1e-6)


def test_risk_score_missing_forecast_is_zero():
    base = {"precip_max7d_mm": 300.0, "soil_moisture_mean": 0.5, "sus_frac": 1.0, "flood_frac": 0.15}
    assert risk_score(base) == pytest.approx(1.0)
    assert risk_score({**base, "precip_forecast_max7d_mm": None}) == pytest.approx(1.0)


def test_action_plan_forecast_rule():
    from pipeline.action_plan import build_action_plan

    plan = build_action_plan({"risk_category": "moderate", "precip_forecast_max7d_mm": 150.0})
    assert any("previsão de 150 mm" in r for r in plan["reasons"])
    assert any("alerta preventivo" in a for a in plan["actions"])
    quiet = build_action_plan({"risk_category": "low", "precip_forecast_max7d_mm": 20.0})
    assert not any("previsão" in r for r in quiet["reasons"])


def test_forecast_parse_contract():
    from pipeline.meteo import forecast_max7d  # importable; network errors propagate

    import inspect

    sig = inspect.signature(forecast_max7d)
    assert sig.parameters["days"].default == 7
