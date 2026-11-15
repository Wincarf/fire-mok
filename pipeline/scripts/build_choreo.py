"""The Dance: Sentinel-1 flood choreography over the May-2024 Guaíba flood.

Three real beats from the Planetary Computer RTC archive, all differenced
against the June-4 recession baseline (the same dry reference the pipeline
uses for the May-2024 product):

    2024-05-11  peak        (descending track, 08:49 UTC)
    2024-05-30  recession   (different pass, 08:41 UTC — noted in metadata)
    2024-06-04  calm        (the baseline scene itself: extent is empty by
                          construction — the music ended)

No pre-flood scene exists on this track in the archive, so the dance opens
in medias res at the peak.

Outputs (under data/):
  sar/choreo_extent_YYYYMMDD.tif            COG uint8 masks
  vector/choreo_polygons_YYYYMMDD.geojson   per-date polygons
  vector/choreo.json                        beats + per-municipality exposure
                                            (areal interpolation) + OSM
                                            facility counts (best effort)
"""

import argparse
import datetime
import json
import logging
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
import planetary_computer as pc
import rasterio
from rasterio.transform import from_origin
from rasterio.vrt import WarpedVRT
from pystac_client import Client

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pipeline.aoi import get_aoi
from pipeline.masks import clean_flood_extent, fetch_worldcover_for_bounds
from pipeline.water import filter_min_area, flood_extent, mask_to_polygons, write_mask_cog
from pipeline.types import Scene

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("build_choreo")

DATA = Path(__file__).resolve().parents[2] / "data"
MUNIS_URL = "https://wincarf.github.io/fire-mok/api/municipalities"

# common analysis grid: EPSG:4326, ~20 m pixels over the AOI
RES = 0.0002
UTM_S = "EPSG:32722"  # UTM zone 22S — metric areas for the RS AOI
THRESH_DB = -15.0     # same σ0 threshold as the rest of the pipeline
MIN_PX = 25

# (date, label, scene id fragment used to pick the right S1 acquisition)
BEATS = [
    ("2024-05-11", "peak", "20240511T084943"),
    ("2024-05-30", "recession", "20240530T084128"),
    ("2024-06-04", "calm", "20240604T084924"),
]
BASELINE = ("2024-06-04", "20240604T084924")


def find_scene(day: str, fragment: str, bbox) -> Scene:
    cat = Client.open(
        "https://planetarycomputer.microsoft.com/api/stac/v1",
        modifier=pc.sign_inplace,
    )
    start = (datetime.date.fromisoformat(day) - datetime.timedelta(days=1)).isoformat()
    end = (datetime.date.fromisoformat(day) + datetime.timedelta(days=1)).isoformat()
    items = list(
        cat.search(
            collections=["sentinel-1-rtc"], bbox=bbox, datetime=f"{start}/{end}"
        ).items()
    )
    if not items:
        raise RuntimeError(f"no S1 RTC scene near {day} over the AOI")
    pick = next((i for i in items if fragment in i.id), items[0])
    logger.info("%s -> %s", day, pick.id)
    return Scene(id=pick.id, datetime=str(pick.datetime), url="", bbox=bbox), pick


def read_on_grid(vv_href: str, bbox, transform, width: int, height: int) -> np.ndarray:
    """Linear VV power on the common grid, via a warped read (range reads only)."""
    with rasterio.open(vv_href) as src:
        with WarpedVRT(
            src,
            crs="EPSG:4326",
            transform=transform,
            width=width,
            height=height,
            resampling=rasterio.enums.Resampling.bilinear,
        ) as vrt:
            arr = vrt.read(1).astype("float32")
    return np.where(arr > 0, arr, np.nan)


def to_db(linear: np.ndarray) -> np.ndarray:
    out = np.full(linear.shape, np.nan, dtype="float32")
    np.log10(linear, out=out, where=np.isfinite(linear) & (linear > 0))
    out[np.isfinite(out)] *= 10.0
    return out


def load_municipalities(path: Path | None) -> gpd.GeoDataFrame:
    if path and Path(path).exists():
        return gpd.read_file(path)
    import urllib.parse
    import urllib.request

    with urllib.request.urlopen(MUNIS_URL, timeout=60) as r:
        return gpd.read_file(r)


def fetch_facilities(bbox) -> gpd.GeoDataFrame | None:
    """Schools/clinics/hospitals inside the AOI (OSM Overpass, best effort)."""
    import shapely.geometry
    import urllib.request

    min_lon, min_lat, max_lon, max_lat = bbox
    q = (
        "[out:json][timeout:50];"
        f'(node["amenity"~"school|hospital|clinic"]({min_lat},{min_lon},{max_lat},{max_lon});'
        f'way["amenity"~"school|hospital|clinic"]({min_lat},{min_lon},{max_lat},{max_lon});'
        f'relation["amenity"~"school|hospital|clinic"]({min_lat},{min_lon},{max_lat},{max_lon}););'
        "out center;"
    )
    url = "https://overpass-api.de/api/interpreter?data=" + urllib.parse.quote(q)
    try:
        with urllib.request.urlopen(url, timeout=70) as r:
            d = json.loads(r.read().decode("utf-8"))
    except Exception as exc:  # network/overpass failure degrades gracefully
        logger.warning("Overpass unavailable (%s) — facility counts omitted", exc)
        return None
    rows = []
    for el in d.get("elements", []):
        c = el.get("center") or {"lat": el.get("lat"), "lon": el.get("lon")}
        amen = el.get("tags", {}).get("amenity")
        if c.get("lat") is None or c.get("lon") is None or not amen:
            continue
        rows.append(
            {"amenity": amen, "name": el.get("tags", {}).get("name", ""),
             "geometry": shapely.geometry.Point(c["lon"], c["lat"])}
        )
    if not rows:
        return None
    return gpd.GeoDataFrame(rows, geometry="geometry", crs="EPSG:4326")


def muni_stats(polys: gpd.GeoDataFrame, munis: gpd.GeoDataFrame) -> list[dict]:
    """Flooded area + areal-interpolated exposed population per municipality."""
    if polys.empty:
        return []
    polys_m = polys.to_crs(UTM_S)
    munis_m = munis.to_crs(UTM_S)
    out = []
    for _, m in munis_m.iterrows():
        hit = polys_m[polys_m.intersects(m.geometry)]
        if hit.empty:
            continue
        clipped = gpd.clip(hit, m.geometry)
        flooded = float(clipped.area.sum())
        muni_area = float(m.geometry.area)
        if flooded <= 0 or muni_area <= 0:
            continue
        props = munis.loc[[m.name]].iloc[0].to_dict()
        pop = props.get("population") or 0
        out.append(
            {
                "code": str(props.get("code")),
                "name": props.get("name"),
                "flooded_m2": round(flooded),
                "pop_exposed_est": int(round(pop * flooded / muni_area)),
            }
        )
    out.sort(key=lambda r: -r["flooded_m2"])
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--aoi", default="guaiba")
    ap.add_argument("--munis", default=None, help="path to municipalities geojson")
    ap.add_argument("--skip-facilities", action="store_true")
    args = ap.parse_args()
    aoi = get_aoi(args.aoi)

    min_lon, min_lat, max_lon, max_lat = aoi.bbox
    width = int(round((max_lon - min_lon) / RES))
    height = int(round((max_lat - min_lat) / RES))
    transform = from_origin(min_lon, max_lat, RES, RES)
    logger.info("common grid: %dx%d px @ ~20 m", width, height)

    sar_dir = DATA / "sar"
    vec_dir = DATA / "vector"
    vec_dir.mkdir(parents=True, exist_ok=True)

    baseline_day, baseline_frag = BASELINE
    _, base_item = find_scene(baseline_day, baseline_frag, aoi.bbox)
    vv = base_item.assets["vv"]
    baseline_db = to_db(read_on_grid(pc.sign(vv.href), aoi.bbox, transform, width, height))
    logger.info("baseline %s read: %.1f%% valid", baseline_day, 100 * np.isfinite(baseline_db).mean())

    wc = fetch_worldcover_for_bounds(aoi.bbox, transform, "EPSG:4326", (height, width))
    permanent = wc == 80
    urban = wc == 50
    logger.info("worldcover: perm %.1f%%, urban %.1f%%", 100 * permanent.mean(), 100 * urban.mean())

    facilities = None if args.skip_facilities else fetch_facilities(aoi.bbox)

    beats_out = []
    for day, label, frag in BEATS:
        _, item = find_scene(day, frag, aoi.bbox)
        if day == baseline_day:  # the calm beat IS the baseline — no re-read
            db = baseline_db
        else:
            vv = item.assets["vv"]
            db = to_db(read_on_grid(pc.sign(vv.href), aoi.bbox, transform, width, height))
        if day == baseline_day:
            mask = np.zeros_like(db, dtype=bool)
        else:
            mask = flood_extent(baseline_db, db, THRESH_DB)
            mask, stats = clean_flood_extent(mask, permanent, urban)
            mask = filter_min_area(mask, MIN_PX)
            logger.info(
                "%s: removed perm %d px, urban %d px",
                day, stats.get("removed_permanent", 0), stats.get("removed_urban", 0),
            )

        polys = mask_to_polygons(mask, transform, "EPSG:4326")
        cog = write_mask_cog(
            mask,
            {"driver": "GTiff", "height": height, "width": width,
             "crs": "EPSG:4326", "transform": transform},
            sar_dir / f"choreo_extent_{day.replace('-', '')}.tif",
        )
        polys.to_file(vec_dir / f"choreo_polygons_{day.replace('-', '')}.geojson", driver="GeoJSON")
        flooded_m2 = float(polys.to_crs(UTM_S).area.sum())  # metric truth, not px count
        logger.info("%s (%s): %.2f km2, %d polys -> %s", day, label, flooded_m2 / 1e6, len(polys), cog.name)

        munis_stats = muni_stats(polys, load_municipalities(args.munis))
        fac = None
        if facilities is not None and not polys.empty:
            inside = gpd.sjoin(
                facilities, polys[["geometry"]], predicate="within", how="inner"
            )
            fac = {
                "schools": int((inside.amenity == "school").sum()),
                "hospitals": int(inside.amenity.isin(["hospital", "clinic"]).sum()),
            }
        beats_out.append(
            {
                "date": day,
                "label": label,
                "scene_id": item.id,
                "layer": f"choreo_extent_{day.replace('-', '')}",
                "flood_km2": round(flooded_m2 / 1e6, 2),
                "munis_affected": len(munis_stats),
                "pop_exposed_est": sum(m["pop_exposed_est"] for m in munis_stats),
                "municipalities": munis_stats,
                "facilities": fac,
            }
        )

    payload = {
        "product": "Sentinel-1 RTC flood choreography (Guaíba, May-2024 flood)",
        "method": "sigma0 < -15 dB vs 2024-06-04 baseline; WorldCover permanent-water/urban cleaning; min blob 1 ha; population exposure via areal interpolation",
        "baseline_scene": base_item.id,
        "aoi": aoi.name,
        "bbox": list(aoi.bbox),
        "generated": datetime.date.today().isoformat(),
        "beats": beats_out,
    }
    (vec_dir / "choreo.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    logger.info("wrote %s (%d beats)", vec_dir / "choreo.json", len(beats_out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
