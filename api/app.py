"""Fire Mok API — raster tiles (rio-tiler) + municipal JSON endpoints."""

import json
from pathlib import Path

import numpy as np
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
    "susceptibility": "terrain/susceptibility_guaiba.tif",
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

    SCENE_NX = 512

    def scene_grid():
        """Common AOI grid for the cinematic scene, derived from the DEM."""
        path = layer_path("dem")
        with rasterio.open(path) as src:
            w, s, e, n = transform_bounds(src.crs, 4326, *src.bounds)
        ny = max(1, round(SCENE_NX * (n - s) / (e - w)))
        lat0 = (s + n) / 2
        cellsize_m = (e - w) * 111320 * np.cos(np.radians(lat0)) / SCENE_NX
        return {"bounds": [w, s, e, n], "nx": SCENE_NX, "ny": ny, "cellsize_m": cellsize_m}

    def read_grid(layer: str, grid: dict, resampling, dtype: str) -> bytes:
        # WarpedVRT reprojects into the DEM grid — layers with slightly
        # different extents can't just be stretched via read(out_shape)
        from rasterio.transform import from_bounds
        from rasterio.vrt import WarpedVRT

        w, s, e, n = grid["bounds"]
        transform = from_bounds(w, s, e, n, grid["nx"], grid["ny"])
        with rasterio.open(layer_path(layer)) as src:
            with WarpedVRT(
                src,
                crs="EPSG:4326",
                transform=transform,
                width=grid["nx"],
                height=grid["ny"],
                resampling=resampling,
            ) as vrt:
                arr = vrt.read(1, masked=True).filled(0)
        return arr.astype(dtype).tobytes()

    @app.get("/api/scene")
    def scene():
        return scene_grid()

    @app.get("/api/scene/heightmap")
    def scene_heightmap():
        from rasterio.enums import Resampling

        grid = scene_grid()
        data = read_grid("dem", grid, Resampling.bilinear, "<f4")
        return Response(content=data, media_type="application/octet-stream")

    @app.get("/api/scene/flood")
    def scene_flood():
        from rasterio.enums import Resampling

        grid = scene_grid()
        data = read_grid("flood_extent", grid, Resampling.nearest, "uint8")
        return Response(content=data, media_type="application/octet-stream")

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

    @app.get("/api/flood_polygons")
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
