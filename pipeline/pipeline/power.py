"""NASA POWER (LARC) daily precipitation — independent cross-check source.

MERRA-2 reanalysis, no auth required. Used two ways:
- cross-check against Open-Meteo (two independent estimates of the same
  quantity; large divergence flags a data problem before it reaches the index)
- fallback when Open-Meteo fails

API: https://power.larc.nasa.gov/api/temporal/daily/point
"""

import logging

import httpx
import numpy as np

from pipeline.meteo import rolling_max

logger = logging.getLogger(__name__)

POWER_URL = "https://power.larc.nasa.gov/api/temporal/daily/point"
FILL = -999.0  # POWER fill value for missing data


def fetch_power_daily(lat: float, lon: float, start: str, end: str, timeout: float = 90.0) -> dict:
    """Daily PRECTOTCORR (mm/day) for one point; dates 'YYYY-MM-DD'."""
    params = {
        "parameters": "PRECTOTCORR",
        "community": "AG",
        "longitude": lon,
        "latitude": lat,
        "start": start.replace("-", ""),
        "end": end.replace("-", ""),
        "format": "JSON",
        "time-standard": "LST",
    }
    r = httpx.get(POWER_URL, params=params, timeout=timeout)
    r.raise_for_status()
    return r.json()


def parse_power_precip(payload: dict) -> tuple[dict[str, float], int]:
    """POWER JSON -> ({'YYYY-MM-DD': mm}, n_missing). Fill values dropped."""
    series = payload["properties"]["parameter"]["PRECTOTCORR"]
    out, n_missing = {}, 0
    for ymd, v in series.items():
        if v is None or float(v) == FILL:
            n_missing += 1
            continue
        out[f"{ymd[:4]}-{ymd[4:6]}-{ymd[6:]}"] = float(v)
    return out, n_missing


def cross_check_precip(open_meteo_daily: dict[str, float], power_daily: dict[str, float]) -> dict:
    """Compare daily series on shared dates; bias and max-abs divergence in mm.

    Both args are {'YYYY-MM-DD': mm} with missing days already dropped —
    positional alignment would silently shift whenever either source drops a
    day, so the join is on dates. Empty overlap -> NaNs.
    """
    om_vals = [open_meteo_daily[d] for d in sorted(open_meteo_daily)]
    pw_vals = [power_daily[d] for d in sorted(power_daily)]
    dates = sorted(set(open_meteo_daily) & set(power_daily))
    if not dates:
        return {"n_overlap_days": 0, "bias_mm": float("nan"),
                "max_abs_diff_mm": float("nan"),
                "max7d_open_meteo_mm": rolling_max(om_vals, 7),
                "max7d_power_mm": rolling_max(pw_vals, 7)}
    om = np.asarray([open_meteo_daily[d] for d in dates], dtype="float32")
    pw = np.asarray([power_daily[d] for d in dates], dtype="float32")
    return {
        "n_overlap_days": len(dates),
        "bias_mm": float(np.mean(pw - om)),
        "max_abs_diff_mm": float(np.max(np.abs(pw - om))),
        "max7d_open_meteo_mm": rolling_max(om_vals, 7),
        "max7d_power_mm": rolling_max(pw_vals, 7),
    }


def power_fallback_features(p: dict) -> dict:
    """Open-Meteo-shaped feature dict from a power_for_point payload.

    Single place that defines the Open-Meteo -> POWER fallback schema, so the
    caller doesn't rebuild (and drift from) the meteo feature contract.
    """
    vals = list(p["daily"].values())
    return {
        "precip_total_mm": p["precip_total_mm"],
        "precip_max7d_mm": p["precip_max7d_mm"],
        "precip_max_day_mm": float(np.max(vals)) if vals else 0.0,
        "soil_moisture_mean": np.nan,
        "soil_moisture_max": np.nan,
        "n_days": p["n_days"],
        "missing_frac": p["n_missing"] / max(p["n_days"], 1),
        "precip_source": "NASA POWER MERRA-2 (fallback)",
    }


def power_for_point(lat: float, lon: float, start: str, end: str) -> dict:
    """Fetch + parse + summarize for one point (7-day max, missing count)."""
    daily, n_missing = parse_power_precip(fetch_power_daily(lat, lon, start, end))
    vals = list(daily.values())
    return {
        "precip_total_mm": float(np.sum(vals)),
        "precip_max7d_mm": rolling_max(vals, 7),
        "n_days": len(daily),
        "n_missing": n_missing,
        "daily": daily,
    }
