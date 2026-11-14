"""Fire Mok API — raster tiles (rio-tiler) + municipal JSON endpoints."""

import json
from pathlib import Path

import rasterio
from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from rasterio.warp import transform_bounds
from rio_tiler.io import COGReader
from rio_tiler.models import ImageData

DATA = Path(__file__).resolve().parents[1] / "data"

LAYERS = {
    "sar_before": "sar/S1A_IW_GRDH_1SDV_20240604T084924_20240604T084953_054171_069681_rtc_vv_db.tif",
    "sar_after": "sar/S1A_IW_GRDH_1SDV_20240511T084943_20240511T085008_053821_068A6E_rtc_vv_db.tif",
    "flood_extent": "sar/flood_extent_may2024.tif",
    "permanent_water": "context/permanent_water_guaiba.tif",
    "urban": "context/urban_guaiba.tif",
    "susceptibility": "terrain/susceptibility_guaiba.tif",
    "hand": "terrain/hand_guaiba.tif",
    "dem": "terrain/cop_dem_glo30_guaiba.tif",
}


def create_app(data_dir: Path | None = None) -> FastAPI:
    data = Path(data_dir) if data_dir else DATA
    app = FastAPI(title="Fire Mok")
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"])

    def layer_path(layer: str) -> Path:
        if layer not in LAYERS:
            raise HTTPException(404, f"unknown layer '{layer}'")
        p = data / LAYERS[layer]
        if not p.exists():
            raise HTTPException(404, f"layer file missing: {p.name}")
        return p

    @app.get("/healthz")
    def healthz():
        available = sum(1 for rel in LAYERS.values() if (data / rel).exists())
        return {"status": "ok", "layers_available": available, "layers_total": len(LAYERS)}

    @app.get("/api/layers")
    def layers():
        out = []
        for name, rel in LAYERS.items():
            p = data / rel
            entry = {"id": name, "available": p.exists()}
            if p.exists():
                with rasterio.open(p) as src:
                    entry["bounds"] = transform_bounds(src.crs, 4326, *src.bounds)
                    entry["dtype"] = src.dtypes[0]
            out.append(entry)
        return {"layers": out}

    @app.get("/tiles/{layer}/{z}/{x}/{y}.png")
    def tile(
        layer: str,
        z: int, x: int, y: int,
        expression: str | None = Query(None),
        rescale: str | None = Query(None),
        colormap: str | None = Query(None),
    ):
        path = layer_path(layer)
        from rio_tiler.errors import TileOutsideBounds

        try:
            with COGReader(str(path)) as cog:
                img = cog.tile(x, y, z, expression=expression)
        except TileOutsideBounds:
            raise HTTPException(404, "tile outside dataset bounds")
        if str(img.array.dtype) == "bool":  # mask expressions render as 0/1
            img = ImageData(img.array.astype("uint8"), assets=img.assets, crs=img.crs, bounds=img.bounds)
        if rescale:  # stretch data to uint8 — render() has no rescale kwarg
            img = img.rescale([tuple(map(float, rescale.split(",")))])
        cmap = (
            {float(k): tuple(v) for k, v in json.loads(colormap).items()}
            if colormap else None
        )  # json keys are strings; pixels match numeric keys only
        png = img.render(img_format="PNG", colormap=cmap)
        return Response(content=png, media_type="image/png")

    @app.get("/api/municipalities")
    def municipalities():
        p = data / "vector" / "municipalities_risk_may2024.geojson"
        if not p.exists():
            raise HTTPException(404, "risk layer not built")
        return json.loads(p.read_text(encoding="utf-8"))

    @app.get("/api/plan/{code}")
    def plan(code: str):
        p = data / "vector" / "action_plans_may2024.json"
        if not p.exists():
            raise HTTPException(404, "action plans not built")
        plans = json.loads(p.read_text(encoding="utf-8"))
        if code not in plans:
            raise HTTPException(404, f"no plan for municipality {code}")
        return plans[code]

    @app.api_route("/api/flood_polygons", methods=["GET", "HEAD"])  # HEAD: web usa para habilitar export
    def flood_polygons():
        p = data / "vector" / "flood_polygons_may2024.geojson"
        if not p.exists():
            raise HTTPException(404, "flood polygons not built")
        return json.loads(p.read_text(encoding="utf-8"))

    return app


app = create_app()

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)
