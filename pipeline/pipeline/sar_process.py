"""SAR scene raster processing: dB conversion, AOI crop, COG output."""

import logging
from pathlib import Path

import numpy as np
import rasterio
from rasterio.warp import transform_bounds
from rasterio.windows import from_bounds

from pipeline.aoi import AOI
from pipeline.types import Scene

logger = logging.getLogger(__name__)


def to_db(linear: np.ndarray, nodata: float = np.nan) -> np.ndarray:
    arr = np.asarray(linear, dtype="float32")
    out = np.full(arr.shape, nodata, dtype="float32")
    np.log10(arr, out=out, where=arr > 0)
    out[arr > 0] *= 10.0
    return out


def crop_to_aoi(url: str, aoi: AOI, out: Path) -> Path:
    """Crop a raster (local path or URL) to the AOI bbox; nodata-fills partial overlap."""
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(url) as src:
        bounds = transform_bounds(f"EPSG:{aoi.epsg}", src.crs, *aoi.bbox)
        window = from_bounds(*bounds, transform=src.transform)
        data = src.read(1, window=window, boundless=True, fill_value=np.nan)
        transform = src.window_transform(window)
        profile = {
            "driver": "COG",
            "height": data.shape[0],
            "width": data.shape[1],
            "count": 1,
            "dtype": "float32",
            "crs": src.crs,
            "transform": transform,
            "nodata": np.nan,
            "compress": "deflate",
        }
        with rasterio.open(out, "w", **profile) as dst:
            dst.write(np.asarray(data, dtype="float32"), 1)
    return out


def _band_url(scene: Scene, band: str) -> str:
    if scene.assets:
        from pipeline.sar_search import scene_to_cog_url

        return scene_to_cog_url(scene, band)
    return scene.url


def process_scene(scene: Scene, band: str, aoi: AOI, out_dir: Path) -> Path:
    out_dir = Path(out_dir)
    out = out_dir / f"{scene.id}_{band}_db.tif"
    url = _band_url(scene, band)
    crop_to_aoi(url, aoi, out)
    with rasterio.open(out) as ds:
        linear = ds.read(1)
        profile = ds.profile
    db = to_db(linear)
    with rasterio.open(out, "w", **profile) as dst:
        dst.write(db.astype("float32"), 1)
    logger.info("processed %s band %s -> %s", scene.id, band, out)
    return out
