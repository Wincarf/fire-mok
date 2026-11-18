"""Precipitation + soil-moisture features from Open-Meteo (no auth required)."""

import json
import logging
import time
from pathlib import Path

import httpx
import numpy as np

logger = logging.getLogger(__name__)

ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
CACHE = Path(__file__).resolve().parents[2] / "data" / "meteo"


def fetch_open_meteo(lat: float, lon: float, start: str, end: str, timeout: float = 60.0) -> dict:
    """Fetch with 429/5xx retry (shared egress IPs get throttled often).

    Raises RuntimeError after 3 attempts — callers already decide the
    fallback; a non-200 body must never be silently parsed as empty series.
    """
    params = {
        "latitude": lat,
        "longitude": lon,
        "start_date": start,
        "end_date": end,
        "daily": "precipitation_sum",
        "hourly": "soil_moisture_0_to_7cm",
        "timezone": "America/Sao_Paulo",
    }
    r = None
    for attempt in range(3):
        r = httpx.get(ARCHIVE_URL, params=params, timeout=timeout)
        if r.status_code == 200:
            return r.json()
        wait = int(r.headers.get("Retry-After") or 0) or 10 * (attempt + 1)
        if r.status_code == 429 and wait > 600:
            # hard per-IP block (hours) — retrying this run is pointless,
            # go straight to the caller's fallback
            raise RuntimeError(f"open-meteo hard rate limit: retry after {wait}s")
        logger.warning("open-meteo %s (attempt %d/3), waiting %ss", r.status_code, attempt + 1, wait)
        if attempt < 2:
            time.sleep(min(wait, 45))
    raise RuntimeError(f"open-meteo unavailable after 3 attempts (last HTTP {r.status_code})")


def _series(payload: dict, block: str, var: str) -> list:
    return payload.get(block, {}).get(var) or []


def _clean(vals: list) -> tuple[list[float], int]:
    good = [float(v) for v in vals if v is not None]
    return good, len(vals) - len(good)


def parse_open_meteo(payload: dict) -> dict:
    """Extract series + missingness counts. Missing values are reported, never imputed."""
    precip, miss_p = _clean(_series(payload, "daily", "precipitation_sum"))
    soil, miss_s = _clean(_series(payload, "hourly", "soil_moisture_0_to_7cm"))
    # date-keyed precip for cross-source alignment (positions shift when days
    # are dropped, so the POWER cross-check must join on dates)
    precip_daily = {
        d: float(v)
        for d, v in zip(
            _series(payload, "daily", "time"),
            _series(payload, "daily", "precipitation_sum"),
        )
        if v is not None
    }
    return {
        "precip": precip,
        "precip_daily": precip_daily,
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

    if key.exists():
        payload = json.loads(key.read_text())
    else:
        payload = fetch_open_meteo(lat, lon, start, end)
        key.write_text(json.dumps(payload))
    return parse_open_meteo(payload)


def meteo_for_point(lat: float, lon: float, start: str, end: str) -> dict:
    """Fetch + aggregate for one point, with file cache."""
    return aggregate_meteo(load_parse(lat, lon, start, end))


FORECAST_URL = "https://api.open-meteo.com/v1/forecast"


def forecast_max7d(lat: float, lon: float, days: int = 7, timeout: float = 60.0) -> dict:
    """Forward-looking 7-day precipitation max (Open-Meteo forecast API).

    Returns {'precip_forecast_max7d_mm', 'n_forecast_days', 'raw'} where 'raw'
    is the JSON-encoded daily series for provenance. HTTP/network errors
    propagate — caller decides the fallback (index treats missing forecast
    as 0).
    """
    params = {
        "latitude": lat,
        "longitude": lon,
        "daily": "precipitation_sum",
        "forecast_days": days,
        "timezone": "America/Sao_Paulo",
    }
    r = httpx.get(FORECAST_URL, params=params, timeout=timeout)
    r.raise_for_status()
    vals = r.json().get("daily", {}).get("precipitation_sum") or []
    good = [float(v) for v in vals if v is not None]
    return {
        "precip_forecast_max7d_mm": rolling_max(good, days),
        "n_forecast_days": len(good),
        "raw": json.dumps(vals),
    }
