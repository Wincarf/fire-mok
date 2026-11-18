import importlib.util
import sys
from pathlib import Path

from pipeline.metrics import f1
from pipeline.stac import scene_datetime_from_id

# import the script module (scripts/ is not a package)
_spec = importlib.util.spec_from_file_location(
    "validate_flood", Path(__file__).resolve().parents[1] / "scripts" / "validate_flood.py"
)
vf = importlib.util.module_from_spec(_spec)
sys.modules["validate_flood"] = vf
_spec.loader.exec_module(vf)


def test_scene_datetime_from_id():
    d = scene_datetime_from_id("S1A_IW_GRDH_1SDV_20240511T084943_20240511T085008_053821_068A6E_rtc_vv_db.tif")
    assert d is not None and (d.year, d.month, d.day) == (2024, 5, 11)
    assert scene_datetime_from_id("no_date_here.tif") is None


def test_stratum_of():
    assert vf.stratum_of(0.06) == "flood"
    assert vf.stratum_of(0.05) == "flood"  # boundary inclusive
    assert vf.stratum_of(0.0) == "dry"


def test_render_report_contains_metrics_tables():
    rows = []
    for thr in vf.THRESHOLDS:
        rows.append(
            {
                "item": "S2A_MSIL2A_20240518T134721",
                "chip": (-51.10, -29.95, -51.05, -29.90),
                "stratum": "flood",
                "thr": thr,
                "valid_px": 1000,
                "s2_water_px": 120,
                "sar_water_px": 150,
                "counts": (80, 70, 40, 810),
            }
        )
    rows.append({**rows[0], "stratum": "dry", "counts": (5, 20, 15, 960)})
    rows.append({**rows[0], "thr": vf.REPORT_THRESH, "stratum": "dry", "counts": (5, 20, 15, 960)})
    report = vf.render_report(rows, "S1A_..._rtc_vv_db.tif", ["- `S2A` (2024-05-18 — 7 d from SAR scene, 27.8% cloud)"])

    assert "# May-2024 flood validation" in report
    assert "threshold -17 dB" in report
    assert "F1" in report and "IoU" in report and "kappa" in report
    assert "[0." in report  # bootstrap CI present
    assert "`flood` stratum" in report and "`dry` stratum" in report
    assert "| S2 item | chip bbox | stratum |" in report
    assert "TP 85" in report  # 80 (flood) + 5 (dry) pooled at -17
    point = f1(85, 90, 55)
    assert f"F1 {point:.3f}" in report or f"{point:.3f}" in report


def test_render_report_empty_rows():
    report = vf.render_report([], "x.tif", [])
    assert "# May-2024 flood validation" in report  # header still written
