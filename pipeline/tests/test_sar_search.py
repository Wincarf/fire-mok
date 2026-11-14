import json
from pathlib import Path

import pystac

from pipeline.sar_search import _item_to_scene, search_s1_rtc

FIXTURE = Path(__file__).parent / "fixtures" / "s1_rtc_item.json"


def test_item_to_scene_parses_fixture():
    item = pystac.Item.from_dict(json.loads(FIXTURE.read_text()))
    scene = _item_to_scene(item)
    assert scene.id.startswith("S1A_IW_GRDH")
    assert scene.datetime.startswith("2024-05")
    assert "vv" in scene.assets
    assert scene.assets["vv"].endswith((".tif", ".tiff"))
    assert scene.url == scene.assets["vv"]


def test_search_s1_rtc_empty_returns_list(monkeypatch):
    class _Search:
        def items(self):
            return iter(())

    class _Client:
        def search(self, **kw):
            return _Search()

    monkeypatch.setattr("pipeline.sar_search._stac_client", lambda: _Client())
    assert search_s1_rtc((-51.6, -30.4, -50.7, -29.7), "2024-05-01", "2024-05-31") == []
