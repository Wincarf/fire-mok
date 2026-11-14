from unittest.mock import patch

import h5py
import numpy as np
import pytest

from pipeline.nisar import _gcov_dataset_path, earthdata_session, search_nisar_gcov


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
