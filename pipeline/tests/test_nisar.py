from unittest.mock import patch

import h5py
import numpy as np
import pytest
import rasterio

from pipeline.nisar import (
    _gcov_dataset_path,
    duet_diff,
    duet_products,
    earthdata_session,
    inventory_payload,
    lband_stats_over_bbox,
    lband_water_mask,
    search_nisar_gcov,
    summarize_lband_db,
)
from pipeline.types import Scene


def test_summarize_lband_db_separates_water_from_land():
    vals = np.concatenate([np.full(1000, -15.0), np.full(50, -35.0)])  # land + open water
    s = summarize_lband_db(vals)
    assert s["pixels"] == 1050
    assert s["mean_db"] < -14
    assert s["low_backscatter_fraction"] > 0.02  # water tail below mean − 1.5σ


def test_summarize_lband_db_empty_is_zero_pixels():
    assert summarize_lband_db(np.array([np.nan, np.nan])) == {"pixels": 0}


def test_lband_stats_over_bbox_reads_window(tmp_path):
    from rasterio.transform import from_origin

    tif = tmp_path / "gcov_db.tif"
    arr = np.full((10, 10), -15.0, dtype="float32")
    arr[:2, :2] = -35.0  # open-water corner
    with rasterio.open(
        tif, "w", driver="COG", height=10, width=10, count=1, dtype="float32",
        crs="EPSG:4326", transform=from_origin(-51.0, -29.0, 0.1, 0.1),
        nodata=np.nan,
    ) as dst:
        dst.write(arr, 1)

    s = lband_stats_over_bbox(tif, (-51.0, -30.0, -50.0, -29.0))  # full raster extent
    assert s["pixels"] == 100
    assert s["mean_db"] < -14
    assert s["low_backscatter_fraction"] > 0.02  # 4 water pixels of 100


def test_inventory_payload_shape():
    bbox = (-51.6, -30.4, -50.7, -29.7)
    scene = Scene(id="g1", datetime="2026-06-17T21:33:19Z", url="s3://x", bbox=bbox)
    p = inventory_payload([scene], "guaiba", bbox, "2026-11-15")
    assert p["count"] == 1
    assert p["scenes"][0]["id"] == "g1"
    assert p["mission"].startswith("NISAR")
    assert p["bbox"] == list(bbox)


def test_lband_water_mask_excludes_context_and_small_blobs():
    db = np.full((20, 20), -15.0, dtype="float32")
    db[4:12, 4:12] = -35.0      # open-water blob (64 px)
    db[0:2, 0:2] = -35.0        # tiny blob (4 px) — below min_px
    urban = np.zeros((20, 20), dtype=bool)
    urban[16:18, 16:18] = True
    db[16:18, 16:18] = -35.0    # urban low-sigma0 false positive
    perm = np.zeros((20, 20), dtype=bool)

    w = lband_water_mask(db, -20.0, urban, perm, min_px=5)
    assert w[8, 8]        # real blob kept
    assert not w[0, 0]    # speckle dropped
    assert not w[16, 16]  # urban context removed


def test_duet_diff_classes():
    lw = np.zeros((4, 4), dtype=bool)
    lw[0, 0] = True   # L-band-only
    cw = np.zeros((4, 4), dtype=bool)
    cw[1, 1] = True   # C-band-only
    d = duet_diff(lw, cw)
    assert d[0, 0] == 2 and d[1, 1] == 1 and d[2, 2] == 0


def test_earthdata_session_returns_none_without_creds(monkeypatch, tmp_path):
    monkeypatch.delenv("EARTHDATA_USER", raising=False)
    monkeypatch.delenv("EARTHDATA_PASS", raising=False)
    monkeypatch.setenv("NETRC", str(tmp_path / "nonexistent_netrc"))
    monkeypatch.setattr("pathlib.Path.home", lambda: tmp_path)

    session = earthdata_session()

    assert session is None


def test_earthdata_session_auth_failure_returns_none(monkeypatch):
    import asf_search.exceptions

    class _Boom:
        def auth_with_creds(self, user, password):
            raise asf_search.exceptions.ASFAuthenticationError(
                "401: update profile attributes (Study Area)"
            )

    monkeypatch.setenv("EARTHDATA_USER", "user")
    monkeypatch.setenv("EARTHDATA_PASS", "pass")
    monkeypatch.setattr("asf_search.ASFSession", _Boom)

    assert earthdata_session() is None


def test_duet_products_end_to_end(tmp_path, monkeypatch):
    """Regression: duet writes all three COGs (missing count) and both km²."""
    from rasterio.transform import from_origin
    from rasterio.warp import transform_bounds

    monkeypatch.setattr(
        "pipeline.masks.fetch_worldcover_for_bounds",
        lambda *a, **k: np.zeros((200, 200), dtype="uint8"),
    )
    l, b, r, t = transform_bounds("EPSG:4326", "EPSG:32727", -51.6, -30.4, -50.7, -29.7)
    tr = from_origin(l, t, 30, 30)
    cog = tmp_path / "hh.tif"
    with rasterio.open(cog, "w", driver="GTiff", width=200, height=200, count=1,
                       crs="EPSG:32727", transform=tr, dtype="float32",
                       nodata=np.nan) as dst:
        db = np.full((200, 200), -12.0, dtype="float32")
        db[40:60, 40:60] = -38.0  # L-band-only water block
        dst.write(db, 1)
    s1 = tmp_path / "s1_extent.tif"
    with rasterio.open(s1, "w", driver="GTiff", width=200, height=200, count=1,
                       crs="EPSG:32727", transform=tr, dtype="uint8", nodata=0) as dst:
        c = np.zeros((200, 200), dtype="uint8")
        c[100:120, 100:120] = 1  # C-band-only water block
        dst.write(c, 1)

    out = duet_products(cog, (-51.6, -30.4, -50.7, -29.7), -30.0, s1, tmp_path / "out")

    assert (tmp_path / "out" / "nisar_hh_db.tif").exists()
    assert (tmp_path / "out" / "nisar_lwater.tif").exists()
    assert (tmp_path / "out" / "nisar_diff.tif").exists()
    assert out["lwater_km2"] > 0 and out["l_only_km2"] > 0 and out["c_only_km2"] > 0
    assert out["c_source"] == "s1_extent.tif"


def test_search_nisar_gcov_empty_returns_list(monkeypatch):
    monkeypatch.setattr("asf_search.search", lambda **kw: [])
    assert search_nisar_gcov((-51.6, -30.4, -50.7, -29.7), "2026-10-21", "2026-11-14") == []


def test_gcov_dataset_path_prefers_frequency_a(tmp_path):
    h5_path = tmp_path / "stub.h5"
    with h5py.File(h5_path, "w") as f:
        f.create_dataset("/science/LSAR/GCOV/grids/frequencyA/HHHH", data=np.zeros((2, 2)))
        f.create_dataset("/science/LSAR/GCOV/grids/frequencyB/HHHH", data=np.zeros((2, 2)))

    with h5py.File(h5_path, "r") as f:
        assert _gcov_dataset_path(f, "HHHH") == "/science/LSAR/GCOV/grids/frequencyA/HHHH"


def test_gcov_dataset_path_falls_back_to_frequency_b(tmp_path):
    h5_path = tmp_path / "stub.h5"
    with h5py.File(h5_path, "w") as f:
        f.create_dataset("/science/LSAR/GCOV/grids/frequencyB/HVHV", data=np.zeros((2, 2)))

    with h5py.File(h5_path, "r") as f:
        assert _gcov_dataset_path(f, "HVHV") == "/science/LSAR/GCOV/grids/frequencyB/HVHV"


def test_gcov_dataset_path_missing_pol_raises(tmp_path):
    h5_path = tmp_path / "stub.h5"
    with h5py.File(h5_path, "w") as f:
        f.create_dataset("/science/LSAR/GCOV/grids/frequencyA/HHHH", data=np.zeros((2, 2)))

    with h5py.File(h5_path, "r") as f:
        with pytest.raises(ValueError):
            _gcov_dataset_path(f, "VVVV")
