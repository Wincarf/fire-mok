"""Shared types across SAR sources (NISAR, Sentinel-1)."""

from dataclasses import dataclass


@dataclass
class Scene:
    id: str
    datetime: str
    url: str
    bbox: tuple[float, float, float, float]
