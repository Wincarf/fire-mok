"""Shared types across SAR sources (NISAR, Sentinel-1) and feature dicts."""

from dataclasses import dataclass, field
from typing import Literal, TypedDict

RiskCategory = Literal["low", "moderate", "high", "critical"]


class MuniFeatures(TypedDict, total=False):
    """Municipality feature properties produced by the pipeline and consumed
    by risk_score / build_action_plan / the API geojson layer.

    total=False: producers populate different subsets (meteo vs exposure vs
    terrain stages); consumers coerce missing/invalid via util.num_or.
    """

    code: str
    name: str
    population: int
    # flood observation (fraction of municipal area flooded)
    flood_frac: float
    flooded_m2: float
    pop_exposed: float
    pop_method: str
    # meteo
    precip_total_mm: float
    precip_max7d_mm: float
    precip_max_day_mm: float
    precip_forecast_max7d_mm: float
    soil_moisture_mean: float
    soil_moisture_max: float
    n_days: int
    missing_frac: float
    precip_source: str
    nasa_power_precip_max7d_mm: float
    power_vs_openmeteo_bias_mm: float
    power_vs_openmeteo_maxabsdiff_mm: float
    # terrain
    sus_frac: float
    elev_min: float
    elev_mean: float
    slope_mean: float
    # derived risk
    risk_score: float
    risk_category: RiskCategory


@dataclass
class Scene:
    id: str
    datetime: str
    url: str
    # scene footprint (min_lon, min_lat, max_lon, max_lat) — never the query
    # bbox; None when the provider does not report it
    bbox: tuple[float, float, float, float] | None
    # band name -> unsigned asset href (STAC sources); empty for single-file products
    assets: dict[str, str] = field(default_factory=dict)
