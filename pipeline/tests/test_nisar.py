import h5py
import numpy as np
import rasterio
import pytest

from pipeline.nisar import gcov_to_cog


def _write_fake_gcov(path, pol="HHHH"):
    """Minimal NISAR GCOV-like HDF5: grids + x/y coords + epsg attr."""
    data = np.array(
        [[0.01, 0.1, 1.0], [0.5, 0.0, 0.25], [2.0, 0.05, np.nan]],
        dtype="float32",
    )
    with h5py.File(path, "w") as f:
        grids = f.create_group("/science/LSAR/GCOV/grids/frequencyA")
        grids.create_dataset(pol, data=data)
        grids.create_dataset("xCoordinates", data=np.array([100.0, 120.0, 140.0]))
        grids.create_dataset("yCoordinates", data=np.array([300.0, 280.0, 260.0]))
        grids.create_dataset("projection", data=b"EPSG:32722")
        grids["projection"].attrs["epsg_code"] = np.int32(32722)


def test_gcov_to_cog_roundtrip(tmp_path):
    h5 = tmp_path / "scene.h5"
    _write_fake_gcov(h5)
    out = gcov_to_cog(h5, pol="HHHH")
    assert out.exists() and out.name.endswith("_HHHH_db.tif")
    with rasterio.open(out) as ds:
        assert ds.crs.to_epsg() == 32722
        arr = ds.read(1)
        # linear -> dB: 0.01 -> -20 dB, 1.0 -> 0 dB; <=0 and NaN -> NaN
        assert arr[0, 0] == pytest.approx(-20.0, abs=0.01)
        assert arr[0, 2] == pytest.approx(0.0, abs=0.01)
        assert np.isnan(arr[1, 1])  # 0.0 is not positive -> nodata
        assert np.isnan(arr[2, 2])
        # 20 m pixels, y descending
        assert ds.transform.a == pytest.approx(20.0)
        assert ds.transform.e == pytest.approx(-20.0)


def test_gcov_to_cog_missing_pol(tmp_path):
    h5 = tmp_path / "scene.h5"
    _write_fake_gcov(h5)
    with pytest.raises(ValueError, match="polarization"):
        gcov_to_cog(h5, pol="HVHV")
