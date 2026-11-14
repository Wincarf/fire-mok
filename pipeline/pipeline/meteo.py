"""Precipitation + soil-moisture features from Open-Meteo (no auth required)."""

import logging
from pathlib import Path

import httpx
import numpy as np

logger = logging.getLogger(__name__)

ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
CACHE = Path(__file__).resolve().parents[2] / "data" / "meteo"


def fetch_open_meteo(lat: float, lon: float, start: str, end: str, timeout: float = 60.0) -> dict:
    params = {
        "latitude": lat,
        "longitude": lon,
        "start_date": start,
        "end_date": end,
        "daily": "precipitation_sum",
        "hourly": "soil_moisture_0_to_7cm",
        "timezone": "America/Sao_Paulo",
    }
    return httpx.get(ARCHIVE_URL, params=params, timeout=timeout).json()


def _series(payload: dict, block: str, var: str) -> list:
    return payload.get(block, {}).get(var) or []


def _clean(vals: list) -> tuple[list[float], int]:
    good = [float(v) for v in vals if v is not None]
    return good, len(vals) - len(good)


def parse_open_meteo(payload: dict) -> dict:
    """Extract series + missingness counts. Missing values are reported, never imputed."""
    precip, miss_p = _clean(_series(payload, "daily", "precipitation_sum"))
    soil, miss_s = _clean(_series(payload, "hourly", "soil_moisture_0_to_7cm"))
    return {
        "precip": precip,
        "soil": soil,
        "precip_total_mm": float(np.sum(precip)),
        "soil_moisture_mean": float(np.mean(soil)) if soil else np.nan,
        "n_days": len(_series(payload, "daily", "time")),
        "missing": {"precipitation_sum": miss_p, "soil_moisture_0_to_7cm": miss_s},
    }


def rolling_max(vals: list[float], window: int) -> float:
    if not vals:
        return 0.0
    if len(vals) <= window:
        return float(np.sum(vals))
    c = np.cumsum([0.0] + list(vals))
    return float(np.max(c[window:] - c[:-window]))


def aggregate_meteo(d: dict) -> dict:
    total_vals = d["n_days"] + len(d["soil"])
    n_missing = sum(d["missing"].values())
    return {
        "precip_total_mm": d["precip_total_mm"],
        "precip_max7d_mm": rolling_max(d["precip"], 7),
        "precip_max_day_mm": float(np.max(d["precip"])) if d["precip"] else 0.0,
        "soil_moisture_mean": d["soil_moisture_mean"],
        "soil_moisture_max": float(np.max(d["soil"])) if d["soil"] else np.nan,
        "n_days": d["n_days"],
        "missing_frac": n_missing / max(total_vals, 1),
    }


def load_parse(lat: float, lon: float, start: str, end: str) -> dict:
    """Fetch (file-cached) + parse — exposes the daily series for cross-checks."""
    CACHE.mkdir(parents=True, exist_ok=True)
    key = CACHE / f"meteo_{lat:.3f}_{lon:.3f}_{start}_{end}.json".replace("-", "m").replace(":", "_")
    import json

    if key.exists():
        payload = json.loads(key.read_text())
    else:
        payload = fetch_open_meteo(lat, lon, start, end)
        key.write_text(json.dumps(payload))
    return parse_open_meteo(payload)


def meteo_for_point(lat: float, lon: float, start: str, end: str) -> dict:
    """Fetch + aggregate for one point, with file cache."""
    return aggregate_meteo(load_parse(lat, lon, start, end))
