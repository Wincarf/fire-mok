from pipeline.action_plan import build_action_plan


def _muni(**kw):
    base = {
        "name": "Test",
        "risk_category": "low",
        "flood_frac": 0.0,
        "pop_exposed": 0,
        "precip_max7d_mm": 0.0,
        "soil_moisture_mean": 0.0,
        "sus_frac": 0.0,
    }
    base.update(kw)
    return base


def test_critical_gets_evacuation_actions():
    plan = build_action_plan(_muni(risk_category="critical", flood_frac=0.12, pop_exposed=5000))
    texts = " ".join(plan["actions"]).lower()
    assert "evac" in texts or "abrigo" in texts
    assert plan["priority"] == "critical"
    assert len(plan["actions"]) >= 3


def test_zero_flood_still_returns_checklist():
    # review focus: municipality with zero flood must get generic actions, no div0
    plan = build_action_plan(_muni(risk_category="low"))
    assert plan["actions"]
    assert isinstance(plan["actions"], list)
    assert plan["priority"] == "low"


def test_high_precip_adds_monitoring():
    plan = build_action_plan(_muni(risk_category="moderate", precip_max7d_mm=350))
    texts = " ".join(plan["actions"]).lower()
    assert "chuva" in texts or "drenagem" in texts or "monitor" in texts


def test_pop_exposed_scales_shelter_text():
    small = build_action_plan(_muni(risk_category="critical", flood_frac=0.2, pop_exposed=500))
    big = build_action_plan(_muni(risk_category="critical", flood_frac=0.2, pop_exposed=50000))
    assert any("500" in a for a in small["actions"])
    assert any("50000" in a or "50.000" in a for a in big["actions"])


def test_plan_has_reasons():
    plan = build_action_plan(_muni(risk_category="high", flood_frac=0.08, precip_max7d_mm=320))
    assert plan["reasons"]
    assert len(plan["reasons"]) >= 1
