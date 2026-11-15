# Fire Mok

**English** | [Português](README.pt-BR.md) | [Español](README.es.md) | [Français](README.fr.md) | [中文](README.zh-CN.md) | [Русский](README.ru.md)

[![CI](https://github.com/Wincarf/fire-mok/actions/workflows/ci.yml/badge.svg)](https://github.com/Wincarf/fire-mok/actions/workflows/ci.yml)
[![monitoring](https://github.com/Wincarf/fire-mok/actions/workflows/update-data.yml/badge.svg)](https://github.com/Wincarf/fire-mok/actions/workflows/update-data.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Flood monitoring platform for Rio Grande do Sul, Brazil. Anchor case: the
May 2024 flood in the Guaíba basin — detected in Sentinel-1 SAR
(NISAR GCOV integrated), crossed with territory (IBGE), weather (Open-Meteo + NASA
POWER), terrain (Copernicus DEM + HAND) and population (WorldPop) into a
municipal risk index with an action plan traceable to the data.

> Fire Mok outputs are a **triage score** to support managers, not an
> official civil-defense alert.

## Try it online (static demo)

Full app, no backend — the [`gh-pages`](https://github.com/Wincarf/fire-mok/tree/gh-pages)
branch serves the risk choropleth, the real SAR extent of the May 11, 2024
flood, before/after compare, guided story and municipal panels. API
endpoints are mirrored as files (`/api/municipalities`, `/api/layers`,
`/api/plan/{code}`, pre-rendered tiles z6–12).

- URL: **https://wincarf.github.io/fire-mok/** (enable Pages under
  *Settings → Pages → Deploy from a branch → gh-pages / root*)
- Regenerate: `cd web && npm run build -- --base=/fire-mok/`, then
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

Public sources only — no Earthdata credentials needed.

## Continuous monitoring

- `pipeline/scripts/update_latest.py` fetches the latest Sentinel-1 RTC
  scene over the AOI, builds the extent against the previous scene of the
  same pass and applies the context masks (`--dry-run` prints the plan).
- GitHub Actions runs it **daily at 09:00 Brasília time**
  (`update-data.yml`) and publishes the new extent as an artifact.
- Forward-looking rain: the risk index uses the **larger** of the last 7
  days' observed rain and the 7-day Open-Meteo **forecast**.

## NISAR (NASA–ISRO, L-band) — integrated

NISAR is wired into the monitoring pipeline (`pipeline/scripts/build_nisar.py`):

- **Always**: anonymous ASF search over the AOI → public scene inventory at
  `/api/nisar` (60 GCOV scenes over the Guaíba AOI in the last year; runs
  daily in CI).
- **With a free Earthdata login** (`EARTHDATA_USER`/`EARTHDATA_PASS` or
  netrc): downloads the newest GCOV granule, converts HDF5 → COG (dB) and
  publishes the L-band open-water proxy stats on every action plan
  (`nisar` block in `/api/plan/{code}`). Without credentials the script
  logs `inventory-only` and exits successfully.

NISAR (L-band) and Sentinel-1 (C-band) live in **separate layers** — not
comparable by difference.
## Validation

- SAR extent validated against Sentinel-2 NDWI (SCL-masked) on **stratified
  chips** (half with flood water, half dry): confusion matrix, **F1, IoU
  and Cohen's kappa per σ0 threshold, with a 95% bootstrap CI**. The
  optical scene is ranked by temporal proximity to the SAR scene.
  Regenerate: `uv run python scripts/validate_flood.py --chips 30`.
- Original pilot (4 chips, 2024): 66.6% mean agreement at −17 dB, up to
  79% on real-flood chips — superseded by the per-class + CI report.
- Documented false positives (urban, permanent water) are **cut from the
  extent** with ESA WorldCover 10 m (built-up, permanent water classes).
- `cd pipeline && uv run pytest tests/` — 87 tests; `api/tests/` 9;
  `web/` 20 (vitest). CI runs all three on GitHub Actions.

## License

MIT — see `LICENSE`.
