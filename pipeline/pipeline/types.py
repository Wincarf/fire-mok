"""Shared types across SAR sources (NISAR, Sentinel-1)."""

from dataclasses import dataclass, field


@dataclass
class Scene:
    id: str
    datetime: str
    url: str
    bbox: tuple[float, float, float, float]
    # band name -> unsigned asset href (STAC sources); empty for single-file products
    assets: dict[str, str] = field(default_factory=dict)
