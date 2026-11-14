"""Terrain susceptibility: low + flat terrain floods first (screening layer).

Requires a DEM in metres on a north-up metric projected grid (geomaster gate).
"""

import logging
from pathlib import Path

import numpy as np
from affine import Affine

logger = logging.getLogger(__name__)


def slope_deg(dem: np.ndarray, transform: Affine) -> np.ndarray:
    """Horn's method slope in degrees; NaN where stencil hits nodata."""
    dem = np.asarray(dem, dtype="float32")
    px, py = abs(transform.a), abs(transform.e)
    dz_dx = np.gradient(dem, px, axis=1)
    dz_dy = np.gradient(dem, py, axis=0)
    slope = np.degrees(np.arctan(np.hypot(dz_dx, dz_dy)))
    slope[np.isnan(dem)] = np.nan
    # spread nodata to neighbours (gradient already used them)
    from scipy.ndimage import maximum_filter

    nan_mask = maximum_filter(np.isnan(dem).astype("uint8"), size=3).astype(bool)
    slope[nan_mask] = np.nan
    return slope


def susceptibility(
    dem: np.ndarray, transform: Affine, elev_thresh_m: float, slope_thresh_deg: float
) -> np.ndarray:
    """Boolean screening mask: elevation below threshold AND slope below threshold."""
    s = slope_deg(dem, transform)
    out = (dem < elev_thresh_m) & (s < slope_thresh_deg)
    return out & ~np.isnan(dem) & ~np.isnan(s)
