import pytest

from pipeline.aoi import AOIS, get_aoi


def test_guaiba_bbox():
    assert get_aoi("guaiba").bbox == (-51.6, -30.4, -50.7, -29.7)


def test_all_aois_have_ordered_bbox():
    for aoi in AOIS.values():
        min_lon, min_lat, max_lon, max_lat = aoi.bbox
        assert min_lon < max_lon
        assert min_lat < max_lat
        assert min_lat > -90
        assert aoi.epsg == 4326


def test_unknown_aoi_raises_keyerror():
    with pytest.raises(KeyError):
        get_aoi("nope")
