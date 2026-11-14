"""Municipal flood-risk screening index (0-1).

Weighted linear blend of four normalized inputs, weights documented in
docs/methodology.md. Screening score only — NOT a civil-defense warning.

The precipitation component uses the LARGER of the observed 7-day max
(archive) and the forecast 7-day max: forecast rain above what already fell
is the forward-looking flood driver. Missing forecast contributes 0.
"""

PRECIP_CAP_MM = 300.0      # May-2024 peak 7-day totals were ~300-360 mm
SOIL_CAP = 0.5             # saturation ~0.45-0.5 m3/m3 in the region
FLOOD_CAP = 0.15           # 15% of municipal area flooded ~= catastrophic
WEIGHTS = {
    "precip": 0.30,
    "soil": 0.20,
    "terrain": 0.25,
    "observed": 0.25,
}


def _clamp(x: float) -> float:
    return max(0.0, min(1.0, x))


def _num(v) -> float:
    """Unknown input (None/nan/invalid) contributes 0 — provenance fields
    (precip_source, missing_frac) carry the caveat, the score stays finite."""
    try:
        x = float(v)
    except (TypeError, ValueError):
        return 0.0
    return 0.0 if x != x else x  # nan != nan


def risk_score(f: dict) -> float:
    precip_mm = max(
        _num(f.get("precip_max7d_mm")),
        _num(f.get("precip_forecast_max7d_mm")),
    )
    p = _clamp(precip_mm / PRECIP_CAP_MM)
    s = _clamp(_num(f.get("soil_moisture_mean")) / SOIL_CAP)
    t = _clamp(f.get("sus_frac", 0.0))
    o = _clamp(f.get("flood_frac", 0.0) / FLOOD_CAP)
    return _clamp(
        WEIGHTS["precip"] * p
        + WEIGHTS["soil"] * s
        + WEIGHTS["terrain"] * t
        + WEIGHTS["observed"] * o
    )


def categorize(score: float) -> str:
    if score <= 0.25:
        return "low"
    if score <= 0.50:
        return "moderate"
    if score <= 0.75:
        return "high"
    return "critical"
