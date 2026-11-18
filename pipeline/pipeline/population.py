"""Gridded population exposure (WorldPop 2020, 100 m, CC-BY 4.0).

Replaces the uniform-density assumption in pop_exposed: population is summed
over the actual flooded pixels using a real population grid.

WorldPop country rasters live at
https://data.worldpop.org/GIS/Population/Global_2000_2020/2020/{ISO3}/{iso3}_ppp_2020.tif
(~4 GB for Brazil) — we only read the AOI window over HTTP (GDAL /vsicurl/
needs a server/proxy that supports Range requests; if it does not, the
fetch fails gracefully and exposure falls back to the uniform estimate).

Alternative source documented in docs/methodology.md: NASA SEDAC GPW v4
(30 arc-sec). Same density math applies.
"""

import logging
from pathlib import Path

import numpy as np
import rasterio
from rasterio.warp import Resampling, reproject, transform_bounds
from rasterio.windows import from_bounds

from pipeline.raster import reproject_to_grid, write_float32_cog

logger = logging.getLogger(__name__)

WORLDPOP_URL = (
    "https://data.worldpop.org/GIS/Population/Global_2000_2020/2020/BRA/bra_ppp_2020.tif"
)


def density_from_counts(
    counts: np.ndarray, src_transform, src_crs, dst_transform, dst_crs, dst_shape
) -> np.ndarray | None:
    """Count-preserving density (people per dst pixel) from a count raster.

    GDAL's sum resample area-weights contributing source pixels, so totals
    survive CRS and resolution changes — mixing transform units (deg² vs m²)
    in a manual density conversion would corrupt them instead.
    Non-populated/nodata source cells are zero-filled (0 people — conservative
    for exposure) instead of NaN, which sum resampling would propagate.
    """
    c = np.where(np.isnan(counts) | (counts < 0), 0.0, counts).astype("float32")
    if c.max() <= 0:
        return None
    return reproject_to_grid(
        c, src_transform, src_crs, dst_transform, dst_crs,
        dst_shape, resampling=Resampling.sum,
    )


def fetch_pop_density_grid(
    bbox_4326, dst_transform, dst_crs, dst_shape, cache_path: Path
) -> np.ndarray | None:
    """Population density (people per dst pixel) on the target grid, or None.

    WorldPop country raster via /vsicurl/ AOI window (needs HTTP Range support)
    or local cache; any failure returns None (uniform-density fallback).
    """
    cache_path = Path(cache_path)
    try:
        if cache_path.exists():
            with rasterio.open(cache_path) as src:
                counts, transform, crs = src.read(1), src.transform, src.crs
        else:
            with rasterio.open(f"/vsicurl/{WORLDPOP_URL}") as src:
                win = from_bounds(*bbox_4326, transform=src.transform)
                counts = src.read(1, window=win, boundless=True, fill_value=src.nodata or 0)
                transform = src.window_transform(win)
                crs = src.crs
                write_float32_cog(counts, transform, crs, cache_path)
        return density_from_counts(counts, transform, crs, dst_transform, dst_crs, dst_shape)
    except Exception as exc:
        logger.warning("population grid unavailable (%s) — uniform-density fallback", exc)
        return None


def exposed_population(
    density_grid: np.ndarray | None, inside: np.ndarray, mask: np.ndarray,
    px_area: float, population: int, flood_frac: float,
) -> tuple[int, str]:
    """Sum real grid population inside (flood ∩ municipality); fallback uniform.

    Returns (pop_exposed, method) where method documents which estimate was used.
    """
    if density_grid is not None:
        sel = inside & mask & ~np.isnan(density_grid)
        if sel.any():
            return int(round(float(density_grid[sel].sum()))), "worldpop_grid"
    return int(round(population * flood_frac)), "uniform_density"
