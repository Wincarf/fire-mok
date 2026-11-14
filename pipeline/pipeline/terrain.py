"""Terrain susceptibility: low + flat terrain floods first (screening layer).

Requires a DEM in metres on a north-up metric projected grid (geomaster gate).
"""

import logging
from pathlib import Path

import numpy as np
from affine import Affine

logger = logging.getLogger(__name__)


def slope_deg(dem: np.ndarray, transform: Affine) -> np.ndarray:
    """Horn's method slope in degrees; NaN where stencil hits nodata."""
    dem = np.asarray(dem, dtype="float32")
    px, py = abs(transform.a), abs(transform.e)
    dz_dx = np.gradient(dem, px, axis=1)
    dz_dy = np.gradient(dem, py, axis=0)
    slope = np.degrees(np.arctan(np.hypot(dz_dx, dz_dy)))
    slope[np.isnan(dem)] = np.nan
    # spread nodata to neighbours (gradient already used them)
    from scipy.ndimage import maximum_filter

    nan_mask = maximum_filter(np.isnan(dem).astype("uint8"), size=3).astype(bool)
    slope[nan_mask] = np.nan
    return slope


def susceptibility(
    dem: np.ndarray, transform: Affine, elev_thresh_m: float, slope_thresh_deg: float
) -> np.ndarray:
    """Boolean screening mask: elevation below threshold AND slope below threshold."""
    s = slope_deg(dem, transform)
    out = (dem < elev_thresh_m) & (s < slope_thresh_deg)
    return out & ~np.isnan(dem) & ~np.isnan(s)


# ---------------------------------------------------------------------------
# HAND — Height Above Nearest Drainage (Rennó et al. 2008)
#
# Elevation difference between a cell and the nearest stream cell reached
# downstream. Replaces the raw "elev < 50 m" rule: the same absolute
# elevation is flood-prone on the Guaíba valley floor and irrelevant on a
# coastal plateau. Pure numpy — no new dependencies.
# ---------------------------------------------------------------------------


def fill_dem(dem: np.ndarray, eps: float = 0.01) -> np.ndarray:
    """Priority-flood fill with epsilon (Barnes et al. 2014).

    Guarantees strictly descending flow paths (no pits, no flats) so D8 has
    no cycles. NaN cells stay NaN and act as sinks.
    """
    import heapq

    dem = np.asarray(dem, dtype="float32")
    h, w = dem.shape
    filled = dem.copy()
    visited = np.zeros((h, w), dtype=bool)
    heap: list[tuple[float, int, int]] = []

    for i in range(h):  # seed: finite boundary cells
        for j in (0, w - 1):
            if not np.isnan(filled[i, j]) and not visited[i, j]:
                visited[i, j] = True
                heapq.heappush(heap, (float(filled[i, j]), i, j))
    for j in range(w):
        for i in (0, h - 1):
            if not np.isnan(filled[i, j]) and not visited[i, j]:
                visited[i, j] = True
                heapq.heappush(heap, (float(filled[i, j]), i, j))

    offsets = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
    while heap:
        e, i, j = heapq.heappop(heap)
        for di, dj in offsets:
            ni, nj = i + di, j + dj
            if 0 <= ni < h and 0 <= nj < w and not visited[ni, nj]:
                visited[ni, nj] = True
                if np.isnan(filled[ni, nj]):
                    continue  # nodata interior: sink, never filled
                if filled[ni, nj] <= e:
                    filled[ni, nj] = e + eps
                heapq.heappush(heap, (float(filled[ni, nj]), ni, nj))
    return filled


def _receivers(filled: np.ndarray) -> np.ndarray:
    """D8 receivers as flat indices; sink/boundary/nodata cells point to themselves."""
    h, w = filled.shape
    n = h * w
    flat = filled.ravel()
    recv = np.arange(n, dtype=np.int64)
    best_slope = np.full(n, -np.inf, dtype="float32")

    idx2d = np.arange(n).reshape(h, w)
    steps = [(-1, -1, 1.41421356), (-1, 0, 1.0), (-1, 1, 1.41421356),
             (0, -1, 1.0), (0, 1, 1.0),
             (1, -1, 1.41421356), (1, 0, 1.0), (1, 1, 1.41421356)]
    for di, dj, dist in steps:
        # clipped neighbor grid; clipped boundary cells are invalidated below
        ni = np.clip(np.arange(h) + di, 0, h - 1)
        nj = np.clip(np.arange(w) + dj, 0, w - 1)
        shifted = filled[np.ix_(ni, nj)].ravel()
        valid = np.ones((h, w), dtype=bool)
        if di < 0:
            valid[0, :] = False  # north neighbor of row 0 is outside the grid
        if di > 0:
            valid[h - 1, :] = False
        if dj < 0:
            valid[:, 0] = False
        if dj > 0:
            valid[:, w - 1] = False
        slope = (flat - shifted) / dist
        slope[np.isnan(slope) | ~valid.ravel()] = -np.inf
        better = (slope > best_slope) & (slope > 0)  # descent only; rejects clip zeros
        recv = np.where(better, idx2d.ravel() + di * w + dj, recv)
        best_slope = np.where(better, slope, best_slope)
    return recv


def flow_accumulation(filled: np.ndarray, recv: np.ndarray) -> np.ndarray:
    """Upstream cell count per cell. O(n) pass over descending filled order."""
    order = np.argsort(-filled.ravel(), kind="stable")
    acc = np.ones(filled.size, dtype="float32")
    for idx in order:
        r = recv[idx]
        if r != idx:
            acc[r] += acc[idx]
    return acc


def hand(dem: np.ndarray, transform: Affine, acc_thresh_cells: int = 1000) -> np.ndarray:
    """Height Above Nearest Drainage in metres (NaN where no stream reached).

    Streams = cells with flow accumulation >= acc_thresh_cells. Requires a
    metric, north-up grid (same gate as slope_deg).
    """
    dem = np.asarray(dem, dtype="float32")
    filled = fill_dem(dem)
    recv = _receivers(filled)
    acc = flow_accumulation(filled, recv)
    stream = (acc >= acc_thresh_cells) & ~np.isnan(filled.ravel())

    n = dem.size
    elev = dem.ravel()
    # pointer doubling: first stream cell reached following the flow path
    P = np.where(stream, np.arange(n), recv)
    found = stream.copy()
    stream_elev = np.where(found, elev, np.inf).astype("float32")
    for _ in range(int(np.ceil(np.log2(max(n, 2)))) + 2):
        if found.all():
            break
        P_next = P[P]
        # read donor state with the OLD found, then flip found (order matters:
        # newly-found cells must take stream_elev from their pointer)
        stream_elev = np.where(found, stream_elev, stream_elev[P])
        found = found | found[P]
        P = P_next

    out = np.where(found, elev - stream_elev, np.nan)
    out[np.isnan(dem.ravel())] = np.nan
    return out.reshape(dem.shape).astype("float32")


def susceptibility_hand(
    dem: np.ndarray,
    transform: Affine,
    hand_thresh_m: float = 15.0,
    slope_thresh_deg: float = 5.0,
    acc_thresh_cells: int = 1000,
) -> np.ndarray:
    """Boolean screening mask: HAND below threshold AND slope below threshold.

    HAND < 15 m approximates the floodplain; the threshold is a screening
    choice, documented in docs/methodology.md.
    """
    h = hand(dem, transform, acc_thresh_cells)
    s = slope_deg(dem, transform)
    out = (h < hand_thresh_m) & (s < slope_thresh_deg)
    return out & ~np.isnan(dem) & ~np.isnan(h) & ~np.isnan(s)
