"""Deterministic per-municipality action plan (rules, no LLM).

Actions are driven by the risk category plus which component fired.
Strings are English — they reach the UI and the manager-facing report.
"""

from pipeline.types import MuniFeatures, RiskCategory

SEVERITY_ORDER: list[RiskCategory] = ["low", "moderate", "high", "critical"]


def build_action_plan(m: MuniFeatures) -> dict:
    from pipeline.util import num_or

    def _num(key: str, default: float = 0.0) -> float:
        return num_or(m.get(key, default), default)

    cat = m.get("risk_category", "low")
    actions: list[str] = []
    reasons: list[str] = []
    pop_exposed = int(_num("pop_exposed"))

    if cat in ("high", "critical"):
        reasons.append(f"risk category {cat}")
        actions += [
            f"Mobilize shelters for ~{pop_exposed:,} potentially exposed people",
            "Pre-position rescue teams and boats in the floodplain areas",
            "Issue a preventive warning to riverside communities",
        ]
    elif cat == "moderate":
        reasons.append("risk category moderate")
        actions += [
            "Inspect recurring flooding spots and storm drains",
            "Keep on-call teams ready for isolated incidents",
        ]
    else:
        actions += [
            "Keep the routine urban drainage cleaning schedule",
            "Update the hazard-area registry in the master plan",
        ]

    flood_frac = _num("flood_frac")
    if flood_frac > 0.02:
        reasons.append(f"{100*flood_frac:.1f}% of the municipal area with observed flooding")
        actions.append("Prioritize inspections and unclogging in sectors with water observed in the SAR")
    precip_max7d = _num("precip_max7d_mm")
    if precip_max7d > 250:
        reasons.append(f"{precip_max7d:.0f} mm in 7 days")
        actions.append("Monitor river levels and reinforce the warning if intense rain returns")
    precip_fc = _num("precip_forecast_max7d_mm")
    if precip_fc > 100:
        reasons.append(f"forecast of {precip_fc:.0f} mm over the next 7 days")
        actions.append("Prepare a preventive alert for next week — forecast rain over already saturated soil")
    soil = _num("soil_moisture_mean")
    if soil > 0.4:
        reasons.append("soil near saturation")
        actions.append("Watch slopes and infiltration areas — saturated soil reduces absorption")
    sus_frac = _num("sus_frac")
    if sus_frac > 0.5:
        reasons.append(f"{100*sus_frac:.0f}% of the territory on low, flat terrain")
        actions.append("Review evacuation routes and meeting points in floodplain areas")
    if pop_exposed > 10_000:
        reasons.append(f"~{pop_exposed:,} people in the potentially affected area")
        actions.append("Trigger the intermunicipal/regional contingency plan")

    return {
        "municipality": m.get("name", ""),
        "priority": cat,
        "reasons": reasons or ["indicators within the normal range"],
        "actions": actions,
    }
