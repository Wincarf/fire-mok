# Fire Mok

**English** | [Português](README.pt-BR.md) | [Español](README.es.md) | [Français](README.fr.md) | [中文](README.zh-CN.md) | [Русский](README.ru.md)

[![CI](https://github.com/Wincarf/fire-mok/actions/workflows/ci.yml/badge.svg)](https://github.com/Wincarf/fire-mok/actions/workflows/ci.yml)
[![monitoring](https://github.com/Wincarf/fire-mok/actions/workflows/update-data.yml/badge.svg)](https://github.com/Wincarf/fire-mok/actions/workflows/update-data.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Flood monitoring platform for Rio Grande do Sul, Brazil.
Anchor case: the May 2024 flood in the Guaíba basin, detected in Sentinel-1
SAR (and ready for NISAR), crossed with territory (IBGE), weather
(Open-Meteo + NASA POWER), terrain (Copernicus DEM + HAND) and population
(WorldPop) into a municipal risk index with an action plan whose every rule
is traceable to the data.

> Fire Mok outputs are a **triage score** to support managers, not an
> official civil-defense alert.

## Try it online (static demo)

The [`gh-pages`](https://github.com/Wincarf/fire-mok/tree/gh-pages) branch
hosts a complete static version of the app: risk choropleth, real SAR extent
of the May 11, 2024 flood, before/after compare, guided story and municipal
panels — no backend, with the same API endpoints mirrored as files
(`/api/municipalities`, `/api/layers`, `/api/plan/{code}` plus pre-rendered
tiles at z6–12).

- URL: **https://wincarf.github.io/fire-mok/** (after enabling Pages under
  *Settings → Pages → Deploy from a branch → gh-pages / root*)
- To regenerate: `cd web && npm run build -- --base=/fire-mok/` then
  `cd pipeline && uv run python ../scripts/build_pages.py --dist ../web/dist
  --out ../pages_site --data ../data` (data in `data/` must exist).

## Architecture

```
pipeline/   Python 3.13 (uv): STAC -> COG -> masks -> features -> risk
api/        FastAPI + rio-tiler: raster tiles + JSON endpoints
web/        React + Vite + MapLibre: before/after swipe, layers, σ0 slider
data/       generated artifacts (gitignored)
docs/       methodology + specs + plan
.github/    CI (tests) + daily scheduled ingestion of the latest extent
```

## How to run

```bash
# 1) data (once; downloads ~500 MB of scenes from Planetary Computer)
cd pipeline && uv sync
uv run python scripts/build_may2024.py        # SAR -> flood extent (with context masks)
uv run python scripts/build_municipalities.py # IBGE + 2022 Census + exposure (WorldPop)
uv run python scripts/build_meteo.py --aoi-only
uv run python scripts/build_terrain.py        # Cop DEM -> HAND -> susceptibility
uv run python scripts/build_risk.py           # municipal risk index
uv run python scripts/build_action_plans.py   # action plans

# 2) API
uv run uvicorn --app-dir ../api app:app --port 8000   # /healthz checks layers

# 3) web app
cd ../web && npm install && npm run dev       # http://localhost:5173

# or everything in a container
docker build -t fire-mok . && docker run -p 8000:8000 -v "$PWD/data:/app/data" fire-mok
```

The whole path above works without Earthdata credentials (public sources
only).

## Continuous monitoring

- `pipeline/scripts/update_latest.py` fetches the most recent Sentinel-1 RTC
  scene over the AOI, builds the extent against the previous scene of the
  same pass and applies the context masks (`--dry-run` prints the plan).
- GitHub Actions runs this **daily at 09:00 Brasília time** (`update-data.yml`)
  and publishes the new extent as an artifact.
- The risk index uses the **larger** of the rain observed over the last 7
  days and the rain **forecast** for the next 7 days (Open-Meteo forecast) —
  the component now looks forward.

## NISAR (mission validation band)

`pipeline/scripts/validate_nisar.py` downloads a NISAR GCOV scene via ASF
DAAC and converts HDF5 -> COG. Requires
`EARTHDATA_USERNAME`/`EARTHDATA_PASSWORD`; without credentials the script
logs `skipped: no Earthdata creds` and exits successfully. NISAR (L-band) and
Sentinel-1 (C-band) live in **separate layers** — they are not comparable by
difference.

## Validation

- The SAR extent is validated against Sentinel-2 NDWI (SCL-masked) on
  **stratified chips** (half with flood water present, half dry): confusion
  matrix, **F1, IoU and Cohen's kappa per σ0 threshold, with a 95% bootstrap
  confidence interval** across chips. The optical scene is ranked by temporal
  proximity to the SAR scene. Regenerable report:
  `uv run python scripts/validate_flood.py --chips 30`.
- Original pilot (4 chips, 2024): mean agreement 66.6% at −17 dB, up to 79%
  on chips with real flooding — pilot numbers, no CI; the new report replaces
  them with per-class metrics + CI.
- Documented false positives (urban, permanent water) are **cut from the
  extent** with ESA WorldCover 10 m (built-up and permanent water classes).
- `cd pipeline && uv run pytest tests/` — 87 tests; `api/tests/` has 9;
  `web/` has 20 (vitest). CI runs all three on GitHub Actions.

## Demo script (3 min)

1. The map opens on the swipe: left is σ0 from Jun 04, 2024 (recession),
   right May 11, 2024 (peak). Drag the divider — the Guaíba "fills up" on
   screen.
2. Turn on "Water where it shouldn't be" — red = newly detected water
   (already cleaned of urban and permanent water).
3. Move the σ0 slider (−25 → −10 dB): the water mask changes live — showing
   that the threshold is a decision, not a magic number.
4. Click Eldorado do Sul or Charqueadas: `critical` risk, exposed population
   summed from the WorldPop grid over the flooded pixels, action plan with
   reasons traceable to the data.
5. Compare with Canoas/POA (`high`) and a mountain municipality (`low`) —
   the index ranks management priority.

## Honesty / limitations

See `docs/methodology.md` section 6: the baseline is recession (not
pre-event), fixed global threshold, ~10 m resolution, WorldPop 2020 (not the
2022 Census), HAND with a triage threshold (not hydraulics), an index
calibrated qualitatively against a single event.

## License

MIT — see `LICENSE`.
