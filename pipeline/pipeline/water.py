"""Water/flood detection from SAR backscatter (sigma0 dB) rasters."""

from pathlib import Path

import geopandas as gpd
import numpy as np
import rasterio
from rasterio.features import shapes
from shapely.geometry import shape


def water_mask(db: np.ndarray, thresh_db: float = -15.0) -> np.ndarray:
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


def mask_to_polygons(mask: np.ndarray, transform, crs) -> gpd.GeoDataFrame:
    geoms = [
        (shape(geom), int(val))
        for geom, val in shapes(mask.astype("uint8"), mask=mask.astype(bool), transform=transform)
        if val == 1
    ]
    return gpd.GeoDataFrame({"value": [v for _, v in geoms]}, geometry=[g for g, _ in geoms], crs=crs)


def write_mask_cog(mask: np.ndarray, src_profile: dict, out: Path) -> Path:
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    profile = dict(src_profile)
    profile.update(
        driver="COG",
        dtype="uint8",
        count=1,
        nodata=None,
        compress="deflate",
    )
    with rasterio.open(out, "w", **profile) as dst:
        dst.write(mask.astype("uint8"), 1)
    return out
