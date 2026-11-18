"""Small shared utilities."""

import math


def num_or(value, default: float = 0.0) -> float:
    """Coerce to finite float; None/NaN/invalid -> default.

    GeoJSON round-trips turn NaN/None into strings or null — provenance
    fields carry the caveat, the score stays finite.
    """
    try:
        x = float(value)
    except (TypeError, ValueError):
        return default
    return default if math.isnan(x) else x
