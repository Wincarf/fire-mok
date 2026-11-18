import numpy as np
from affine import Affine
from rasterio.crs import CRS

from pipeline.raster import write_mask_cog
from pipeline.water import filter_min_area, flood_extent, mask_to_polygons, water_mask


def test_water_mask_threshold():
    db = np.array([[-20.0, -15.0, -14.9], [-10.0, np.nan, -30.0]])
    mask = water_mask(db, thresh_db=-15.0)
    assert mask.tolist() == [[True, False, False], [False, False, True]]


def test_water_mask_excludes_nodata():
    db = np.array([[np.nan, -20.0]])
    mask = water_mask(db)
    assert not mask[0, 0] and mask[0, 1]


def test_flood_extent_flags_only_new_water():
    before = np.array([[-20.0, -10.0, -10.0, np.nan]])
    after = np.array([[-20.0, -20.0, -10.0, -20.0]])
    flood = flood_extent(before, after)
    # idx0: water before+after -> not new; idx1: new water; idx2: dry stays dry
    # idx3: before nodata -> not counted as flood
    assert flood.tolist() == [[False, True, False, False]]


def test_mask_to_polygons_counts_regions():
    mask = np.zeros((8, 8), dtype="uint8")
    mask[1:3, 1:3] = 1
    mask[5:7, 5:7] = 1
    transform = Affine(10, 0, 500000, 0, -10, 6800000)
    gdf = mask_to_polygons(mask, transform, CRS.from_epsg(32722))
    assert len(gdf) == 2
    assert gdf.geometry.area.iloc[0] == 400.0  # 2x2 px * 10m


def test_filter_min_area_drops_small_blobs():
    mask = np.zeros((10, 10), dtype=bool)
    mask[0, 0] = True              # 1-px speckle
    mask[4:8, 4:8] = True          # 16-px blob
    out = filter_min_area(mask, min_px=4)
    assert not out[0, 0] and out[4:8, 4:8].all()
    assert not out[9, 9]  # background stays False even though it's the largest component


def test_write_mask_cog_roundtrip(tmp_path):
    import rasterio

    mask = np.zeros((4, 4), dtype="uint8")
    mask[0, 0] = 1
    profile = {
        "height": 4, "width": 4, "count": 1, "dtype": "uint8",
        "crs": CRS.from_epsg(32722),
        "transform": Affine(10, 0, 500000, 0, -10, 6800000),
        "nodata": None,
    }
    out = write_mask_cog(mask, profile, tmp_path / "mask.tif")
    with rasterio.open(out) as ds:
        assert ds.read(1).tolist() == mask.tolist()
        assert ds.crs.to_epsg() == 32722
