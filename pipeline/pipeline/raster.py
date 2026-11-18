"""Shared raster helpers: reproject-onto-grid and mask COG writing."""

from pathlib import Path

import numpy as np
import rasterio
from rasterio.warp import Resampling, reproject


def reproject_to_grid(
    src_arr: np.ndarray,
    src_transform,
    src_crs,
    dst_transform,
    dst_crs,
    dst_shape: tuple[int, int],
    resampling: Resampling = Resampling.bilinear,
) -> np.ndarray:
    """Reproject src onto the (dst_transform, dst_crs, dst_shape) grid.

    Float32 in/out, NaN nodata both ways — used to put a secondary raster
    (other scene, context layer) on the working grid before pixel math.
    """
    dst = np.full(dst_shape, np.nan, dtype="float32")
    reproject(
        np.asarray(src_arr, dtype="float32"), dst,
        src_transform=src_transform, src_crs=src_crs,
        dst_transform=dst_transform, dst_crs=dst_crs,
        resampling=resampling, src_nodata=np.nan, dst_nodata=np.nan,
    )
    return dst


def write_mask_cog(mask: np.ndarray, src_profile: dict, out: Path) -> Path:
    """Write a boolean/uint8 mask as a compressed COG on the source grid."""
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    profile = dict(src_profile)
    for key in ("tiled", "blockxsize", "blockysize", "interleave"):
        profile.pop(key, None)
    profile.update(driver="COG", dtype="uint8", count=1, nodata=None, compress="deflate")
    with rasterio.open(out, "w", **profile) as dst:
        dst.write(mask.astype("uint8"), 1)
    return out


def write_float32_cog(data: np.ndarray, transform, crs, out: Path) -> Path:
    """Write a single-band float32 raster as a compressed COG (NaN nodata)."""
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(
        out,
        "w",
        driver="COG",
        height=data.shape[0],
        width=data.shape[1],
        count=1,
        dtype="float32",
        crs=crs,
        transform=transform,
        nodata=np.nan,
        compress="deflate",
    ) as dst:
        dst.write(np.asarray(data, dtype="float32"), 1)
    return out
