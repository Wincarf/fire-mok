from unittest.mock import patch

import h5py
import numpy as np
import pytest
import rasterio

from pipeline.nisar import (
    _gcov_dataset_path,
    earthdata_session,
    inventory_payload,
    lband_stats_over_bbox,
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

    s = lband_stats_over_bbox(tif, (-50.9, -29.9, -50.1, -29.1))
    assert s["pixels"] == 100
    assert s["mean_db"] < -14


def test_inventory_payload_shape():
    bbox = (-51.6, -30.4, -50.7, -29.7)
    scene = Scene(id="g1", datetime="2026-06-17T21:33:19Z", url="s3://x", bbox=bbox)
    p = inventory_payload([scene], "guaiba", bbox, "2026-11-15")
    assert p["count"] == 1
    assert p["scenes"][0]["id"] == "g1"
    assert p["mission"].startswith("NISAR")
    assert p["bbox"] == list(bbox)


def test_earthdata_session_returns_none_without_creds(monkeypatch, tmp_path):
    monkeypatch.delenv("EARTHDATA_USER", raising=False)
    monkeypatch.delenv("EARTHDATA_PASS", raising=False)
    monkeypatch.setenv("NETRC", str(tmp_path / "nonexistent_netrc"))
    monkeypatch.setattr("pathlib.Path.home", lambda: tmp_path)

    session = earthdata_session()

    assert session is None


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
