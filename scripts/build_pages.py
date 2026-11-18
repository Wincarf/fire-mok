"""Static mirror of the API + pre-rendered tiles for GitHub Pages.

Replicates api/app.py behavior exactly (colormaps/rescale come from the shared
api/layers.json manifest — same file the web app reads) so the same URLs work
on static hosting: /tiles/*.png (query ignored), /api/municipalities,
/api/layers, /api/flood_polygons, /api/plan/{code}.

Usage (from pipeline venv):
    cd pipeline && uv run python ../scripts/build_pages.py \
        --dist ../web/dist --out ../pages_site --data ../data
"""

import argparse
import json
import math
import shutil
import sys
from pathlib import Path

import rasterio
from rasterio.warp import transform_bounds
from rio_tiler.io import COGReader
from rio_tiler.models import ImageData

MANIFEST_PATH = Path(__file__).resolve().parents[1] / "api" / "layers.json"
AOI_BBOX = (-51.6, -30.4, -50.7, -29.7)  # pipeline/aoi.py "guaiba"


def _tile_xy(lon: float, lat: float, z: int) -> tuple[float, float]:
    """lon/lat (4326) -> fractional tile indices (no 3857 detour)."""
    x = (lon + 180.0) / 360.0 * 2**z
    lr = math.radians(lat)
    y = (1.0 - math.asinh(math.tan(lr)) / math.pi) / 2.0 * 2**z
    return x, y


def _render_cmap(entry: dict):
    """Manifest render.colormap ({'0': rgba, ...}) -> rio-tiler colormap."""
    raw = entry.get("render", {}).get("colormap")
    return {float(k): tuple(v) for k, v in raw.items()} if raw else None


def render_layer(
    name: str, entry: dict, out_dir: Path, data: Path, z_range: range
) -> int:
    """Pre-render every tile in z_range intersecting AOI∩bounds. Returns tile count."""
    rel = entry["path"]
    path = data / rel
    if not path.exists():
        print(f"  [skip] {name}: {rel} missing")
        return 0
    cmap = _render_cmap(entry)
    rescale = entry.get("render", {}).get("rescale")
    n = 0
    skipped = 0
    first_err = None
    with COGReader(str(path)) as cog:
        # clamp the tile sweep to AOI ∩ data bounds (scene footprints can be
        # wider); cog.bounds may be in a projected CRS — normalize to 4326 first
        b = transform_bounds(cog.crs, "EPSG:4326", *cog.bounds, densify_pts=21)
        lo = (max(b[0], AOI_BBOX[0]), max(b[1], AOI_BBOX[1]), min(b[2], AOI_BBOX[2]), min(b[3], AOI_BBOX[3]))
        for z in z_range:
            x0, y1 = _tile_xy(lo[0], lo[1], z)
            x1, y0 = _tile_xy(lo[2], lo[3], z)
            for tx in range(max(0, int(x0)), min(2**z, int(x1) + 1)):
                for ty in range(max(0, int(y0)), min(2**z, int(y1) + 1)):
                    try:
                        img = cog.tile(tx, ty, z)
                    except Exception as exc:
                        skipped += 1
                        if first_err is None:
                            first_err = f"{z}/{tx}/{ty}: {exc}"
                        continue
                    if str(img.array.dtype) == "bool":
                        img = ImageData(img.array.astype("uint8"), assets=img.assets, crs=img.crs, bounds=img.bounds)
                    if rescale:
                        img = img.rescale([tuple(rescale)])
                    png = img.render(img_format="PNG", colormap=cmap)
                    d = out_dir / "tiles" / name / str(z) / str(tx)
                    d.mkdir(parents=True, exist_ok=True)
                    (d / f"{ty}.png").write_bytes(png)
                    n += 1
    if skipped:
        print(f"  [warn] {name}: {skipped} tiles skipped (first: {first_err})")
    return n


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dist", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--data", type=Path, required=True)
    ap.add_argument("--min-z", type=int, default=6)
    ap.add_argument("--max-z", type=int, default=12)
    args = ap.parse_args()
    z_range = range(args.min_z, args.max_z + 1)

    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))

    out = args.out
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)

    # 1) built SPA (vite build --base=/fire-mok/)
    shutil.copytree(args.dist, out / "site")
    (out / ".nojekyll").write_text("")

    # maplibre v6 resolves its worker via import.meta.url sibling URL — rollup
    # emits the reference but not the file; copy it (and its shared chunk)
    # from the package so the geojson pipeline works on static hosting
    ng = args.dist.parent / "node_modules" / "maplibre-gl" / "dist"
    assets = out / "site" / "assets"
    for f in ("maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"):
        src = ng / f
        if src.exists():
            shutil.copyfile(src, assets / f)
            print(f"  assets/{f}: copied")

    # 2) static vector endpoints (extensionless, same paths the app fetches)
    api = out / "site" / "api"
    api.mkdir()
    for src, dst in [
        ("vector/municipalities_risk_may2024.geojson", "municipalities"),
        ("vector/flood_polygons_may2024.geojson", "flood_polygons"),
    ]:
        p = args.data / src
        if p.exists():
            shutil.copyfile(p, api / dst)
            print(f"  api/{dst}: {p.stat().st_size / 1e6:.1f} MB")
    # /api/layers — same shape as app.py (id/available/bounds/dtype)
    layers = []
    for name, entry in manifest.items():
        p = args.data / entry["path"]
        item = {"id": name, "available": p.exists()}
        if p.exists():
            with rasterio.open(p) as src:
                item["bounds"] = list(transform_bounds(src.crs, 4326, *src.bounds))
                item["dtype"] = src.dtypes[0]
        layers.append(item)
    (api / "layers").write_text(json.dumps({"layers": layers}))
    # /api/plan/{code} — one extensionless file per municipality
    plans_p = args.data / "vector" / "action_plans_may2024.json"
    if plans_p.exists():
        plans = json.loads(plans_p.read_text(encoding="utf-8"))
        (api / "plan").mkdir()
        for code, body in plans.items():
            (api / "plan" / code).write_text(json.dumps(body, ensure_ascii=False))
        print(f"  api/plan/: {len(plans)} files")

    # 3) pre-rendered tiles (manifest entries flagged prerender)
    total = 0
    for name, entry in manifest.items():
        if not entry.get("prerender"):
            continue
        n = render_layer(name, entry, out / "site", args.data, z_range)
        print(f"  tiles/{name}: {n}")
        total += n

    # move site/* up so the repo-pages root IS the site (index.html at root)
    site = out / "site"
    for item in list(site.iterdir()):
        shutil.move(str(item), str(out / item.name))
    site.rmdir()

    size = sum(f.stat().st_size for f in out.rglob("*") if f.is_file())
    print(f"done: {total} tiles, {size / 1e6:.1f} MB -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
