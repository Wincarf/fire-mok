import io
import json
import sys
import urllib.parse
from pathlib import Path

import numpy as np
import pytest
import rasterio
from affine import Affine

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import create_app

LAYERS = [
    "sar_before", "sar_after", "flood_extent", "permanent_water", "urban",
    "susceptibility", "hand", "dem",
    "choreo_peak", "choreo_recession", "choreo_calm",
    "nisar_hh", "nisar_lwater", "nisar_diff",
]


def _tiny_cog(path: Path, val: float):
    path.parent.mkdir(parents=True, exist_ok=True)
    arr = np.full((256, 256), val, dtype="float32")
    with rasterio.open(
        path, "w", driver="GTiff", height=256, width=256, count=1,
        dtype="float32", crs="EPSG:4326",
        transform=Affine(0.001, 0, -51.0, 0, -0.001, -30.0), nodata=np.nan,
    ) as ds:
        ds.write(arr, 1)


@pytest.fixture()
def client(tmp_path):
    from fastapi.testclient import TestClient

    rel = {
        "sar_before": "sar/b.tif", "sar_after": "sar/a.tif",
        "flood_extent": "sar/f.tif", "permanent_water": "context/pw.tif",
        "urban": "context/urb.tif", "susceptibility": "terrain/s.tif",
        "hand": "terrain/h.tif", "dem": "terrain/d.tif",
        "choreo_peak": "sar/choreo_extent_20240511.tif",
        "choreo_recession": "sar/choreo_extent_20240530.tif",
        "choreo_calm": "sar/choreo_extent_20240604.tif",
        "nisar_hh": "nisar/nisar_hh_db.tif",
        "nisar_lwater": "nisar/nisar_lwater.tif",
        "nisar_diff": "nisar/nisar_diff.tif",
    }
    import app as appmod
    appmod.LAYERS.update(rel)
    for name, r in rel.items():
        _tiny_cog(tmp_path / r, -20.0)
    (tmp_path / "vector").mkdir(parents=True)
    (tmp_path / "vector" / "municipalities_risk_may2024.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": []}), encoding="utf-8"
    )
    (tmp_path / "vector" / "action_plans_may2024.json").write_text(
        json.dumps({"4314902": {"priority": "high", "actions": ["a"], "reasons": ["r"]}}),
        encoding="utf-8",
    )
    (tmp_path / "vector" / "flood_polygons_may2024.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": []}), encoding="utf-8"
    )
    (tmp_path / "vector" / "choreo.json").write_text(
        json.dumps({"beats": [{"date": "2024-05-11", "label": "peak", "flood_km2": 10}]}),
        encoding="utf-8",
    )
    (tmp_path / "vector" / "nisar_status.json").write_text(
        json.dumps({"granule_id": "g1", "lband": {"pixels": 10}}), encoding="utf-8"
    )
    return TestClient(create_app(tmp_path))


def test_layers_manifest(client):
    r = client.get("/api/layers")
    assert r.status_code == 200
    assert all(e["available"] for e in r.json()["layers"])


def test_healthz(client):
    r = client.get("/healthz")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["layers_available"] == body["layers_total"] == len(LAYERS)


def test_municipalities_200(client):
    r = client.get("/api/municipalities")
    assert r.status_code == 200 and r.json()["type"] == "FeatureCollection"


def test_plan_known_and_unknown(client):
    assert client.get("/api/plan/4314902").status_code == 200
    assert client.get("/api/plan/9999999").status_code == 404


def test_tile_png(client):
    r = client.get("/tiles/sar_before/8/91/150.png")
    assert r.status_code == 200 and r.content[:8] == b"\x89PNG\r\n\x1a\n"


def test_tile_unknown_layer_404(client):
    assert client.get("/tiles/nope/8/0/0.png").status_code == 404


def test_tile_expression_mask(client):
    # interactive threshold: b1 < -10 -> constant 1
    r = client.get("/tiles/sar_before/8/91/150.png?expression=b1<-10")
    assert r.status_code == 200 and r.content[:8] == b"\x89PNG\r\n\x1a\n"


def _write_cog(path: Path, arr: np.ndarray):
    path.parent.mkdir(parents=True, exist_ok=True)
    nodata = np.nan if np.issubdtype(arr.dtype, np.floating) else None
    with rasterio.open(
        path, "w", driver="GTiff", height=256, width=256, count=1,
        dtype=str(arr.dtype), crs="EPSG:4326",
        transform=Affine(0.001, 0, -51.0, 0, -0.001, -30.0), nodata=nodata,
    ) as ds:
        ds.write(arr, 1)


def _read_png(content: bytes) -> np.ndarray:
    with rasterio.MemoryFile(content) as mem, mem.open() as ds:
        return ds.read()


def test_tile_rescale_produces_contrast(client, tmp_path):
    # float32 dB raster: ?rescale=-30,0 must stretch values to distinct gray
    # levels. Regression: rescale was passed to render() as **kwargs, silently
    # dropped, and float32 fell back to dtype range -> uniform gray tile.
    import app as appmod

    appmod.LAYERS["sar_var"] = "sar/var.tif"
    arr = np.full((256, 256), -25.0, dtype="float32")
    arr[:, :128] = -5.0
    _write_cog(tmp_path / "sar/var.tif", arr)

    r = client.get("/tiles/sar_var/8/91/150.png?rescale=-30,0")
    assert r.status_code == 200
    gray = _read_png(r.content)[0]
    # buggy fallback maps every dB value to ~127 (float32 dtype range), so
    # max can't exceed ~128; correct rescale stretches -5 dB up to ~212
    assert gray.max() > 150
    assert len(np.unique(gray)) >= 2


def test_tile_colormap_string_keys(client, tmp_path):
    # colormap arrives as JSON -> json.loads yields string keys; the API must
    # coerce them to numbers or no pixel matches and the tile is transparent.
    import app as appmod

    appmod.LAYERS["mask01"] = "sar/m.tif"
    arr = np.zeros((256, 256), dtype="uint8")
    arr[:, :128] = 1
    _write_cog(tmp_path / "sar/m.tif", arr)

    cmap = urllib.parse.quote(json.dumps({"0": [0, 0, 0, 0], "1": [220, 38, 38, 200]}))
    r = client.get(f"/tiles/mask01/8/91/150.png?colormap={cmap}")
    assert r.status_code == 200
    bands = _read_png(r.content)
    assert (bands[0] == 220).any()  # some pixel rendered red


def test_choreo_endpoint(client):
    r = client.get("/api/choreo")
    assert r.status_code == 200
    body = r.json()
    assert body["beats"][0]["date"] == "2024-05-11"


def test_nisar_product_endpoint(client):
    r = client.get("/api/nisar_product")
    assert r.status_code == 200 and r.json()["granule_id"] == "g1"


def test_choreo_and_product_404_when_missing(tmp_path):
    from fastapi.testclient import TestClient

    (tmp_path / "vector").mkdir(parents=True)
    c = TestClient(create_app(tmp_path))
    assert c.get("/api/choreo").status_code == 404
    assert c.get("/api/nisar_product").status_code == 404
