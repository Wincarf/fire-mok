"""Context masks from ESA WorldCover 10 m land cover (Planetary Computer).

WorldCover v200 (2021) class values:
10 tree · 20 shrub · 30 grass · 40 crop · 50 built-up · 60 bare · 70 snow/ice
80 permanent water · 90 herbaceous wetland · 95 mangroves · 100 moss/lichen

Urban surfaces and permanent water have low sigma0 and are the documented
false-positive sources of the threshold water mask (methodology.md section 6):
built-up areas flip bright-to-dark between scenes and pass change detection,
and permanent water at baseline nodata edges escapes the valid-baseline rule.
"""

import numpy as np
import rasterio
from rasterio.warp import Resampling, reproject

from pipeline.stac import PC_STAC_URL

WC_URBAN = 50
WC_WATER = 80

WC_COLLECTION = "esa-worldcover"
WC_DATETIME = "2021"  # single yearly epoch, v200


def permanent_water_mask(wc: np.ndarray) -> np.ndarray:
    """Permanent open water (class 80) — not flood, even when newly detected."""
    return np.asarray(wc) == WC_WATER


def urban_mask(wc: np.ndarray) -> np.ndarray:
    """Built-up surfaces (class 50) — known low-sigma0 false-positive source."""
    return np.asarray(wc) == WC_URBAN


def clean_flood_extent(
    flood: np.ndarray, permanent: np.ndarray, urban: np.ndarray
) -> tuple[np.ndarray, dict]:
    """Remove permanent-water and urban pixels from the flood extent.

    Args are boolean masks (permanent_water_mask / urban_mask outputs).
    Returns (cleaned mask, removal stats); urban removals are counted without
    double-counting pixels already removed as permanent water.
    """
    f = np.asarray(flood, dtype=bool)
    perm = np.asarray(permanent, dtype=bool)
    urb = np.asarray(urban, dtype=bool)
    cleaned = f & ~perm & ~urb
    stats = {
        "removed_permanent": int((f & perm).sum()),
        "removed_urban": int((f & urb & ~perm).sum()),
        "before_px": int(f.sum()),
        "after_px": int(cleaned.sum()),
    }
    return cleaned, stats


def fetch_worldcover_for_bounds(bounds_4326, dst_transform, dst_crs, dst_shape) -> np.ndarray:
    """WorldCover 2021 classes on the target grid.

    STAC search by geographic bounds, signed asset read, nearest-resampled
    onto dst grid. Returns uint8 classes, 0 = outside coverage/nodata —
    classes are categorical, interpolation would invent labels.
    """
    import planetary_computer as pc
    from pystac_client import Client
    from shapely.geometry import box, shape

    cat = Client.open(PC_STAC_URL)
    search = cat.search(collections=[WC_COLLECTION], bbox=list(bounds_4326), datetime=WC_DATETIME)
    items = list(search.items())
    if not items:
        raise RuntimeError(f"no {WC_COLLECTION} items for bounds {bounds_4326}")
    # the item with the largest overlap wins (AOI may straddle tiles)
    aoi = box(*bounds_4326)
    item = max(items, key=lambda i: shape(i.geometry).intersection(aoi).area / aoi.area)
    href = item.assets["map"].href
    signed = pc.sign(href)
    with rasterio.open(signed) as src:
        dst = np.zeros(dst_shape, dtype="uint8")
        reproject(
            rasterio.band(src, 1), dst,
            dst_transform=dst_transform, dst_crs=dst_crs,
            resampling=Resampling.nearest,
            src_nodata=0, dst_nodata=0,
        )
    return dst
