import json
import sys
from pathlib import Path

import numpy as np
import pytest
import rasterio
from affine import Affine

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import create_app

LAYERS = ["sar_before", "sar_after", "flood_extent", "susceptibility", "dem"]


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
        "flood_extent": "sar/f.tif", "susceptibility": "terrain/s.tif",
        "dem": "terrain/d.tif",
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
    return TestClient(create_app(tmp_path))


def test_layers_manifest(client):
    r = client.get("/api/layers")
    assert r.status_code == 200
    assert all(e["available"] for e in r.json()["layers"])


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
