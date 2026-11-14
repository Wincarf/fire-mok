import numpy as np
import pytest

from pipeline.masks import (
    WC_URBAN,
    WC_WATER,
    clean_flood_extent,
    permanent_water_mask,
    urban_mask,
)


def _worldcover_grid():
    """3x3: row 0 water(80), row 1 urban(50), row 2 crop(40); col 2 nodata(0)."""
    wc = np.array(
        [[80, 80, 0], [50, 50, 0], [40, 40, 0]], dtype="uint8"
    )
    return wc


def test_class_constants():
    assert WC_WATER == 80 and WC_URBAN == 50


def test_masks_pick_classes():
    wc = _worldcover_grid()
    perm = permanent_water_mask(wc)
    urb = urban_mask(wc)
    assert perm.tolist() == [[True, True, False], [False, False, False], [False, False, False]]
    assert urb.tolist() == [[False, False, False], [True, True, False], [False, False, False]]


def test_clean_flood_extent_removes_fp_only():
    wc = _worldcover_grid()
    perm, urb = permanent_water_mask(wc), urban_mask(wc)
    flood = np.array(
        [[True, False, True], [False, True, False], [False, False, True]], dtype=bool
    )
    cleaned, stats = clean_flood_extent(flood, perm, urb)
    # (0,0) permanent water gone, (1,1) urban gone, (2,2) crop stays
    assert cleaned.tolist() == [[False, False, True], [False, False, False], [False, False, True]]
    assert stats["removed_permanent"] == 1
    assert stats["removed_urban"] == 1  # urban counted without double-counting perm
    assert stats["before_px"] == 4 and stats["after_px"] == 2


def test_clean_flood_extent_urban_under_perm_not_double_counted():
    # pixel both urban and permanent: counted only in removed_permanent
    perm = np.array([[True]])
    urb = np.array([[True]])
    flood = np.array([[True]])
    _, stats = clean_flood_extent(flood, perm, urb)
    assert stats["removed_permanent"] == 1
    assert stats["removed_urban"] == 0


def test_clean_keeps_flood_on_crop():
    flood = np.array([[True, False], [False, True]])
    wc = np.array([[40, 0], [0, 80]])
    cleaned, _ = clean_flood_extent(flood, permanent_water_mask(wc), urban_mask(wc))
    assert cleaned[0, 0] and not cleaned[1, 1]
