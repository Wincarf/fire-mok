"""Water/flood detection from SAR backscatter (sigma0 dB) rasters."""

import geopandas as gpd
import numpy as np
from rasterio.features import shapes
from shapely.geometry import shape


# Calibrated pick — see docs/methodology.md validation table (−17 dB chosen:
# −19 dB scores higher pixel agreement but under-detects useful water area).
DEFAULT_THRESH_DB = -17.0


def water_mask(db: np.ndarray, thresh_db: float = DEFAULT_THRESH_DB) -> np.ndarray:
    """Open water = very low backscatter. Nodata never counts as water."""
    arr = np.asarray(db, dtype="float32")
    return (arr < thresh_db) & ~np.isnan(arr)


def flood_extent(
    before_db: np.ndarray, after_db: np.ndarray, thresh_db: float = -15.0
) -> np.ndarray:
    """Pixels that became water after but were not water before.

    Requires valid 'before' data: missing baseline cannot prove change.
    """
    before = np.asarray(before_db, dtype="float32")
    return water_mask(after_db, thresh_db) & ~water_mask(before, thresh_db) & ~np.isnan(before)


def filter_min_area(mask: np.ndarray, min_px: int = 25) -> np.ndarray:
    """Drop connected blobs smaller than min_px (speckle cleanup)."""
    from scipy import ndimage

    labels, n = ndimage.label(mask)
    if n == 0:
        return mask
    sizes = np.bincount(labels.ravel())
    big = np.where(sizes >= min_px)[0]
    big = big[big != 0]  # label 0 = background
    return np.isin(labels, big)


def mask_to_polygons(mask: np.ndarray, transform, crs) -> gpd.GeoDataFrame:
    geoms = [
        (shape(geom), int(val))
        for geom, val in shapes(mask.astype("uint8"), mask=mask.astype(bool), transform=transform)
        if val == 1
    ]
    return gpd.GeoDataFrame({"value": [v for _, v in geoms]}, geometry=[g for g, _ in geoms], crs=crs)
