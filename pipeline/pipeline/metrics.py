"""Binary-mask agreement metrics for flood-map validation.

Everything is computed from pixel counts (TP/FP/FN/TN) so results can be
pooled across chips and bootstrapped without re-reading rasters.

Reference (ground truth) is the optical mask (e.g. Sentinel-2 NDWI);
prediction is the SAR water mask at a given sigma0 threshold.
"""

import numpy as np


def confusion_counts(
    ref: np.ndarray, pred: np.ndarray, valid: np.ndarray
) -> tuple[int, int, int, int]:
    """TP/FP/FN/TN over valid pixels. TP = ref water AND pred water."""
    r = np.asarray(ref, dtype=bool)
    p = np.asarray(pred, dtype=bool)
    v = np.asarray(valid, dtype=bool)
    tp = int((r & p & v).sum())
    fp = int((~r & p & v).sum())
    fn = int((r & ~p & v).sum())
    tn = int((~r & ~p & v).sum())
    return tp, fp, fn, tn


def agreement(tp: int, fp: int, fn: int, tn: int) -> float:
    """Overall pixel agreement (accuracy)."""
    n = tp + fp + fn + tn
    return (tp + tn) / n if n else float("nan")


def f1(tp: int, fp: int, fn: int) -> float:
    """F1 of the water class. Both-empty => perfect (1.0); one-side-only water => 0.0."""
    denom = 2 * tp + fp + fn
    if denom == 0:
        return 1.0
    return 2 * tp / denom


def iou(tp: int, fp: int, fn: int) -> float:
    """Intersection-over-union of the water class. Same conventions as f1."""
    denom = tp + fp + fn
    if denom == 0:
        return 1.0
    return tp / denom


def kappa(tp: int, fp: int, fn: int, tn: int) -> float:
    """Cohen's kappa — agreement corrected for chance.

    NaN when the marginals make pe == 1 (degenerate, e.g. single-class chip).
    """
    n = tp + fp + fn + tn
    if n == 0:
        return float("nan")
    po = (tp + tn) / n
    ref_water = (tp + fn) / n
    pred_water = (tp + fp) / n
    pe = ref_water * pred_water + (1 - ref_water) * (1 - pred_water)
    if pe >= 1.0:
        return float("nan")
    return (po - pe) / (1 - pe)


def pooled(counts: list[tuple[int, int, int, int]]) -> tuple[int, int, int, int]:
    """Sum per-chip counts into pooled TP/FP/FN/TN."""
    t = np.asarray(counts, dtype=np.int64).sum(axis=0) if counts else np.zeros(4, dtype=np.int64)
    return int(t[0]), int(t[1]), int(t[2]), int(t[3])


def bootstrap_ci(
    counts: list[tuple[int, int, int, int]],
    statistic,
    n_boot: int = 1000,
    seed: int = 7,
    ci: float = 0.95,
) -> tuple[float, float]:
    """Percentile CI for a pooled statistic, resampling chips with replacement.

    Resamples where the statistic is undefined (NaN) are discarded; fewer than
    2 defined resamples => (nan, nan).
    """
    counts = list(counts)
    if not counts:
        return float("nan"), float("nan")
    rng = np.random.default_rng(seed)
    arr = np.asarray(counts, dtype=np.int64)
    n = arr.shape[0]
    vals: list[float] = []
    for _ in range(int(n_boot)):
        idx = rng.integers(0, n, size=n)
        tp, fp, fn, tn = arr[idx].sum(axis=0)
        s = statistic(int(tp), int(fp), int(fn), int(tn))
        if not np.isnan(s):
            vals.append(float(s))
    if len(vals) < 2:
        return float("nan"), float("nan")
    alpha = (1 - ci) / 2
    lo, hi = np.percentile(vals, [100 * alpha, 100 * (1 - alpha)])
    return float(lo), float(hi)


def summarize(counts: list[tuple[int, int, int, int]]) -> dict:
    """All pooled metrics for a list of per-chip counts, plus bootstrap CIs."""
    tp, fp, fn, tn = pooled(counts)
    f1_lo, f1_hi = bootstrap_ci(counts, lambda a, b, c, _tn: f1(a, b, c))
    iou_lo, iou_hi = bootstrap_ci(counts, lambda a, b, c, _tn: iou(a, b, c))
    return {
        "tp": tp,
        "fp": fp,
        "fn": fn,
        "tn": tn,
        "agreement": agreement(tp, fp, fn, tn),
        "f1": f1(tp, fp, fn),
        "iou": iou(tp, fp, fn),
        "kappa": kappa(tp, fp, fn, tn),
        "f1_ci95": (f1_lo, f1_hi),
        "iou_ci95": (iou_lo, iou_hi),
    }
