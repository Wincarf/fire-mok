"""Sentinel-1 RTC discovery via Microsoft Planetary Computer STAC (no auth)."""

import logging

import planetary_computer as pc
import pystac
from pystac_client import Client

from pipeline.stac import PC_STAC_URL
from pipeline.types import Scene

logger = logging.getLogger(__name__)

COLLECTION = "sentinel-1-rtc"


def _stac_client() -> Client:
    return Client.open(PC_STAC_URL, modifier=pc.sign_inplace)


def _item_to_scene(item: pystac.Item) -> Scene:
    assets = {k: v.href for k, v in item.assets.items() if k in ("vv", "vh")}
    return Scene(
        id=item.id,
        datetime=item.datetime.isoformat() if item.datetime else "",
        url=assets.get("vv", ""),
        bbox=tuple(item.bbox) if item.bbox else None,
        assets=assets,
    )


def search_s1_rtc(
    bbox: tuple[float, float, float, float], start: str, end: str
) -> list[Scene]:
    try:
        search = _stac_client().search(
            collections=[COLLECTION],
            bbox=list(bbox),
            datetime=f"{start}/{end}",
        )
        items = list(search.items())
    except Exception as exc:  # STAC/network failures degrade to no scenes
        logger.warning("S1 RTC STAC search failed: %s", exc)
        return []
    return [_item_to_scene(i) for i in items]


def scene_to_cog_url(scene: Scene, band: str) -> str:
    """Signed (SAS) URL for one band of a S1 RTC scene."""
    unsigned = scene.assets[band]
    return pc.sign(unsigned)


def scene_coverage(scene: Scene, aoi_bbox) -> float:
    """Fraction of the AOI covered by the scene footprint; 0 when unknown."""
    if not scene.bbox:
        return 0.0
    from shapely.geometry import box

    target = box(*aoi_bbox)
    return box(*scene.bbox).intersection(target).area / target.area
