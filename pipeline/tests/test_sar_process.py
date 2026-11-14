import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

from pipeline.aoi import AOI
from pipeline.sar_process import crop_to_aoi, to_db


def test_to_db():
    arr = np.array([[1.0, 0.1], [0.0, -2.0]], dtype="float32")
    db = to_db(arr)
    assert db[0, 0] == pytest.approx(0.0)
    assert db[0, 1] == pytest.approx(-10.0)
    assert np.isnan(db[1, 0]) and np.isnan(db[1, 1])


def _write_test_tif(path, bounds=(-52.0, -31.0, -50.0, -29.0), shape=(256, 256), epsg=4326):
    min_lon, min_lat, max_lon, max_lat = bounds
    h, w = shape
    transform = from_origin(min_lon, max_lat, (max_lon - min_lon) / w, (max_lat - min_lat) / h)
    data = np.full(shape, 0.5, dtype="float32")
    data[100:110, 140:150] = np.nan  # lands inside the subset-test AOI
    with rasterio.open(
        path, "w", driver="GTiff", height=h, width=w, count=1,
        dtype="float32", crs=f"EPSG:{epsg}", transform=transform, nodata=np.nan,
    ) as dst:
        dst.write(data, 1)
    return path


def test_crop_to_aoi_writes_subset(tmp_path):
    src = _write_test_tif(tmp_path / "src.tif")
    aoi = AOI("t", (-51.0, -30.0, -50.5, -29.5))
    out = crop_to_aoi(str(src), aoi, tmp_path / "out.tif")
    with rasterio.open(out) as ds:
        assert ds.dtypes[0] == "float32"
        west, south, east, north = ds.bounds
        assert west == pytest.approx(-51.0, abs=0.01)
        assert south == pytest.approx(-30.0, abs=0.01)
        assert np.isnan(ds.read(1)).any()  # nodata preserved


def test_crop_to_aoi_partial_overlap_fills_nodata(tmp_path):
    src = _write_test_tif(tmp_path / "src.tif")
    # AOI extends beyond scene's east edge
    aoi = AOI("t", (-50.5, -30.0, -49.5, -29.5))
    out = crop_to_aoi(str(src), aoi, tmp_path / "out.tif")
    with rasterio.open(out) as ds:
        arr = ds.read(1)
        assert np.isnan(arr[:, -1]).all()  # outside-scene region is nodata
        assert not np.isnan(arr[:, 0]).all()


def test_crop_to_aoi_reprojects_aoi_to_source_crs(tmp_path):
    # source in UTM 22S metres (like S1 RTC), AOI in degrees — real-world case
    src = _write_test_tif(
        tmp_path / "utm.tif",
        bounds=(430000.0, 6600000.0, 630000.0, 6800000.0),
        epsg=32722,
    )
    aoi = AOI("t", (-51.6, -30.4, -50.7, -29.7))
    out = crop_to_aoi(str(src), aoi, tmp_path / "out.tif")
    with rasterio.open(out) as ds:
        assert ds.width > 0 and ds.height > 0
        assert ds.crs.to_epsg() == 32722
