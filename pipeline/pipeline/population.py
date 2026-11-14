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
from rasterio.warp import Resampling, reproject

logger = logging.getLogger(__name__)

WORLDPOP_URL = (
    "https://data.worldpop.org/GIS/Population/Global_2000_2020/2020/BRA/bra_ppp_2020.tif"
)


def density_from_counts(
    counts: np.ndarray, src_transform, src_crs, dst_transform, dst_crs, dst_shape
) -> np.ndarray | None:
    """Count-preserving density (people per dst pixel) from a count raster.

    Counts -> density (pop/m²) -> average-resample onto dst grid -> scale back
    to per-pixel counts, so any resolution change keeps totals invariant.
    Non-populated/nodata source cells are zero-filled (0 people — conservative
    for exposure) instead of NaN, because GDAL's average ignores NaN without
    area weighting and totals would inflate on coarser grids.
    """
    src_px_area = abs(src_transform.a * src_transform.e)
    dst_px_area = abs(dst_transform.a * dst_transform.e)
    c = np.where(np.isnan(counts), 0.0, counts).astype("float32")
    if c.max() <= 0:
        return None
    density_src = c / src_px_area
    density_dst = np.full(dst_shape, np.nan, dtype="float32")
    reproject(
        density_src, density_dst,
        src_transform=src_transform, src_crs=src_crs,
        dst_transform=dst_transform, dst_crs=dst_crs,
        resampling=Resampling.average, src_nodata=np.nan, dst_nodata=np.nan,
    )
    return density_dst * dst_px_area  # people per dst pixel


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
                from rasterio.windows import from_bounds
                from rasterio.warp import transform_bounds

                win = from_bounds(*bbox_4326, transform=src.transform)
                counts = src.read(1, window=win, boundless=True, fill_value=src.nodata or 0)
                transform = src.window_transform(win)
                crs = src.crs
                cache_path.parent.mkdir(parents=True, exist_ok=True)
                profile = {
                    "driver": "COG", "height": counts.shape[0], "width": counts.shape[1],
                    "count": 1, "dtype": "float32", "crs": crs, "transform": transform,
                    "nodata": np.nan, "compress": "deflate",
                }
                with rasterio.open(cache_path, "w", **profile) as dst:
                    dst.write(counts.astype("float32"), 1)
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
