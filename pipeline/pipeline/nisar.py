"""NISAR GCOV access via ASF DAAC: search, download (Earthdata-gated), HDF5 -> COG."""

import logging
import netrc as netrc_mod
import os
from pathlib import Path

import asf_search as asf
import h5py
import numpy as np
import rasterio
from rasterio.transform import from_origin

from pipeline.types import Scene

logger = logging.getLogger(__name__)

URS_HOST = "urs.earthdata.nasa.gov"


def earthdata_session() -> "asf.ASFSession | None":
    user = os.environ.get("EARTHDATA_USER")
    password = os.environ.get("EARTHDATA_PASS")
    if user and password:
        return asf.ASFSession().auth_with_creds(user, password)
    try:
        if netrc_mod.netrc().authenticators(URS_HOST):
            # requests/ASFSession honors netrc via trust_env
            return asf.ASFSession()
    except (FileNotFoundError, netrc_mod.NetrcParseError):
        pass
    logger.warning("no Earthdata credentials (env EARTHDATA_USER/PASS or netrc)")
    return None


def _bbox_to_wkt(bbox: tuple[float, float, float, float]) -> str:
    min_lon, min_lat, max_lon, max_lat = bbox
    return (
        f"POLYGON(({min_lon} {min_lat},{max_lon} {min_lat},"
        f"{max_lon} {max_lat},{min_lon} {max_lat},{min_lon} {min_lat}))"
    )


def search_nisar_gcov(
    bbox: tuple[float, float, float, float], start: str, end: str
) -> list[Scene]:
    try:
        results = asf.search(
            dataset="NISAR",
            processingLevel="GCOV",
            intersectsWith=_bbox_to_wkt(bbox),
            start=start,
            end=end,
        )
    except Exception as exc:  # network/CMR failures degrade to no scenes
        logger.warning("ASF search failed: %s", exc)
        return []

    scenes = []
    for r in results:
        p = r.properties
        scenes.append(
            Scene(
                id=p.get("fileID") or p.get("sceneName") or p.get("fileName") or "nisar",
                datetime=str(p.get("startTime", "")),
                url=p.get("url", ""),
                bbox=bbox,
            )
        )
    return scenes


def download_gcov(scene: Scene, session: "asf.ASFSession", out_dir: Path) -> Path:
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{scene.id}.h5"
    with session.get(scene.url, stream=True) as resp:
        resp.raise_for_status()
        with open(out, "wb") as fh:
            for chunk in resp.iter_content(chunk_size=1 << 20):
                fh.write(chunk)
    return out


def _gcov_dataset_path(h5: h5py.File, pol: str) -> str:
    for freq in ("frequencyA", "frequencyB"):
        path = f"/science/LSAR/GCOV/grids/{freq}/{pol}"
        if path in h5:
            return path
    raise ValueError(f"polarization {pol} not found in GCOV grids")


def gcov_to_cog(h5_path: Path, pol: str = "HHHH", out: Path | None = None) -> Path:
    h5_path = Path(h5_path)
    if out is None:
        out = h5_path.with_name(f"{h5_path.stem}_{pol}_db.tif")
    out = Path(out)

    with h5py.File(h5_path, "r") as f:
        dset_path = _gcov_dataset_path(f, pol)
        freq = "frequencyA" if "frequencyA" in dset_path else "frequencyB"
        grids = f[f"/science/LSAR/GCOV/grids/{freq}"]
        data = f[dset_path][:]
        xs = grids["xCoordinates"][:]
        ys = grids["yCoordinates"][:]
        epsg = int(grids["projection"].attrs["epsg_code"])

    xres = abs(float(xs[1] - xs[0]))
    yres = abs(float(ys[1] - ys[0]))
    transform = from_origin(xs.min() - xres / 2, ys.max() + yres / 2, xres, yres)

    db = np.where(data > 0, 10.0 * np.log10(np.asarray(data, dtype="float32")), np.nan)

    out.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(
        out,
        "w",
        driver="COG",
        height=data.shape[0],
        width=data.shape[1],
        count=1,
        dtype="float32",
        crs=epsg,
        transform=transform,
        nodata=np.nan,
        compress="deflate",
    ) as dst:
        dst.write(db.astype("float32"), 1)
    return out
