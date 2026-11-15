"""NISAR GCOV access via ASF DAAC: search, download (Earthdata-gated), HDF5 -> COG."""

import logging
import netrc as netrc_mod
import os
from pathlib import Path

import asf_search as asf
from asf_search.exceptions import ASFAuthenticationError
import h5py
import numpy as np
import rasterio
import requests
from rasterio.transform import from_origin

from pipeline.types import Scene

logger = logging.getLogger(__name__)

URS_HOST = "urs.earthdata.nasa.gov"


def earthdata_session() -> "asf.ASFSession | None":
    user = os.environ.get("EARTHDATA_USER")
    password = os.environ.get("EARTHDATA_PASS")
    if user and password:
        try:
            return asf.ASFSession().auth_with_creds(user, password)
        except ASFAuthenticationError as exc:
            logger.warning(
                "Earthdata auth refused (%s) -> inventory-only. Check the "
                "password and the required EDL profile fields (Country, "
                "Organization, Study Area, Primary Data Use) at "
                "https://urs.earthdata.nasa.gov/profile",
                exc,
            )
            return None
        except requests.RequestException as exc:
            logger.warning("Earthdata auth network error (%s) -> inventory-only", exc)
            return None
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


def summarize_lband_db(values: np.ndarray) -> dict:
    """Open-water proxy stats from L-band GCOV dB over valid pixels.

    Open water drops L-band σ0 well below the surrounding land mean (no
    volume scattering, specular return), so the fraction of pixels below
    mean − 1.5σ is used as a proxy indicator — it is NOT a classified
    flood map; permanent-water removal needs the WorldCover context.
    """
    v = np.asarray(values, dtype="float32")
    v = v[np.isfinite(v)]
    if v.size == 0:
        return {"pixels": 0}
    mean = float(v.mean())
    std = float(v.std())
    return {
        "pixels": int(v.size),
        "mean_db": round(mean, 2),
        "p05_db": round(float(np.percentile(v, 5)), 2),
        "std_db": round(std, 2),
        "low_backscatter_fraction": round(float((v < mean - 1.5 * std).mean()), 4),
    }


def lband_stats_over_bbox(cog_path: Path, bbox: tuple[float, float, float, float]) -> dict:
    """Read the GCOV dB COG inside a lon/lat bbox and summarize it."""
    from rasterio.warp import transform_bounds
    from rasterio.windows import Window, from_bounds

    with rasterio.open(cog_path) as src:
        left, bottom, right, top = transform_bounds(
            "EPSG:4326", src.crs, *bbox, densify_pts=21
        )
        win = from_bounds(left, bottom, right, top, transform=src.transform)
        win = win.intersection(Window(0, 0, src.width, src.height))
        if win.width <= 0 or win.height <= 0:
            return {"pixels": 0}
        data = src.read(1, window=win)
    return summarize_lband_db(data)


def inventory_payload(
    scenes: list[Scene],
    aoi_name: str,
    bbox: tuple[float, float, float, float],
    generated: str,
) -> dict:
    """Public (no Earthdata auth) GCOV scene inventory, served at /api/nisar."""
    return {
        "product": "NISAR L2 GCOV (PROVISIONAL / BETA) — ASF DAAC",
        "mission": "NISAR (NASA–ISRO)",
        "aoi": aoi_name,
        "bbox": list(bbox),
        "generated": generated,
        "count": len(scenes),
        "scenes": [{"id": s.id, "datetime": s.datetime, "url": s.url} for s in scenes],
    }


def lband_water_mask(
    db: np.ndarray,
    thresh_db: float,
    urban: np.ndarray | None,
    permanent: np.ndarray | None,
    min_px: int = 25,
) -> np.ndarray:
    """Open-water proxy: σ0 below thresh, minus urban/permanent-water context."""
    from pipeline.water import filter_min_area

    w = np.isfinite(db) & (db < thresh_db)
    if urban is not None:
        w &= ~urban
    if permanent is not None:
        w &= ~permanent
    return filter_min_area(w, min_px)


def duet_diff(lwater: np.ndarray, c_water: np.ndarray) -> np.ndarray:
    """3-class duet mask: 0 none, 1 C-band-only (Sentinel-1), 2 L-band-only (NISAR)."""
    out = np.zeros(lwater.shape, dtype="uint8")
    out[c_water & ~lwater] = 1
    out[lwater & ~c_water] = 2
    return out


def mean_std_threshold(values: np.ndarray, thresh_db: float | None) -> float:
    """Adaptive water threshold: mean − 1.5σ, unless a fixed dB is given."""
    if thresh_db is not None:
        return float(thresh_db)
    return round(float(np.mean(values) - 1.5 * np.std(values)), 2)


def duet_products(
    hh_cog: Path,
    aoi_bbox: tuple[float, float, float, float],
    thresh_db: float | None,
    s1_extent: Path | None,
    out_dir: Path,
) -> dict:
    """Duet artifacts: AOI-window dB + L-band water proxy + optional C×L diff.

    Best-effort by design: missing WorldCover coverage or a missing S1
    extent only removes parts of the result, never raises.
    """
    from rasterio.warp import Resampling, reproject, transform_bounds
    from rasterio.windows import Window, bounds as win_bounds, from_bounds

    from pipeline.masks import fetch_worldcover_for_bounds
    from pipeline.water import filter_min_area, write_mask_cog

    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    with rasterio.open(hh_cog) as src:
        left, bottom, right, top = transform_bounds(
            "EPSG:4326", src.crs, *aoi_bbox, densify_pts=21
        )
        win = from_bounds(left, bottom, right, top, transform=src.transform).intersection(
            Window(0, 0, src.width, src.height)
        )
        if win.width <= 0 or win.height <= 0:
            return {}
        db = src.read(1, window=win)
        wtransform = src.window_transform(win)
        wcrs = src.crs
        px_m2 = float(abs(src.res[0] * src.res[1]))

    finite = db[np.isfinite(db)]
    if finite.size == 0:
        return {}
    thresh = mean_std_threshold(finite, thresh_db)

    prof = {
        "driver": "GTiff", "count": 1, "height": int(db.shape[0]), "width": int(db.shape[1]),
        "crs": wcrs, "transform": wtransform, "nodata": np.nan,
        "dtype": "float32", "compress": "deflate",
    }
    hh_out = out_dir / "nisar_hh_db.tif"
    with rasterio.open(hh_out, "w", **prof) as dst:
        dst.write(db.astype("float32"), 1)

    # context masks on the NISAR grid (window bounds back in 4326 for STAC)
    wb = win_bounds(win, wtransform)
    b4326 = transform_bounds(wcrs, "EPSG:4326", *wb, densify_pts=21)
    wc = fetch_worldcover_for_bounds(b4326, wtransform, wcrs, db.shape)
    lwater = filter_min_area(
        np.isfinite(db) & (db < thresh) & ~(wc == 50) & ~(wc == 80), 25
    )
    lw_out = out_dir / "nisar_lwater.tif"
    write_mask_cog(lwater, prof, lw_out)

    out: dict = {
        "hh": hh_out.name,
        "lwater": lw_out.name,
        "threshold_db": round(float(thresh), 2),
        "lwater_km2": round(float(lwater.sum()) * px_m2 / 1e6, 2),
    }
    if s1_extent is not None and Path(s1_extent).exists():
        c_water = np.zeros(db.shape, dtype="uint8")
        with rasterio.open(s1_extent) as s1:
            reproject(
                rasterio.band(s1, 1),
                c_water,
                dst_transform=wtransform,
                dst_crs=wcrs,
                resampling=Resampling.nearest,
                src_nodata=0,
                dst_nodata=0,
            )
        diff = duet_diff(lwater, c_water.astype(bool))
        diff_out = out_dir / "nisar_diff.tif"
        write_mask_cog(diff, prof, diff_out)
        out["diff"] = diff_out.name
        out["c_source"] = Path(s1_extent).name
        out["c_only_km2"] = round(float((diff == 1).sum()) * px_m2 / 1e6, 2)
        out["l_only_km2"] = round(float((diff == 2).sum()) * px_m2 / 1e6, 2)
    return out
