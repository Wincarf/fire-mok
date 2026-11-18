"""SAR scene raster processing: dB conversion, AOI crop, COG output."""

import logging
from pathlib import Path

import numpy as np
import rasterio
from rasterio.warp import transform_bounds
from rasterio.windows import from_bounds

from pipeline.aoi import AOI
from pipeline.raster import write_float32_cog
from pipeline.types import Scene

logger = logging.getLogger(__name__)


def to_db(linear: np.ndarray, nodata: float = np.nan) -> np.ndarray:
    arr = np.asarray(linear, dtype="float32")
    out = np.full(arr.shape, nodata, dtype="float32")
    np.log10(arr, out=out, where=arr > 0)
    out[arr > 0] *= 10.0
    return out


def _read_aoi_window(url: str, aoi: AOI):
    """Read band 1 clipped to the AOI bbox; returns (data, transform, crs).

    boundless=True: partial overlap fills with NaN outside the source.
    """
    with rasterio.open(url) as src:
        bounds = transform_bounds(f"EPSG:{aoi.epsg}", src.crs, *aoi.bbox)
        window = from_bounds(*bounds, transform=src.transform)
        data = src.read(1, window=window, boundless=True, fill_value=np.nan)
        return np.asarray(data, dtype="float32"), src.window_transform(window), src.crs


def crop_to_aoi(url: str, aoi: AOI, out: Path) -> Path:
    """Crop a raster (local path or URL) to the AOI bbox; nodata-fills partial overlap."""
    data, transform, crs = _read_aoi_window(url, aoi)
    return write_float32_cog(data, transform, crs, out)


def _band_url(scene: Scene, band: str) -> str:
    if scene.assets:
        from pipeline.sar_search import scene_to_cog_url

        return scene_to_cog_url(scene, band)
    return scene.url


def process_scene(scene: Scene, band: str, aoi: AOI, out_dir: Path) -> Path:
    """Crop + linear->dB + write in one pass (no read-rewrite round trip)."""
    out_dir = Path(out_dir)
    out = out_dir / f"{scene.id}_{band}_db.tif"
    linear, transform, crs = _read_aoi_window(_band_url(scene, band), aoi)
    write_float32_cog(to_db(linear), transform, crs, out)
    logger.info("processed %s band %s -> %s", scene.id, band, out)
    return out
