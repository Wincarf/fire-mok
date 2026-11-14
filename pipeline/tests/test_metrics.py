import numpy as np

from pipeline.metrics import (
    agreement,
    bootstrap_ci,
    confusion_counts,
    f1,
    iou,
    kappa,
    pooled,
    summarize,
)


def _chip(tp, fp, fn, tn):
    return (tp, fp, fn, tn)


def test_confusion_counts_on_arrays():
    ref = np.array([[True, False], [False, False]])
    pred = np.array([[True, True], [False, False]])
    valid = np.array([[True, True], [True, True]])
    assert confusion_counts(ref, pred, valid) == (1, 1, 0, 2)


def test_confusion_counts_ignores_invalid():
    ref = np.array([True])
    pred = np.array([False])
    valid = np.array([False])
    assert confusion_counts(ref, pred, valid) == (0, 0, 0, 0)


def test_f1_known_case():
    # precision 50/60, recall 50/75 -> f1 = 2*tp/(2tp+fp+fn)
    assert abs(f1(50, 10, 25) - 2 * 50 / (100 + 10 + 25)) < 1e-12


def test_f1_edge_cases():
    assert f1(0, 0, 0) == 1.0  # both sides agree: no water anywhere
    assert f1(0, 5, 0) == 0.0  # predicted water, reference none
    assert f1(0, 0, 5) == 0.0  # reference water, none predicted


def test_iou_known_case():
    assert abs(iou(50, 10, 25) - 50 / 85) < 1e-12


def test_kappa_perfect_and_degenerate():
    assert abs(kappa(10, 0, 0, 90) - 1.0) < 1e-12  # perfect agreement
    assert np.isnan(kappa(0, 0, 0, 0))
    # single-class chip: pe == 1 -> NaN
    assert np.isnan(kappa(0, 0, 0, 100))
    assert np.isnan(kappa(100, 0, 0, 0))


def test_kappa_significant_agreement():
    tp, fp, fn, tn = 50, 10, 25, 915
    n = tp + fp + fn + tn
    po = (tp + tn) / n
    pe = ((tp + fn) / n) * ((tp + fp) / n) + ((fp + tn) / n) * ((fn + tn) / n)
    expected = (po - pe) / (1 - pe)
    assert abs(kappa(tp, fp, fn, tn) - expected) < 1e-12


def test_pooled_sums_chips():
    assert pooled([_chip(1, 2, 3, 4), _chip(5, 6, 7, 8)]) == (6, 8, 10, 12)


def test_bootstrap_ci_degenerate_chips():
    # all chips identical -> every resample has the same statistic
    counts = [_chip(50, 10, 25, 915)] * 10
    lo, hi = bootstrap_ci(counts, lambda a, b, c, _tn: f1(a, b, c), n_boot=200, seed=1)
    assert abs(lo - f1(50, 10, 25)) < 1e-9
    assert abs(hi - f1(50, 10, 25)) < 1e-9


def test_bootstrap_ci_brackets_point_estimate():
    rng = np.random.default_rng(42)
    counts = [
        _chip(int(rng.integers(0, 60)), int(rng.integers(0, 20)), int(rng.integers(0, 30)), 900)
        for _ in range(30)
    ]
    lo, hi = bootstrap_ci(counts, lambda a, b, c, _tn: f1(a, b, c), n_boot=500, seed=7)
    point = f1(*pooled(counts)[:3])
    assert lo <= point <= hi
    assert hi - lo > 0  # heterogeneous chips -> non-degenerate CI


def test_bootstrap_ci_empty():
    lo, hi = bootstrap_ci([], f1)
    assert np.isnan(lo) and np.isnan(hi)


def test_summarize_keys_and_consistency():
    counts = [_chip(50, 10, 25, 915), _chip(30, 5, 15, 950)]
    s = summarize(counts)
    assert s["tp"] == 80 and s["fp"] == 15 and s["fn"] == 40 and s["tn"] == 1865
    assert abs(s["f1"] - f1(80, 15, 40)) < 1e-12
    assert abs(s["iou"] - iou(80, 15, 40)) < 1e-12
    lo, hi = s["f1_ci95"]
    assert lo <= s["f1"] <= hi
