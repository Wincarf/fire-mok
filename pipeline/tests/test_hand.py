import numpy as np
import pytest
from affine import Affine

from pipeline.terrain import _receivers, fill_dem, flow_accumulation, hand, susceptibility_hand

T30 = Affine(30.0, 0.0, 0.0, 0.0, -30.0, 0.0)  # 30 m metric north-up grid


def valley_dem() -> np.ndarray:
    """100x100 valley: elevation falls +x, walls fall toward row 50, carved channel.

    D8 steepest descent: wall cells go diagonally (-3/sqrt2 per diagonal step)
    and land on the channel row shifted by |y-50| columns.
    """
    ys, xs = np.mgrid[0:100, 0:100]
    dem = (99.0 - xs + 2.0 * np.abs(ys - 50)).astype("float32")
    dem[50, :] = 99.0 - xs[50, :] - 5.0  # channel, 5 m below the plane at same x
    return dem


def test_fill_dem_fills_pits():
    dem = np.full((10, 10), 100.0, dtype="float32")
    dem[5, 5] = 90.0  # interior pit, closed basin
    filled = fill_dem(dem)
    assert filled[5, 5] > 90.0  # pit filled up to spill point + eps
    assert filled[0, 0] == 100.0


def test_receivers_follow_steepest_descent():
    dem = valley_dem()
    filled = fill_dem(dem)
    recv = _receivers(filled)
    # channel cell mid-row flows east (+x) toward the boundary
    assert recv[50 * 100 + 30] == 50 * 100 + 31
    # wall cell (20,30) takes the diagonal (-3/sqrt2 beats -2/1) to (21,31)
    assert recv[20 * 100 + 30] == 21 * 100 + 31
    # boundary corner is a sink
    assert recv[50 * 100 + 99] == 50 * 100 + 99


def test_flow_accumulation_channel_grows_downstream():
    dem = valley_dem()
    filled = fill_dem(dem)
    recv = _receivers(filled)
    acc = flow_accumulation(filled, recv)
    # diagonal D8 lines concentrate flow: acc compounds fast along the channel
    assert acc[50 * 100 + 60] > acc[50 * 100 + 30] >= 500
    assert acc[50 * 100 + 99] == acc.max()  # channel mouth at the boundary


def test_hand_zero_on_stream_and_positive_upslope():
    dem = valley_dem()
    h = hand(dem, T30, acc_thresh_cells=150)
    # channel is a stream well before x=60 (acc compounds past 150 early)
    assert float(h[50, 60]) == pytest.approx(0.0, abs=1e-3)
    # (20,30): elev 129; diagonal descent lands on the channel near x=59
    # (elev ~35) -> HAND ~94; landing column depends on the last step being
    # straight south (dz -7 beats diagonal -7/sqrt2), so assert a robust range
    assert 90.0 <= float(h[20, 30]) <= 100.0
    assert 30.0 <= float(h[40, 30]) <= 40.0
    assert h[40, 30] < h[20, 30]  # closer to the drainage -> smaller HAND
    assert not np.isnan(h).any()  # every path reaches the channel here


def test_hand_nan_without_streams():
    dem = valley_dem()
    h = hand(dem, T30, acc_thresh_cells=100_000)
    assert np.isnan(h).all()


def test_susceptibility_hand_flagship():
    dem = valley_dem()
    sus = susceptibility_hand(dem, T30, hand_thresh_m=50.0, acc_thresh_cells=150)
    # near-channel low ground susceptible; high walls (>50 m above drainage) not
    assert sus[50, 60]
    assert sus[45, 30]  # HAND 35 < 50
    assert not sus[0, 30]  # wall top: HAND ~155 m > 50
    assert not sus[20, 30]  # HAND 95 > 50
