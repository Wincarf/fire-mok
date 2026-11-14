# Fire Mok

[English](README.md) | [Português](README.pt-BR.md) | [Español](README.es.md) | **Français** | [中文](README.zh-CN.md) | [Русский](README.ru.md)

[![CI](https://github.com/Wincarf/fire-mok/actions/workflows/ci.yml/badge.svg)](https://github.com/Wincarf/fire-mok/actions/workflows/ci.yml)
[![monitoring](https://github.com/Wincarf/fire-mok/actions/workflows/update-data.yml/badge.svg)](https://github.com/Wincarf/fire-mok/actions/workflows/update-data.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Plateforme de surveillance des inondations pour le Rio Grande do Sul
(Brésil). Cas d'ancrage : la crue de mai 2024 dans le bassin du Guaíba —
détectée par SAR Sentinel-1 (prête pour NISAR), croisée avec le territoire
(IBGE), le climat (Open-Meteo + NASA POWER), le relief (Copernicus DEM +
HAND) et la population (WorldPop) en un indice de risque municipal avec
un plan d'action traçable jusqu'aux données.

> Les sorties de Fire Mok sont un **score de triage** destiné à aider les
> gestionnaires, pas une alerte officielle de protection civile.

## Essayer en ligne (démo statique)

Application complète, sans backend — la branche [`gh-pages`](https://github.com/Wincarf/fire-mok/tree/gh-pages)
sert les choroplèthes de risque, l'emprise SAR réelle de la crue du
11/05/2024, la comparaison avant/après, l'histoire guidée et les panneaux
municipaux. Les endpoints de l'API sont reflétés en fichiers
(`/api/municipalities`, `/api/layers`, `/api/plan/{code}`, tuiles
pré-rendues z6–12).

- URL : **https://wincarf.github.io/fire-mok/** (activer Pages dans
  *Settings → Pages → Deploy from a branch → gh-pages / root*)
- Régénérer : `cd web && npm run build -- --base=/fire-mok/` puis
  `cd pipeline && uv run python ../scripts/build_pages.py --dist ../web/dist
  --out ../pages_site --data ../data` (les données dans `data/` doivent
  exister).

## Architecture

```
pipeline/   Python 3.13 (uv) : STAC -> COG -> masques -> variables -> risque
api/        FastAPI + rio-tiler : tuiles raster + endpoints JSON
web/        React + Vite + MapLibre : swipe avant/après, couches, curseur σ0
data/       artefacts générés (gitignored)
docs/       méthodologie + specs + plan
.github/    CI (tests) + ingestion quotidienne planifiée de la dernière emprise
```

## Comment exécuter

```bash
# 1) données (une fois ; télécharge ~500 Mo de scènes depuis Planetary Computer)
cd pipeline && uv sync
uv run python scripts/build_may2024.py        # SAR -> emprise d'inondation (avec masques de contexte)
uv run python scripts/build_municipalities.py # IBGE + recensement 2022 + exposition (WorldPop)
uv run python scripts/build_meteo.py --aoi-only
uv run python scripts/build_terrain.py        # Cop DEM -> HAND -> susceptibilité
uv run python scripts/build_risk.py           # indice de risque municipal
uv run python scripts/build_action_plans.py   # plans d'action

# 2) API
uv run uvicorn --app-dir ../api app:app --port 8000   # /healthz vérifie les couches

# 3) application web
cd ../web && npm install && npm run dev       # http://localhost:5173

# ou tout en conteneur
docker build -t fire-mok . && docker run -p 8000:8000 -v "$PWD/data:/app/data" fire-mok
```

Sources publiques uniquement — aucun identifiant Earthdata requis.

## Surveillance continue

- `pipeline/scripts/update_latest.py` récupère la scène Sentinel-1 RTC la
  plus récente sur l'AOI, construit l'emprise par rapport à la scène
  précédente du même passage et applique les masques de contexte
  (`--dry-run` affiche le plan).
- GitHub Actions l'exécute **chaque jour à 09 h (heure de Brasília)**
  (`update-data.yml`) et publie la nouvelle emprise comme artifact.
- Pluie tournée vers l'avenir : l'indice retient la **plus grande** valeur
  entre la pluie observée sur 7 jours et la pluie **prévue** par
  Open-Meteo pour les 7 jours suivants.

## NISAR (bande de validation de la mission)

`pipeline/scripts/validate_nisar.py` télécharge une scène NISAR GCOV via
ASF DAAC et convertit HDF5 -> COG.

- Requiert `EARTHDATA_USERNAME`/`EARTHDATA_PASSWORD` ; sans identifiants,
  le script journalise `skipped: no Earthdata creds` et sort avec succès.
- NISAR (bande L) et Sentinel-1 (bande C) restent dans des **couches
  séparées** — non comparables par différence.

## Validation

- Emprise SAR validée contre Sentinel-2 NDWI (masqué par SCL) sur des
  **puces stratifiées** (moitié avec eau de crue, moitié sèche) : matrice
  de confusion, **F1, IoU et kappa de Cohen par seuil σ0, avec un IC à
  95 % par bootstrap**. La scène optique est classée par proximité
  temporelle avec la scène SAR. Régénérer :
  `uv run python scripts/validate_flood.py --chips 30`.
- Pilote original (4 puces, 2024) : accord moyen de 66,6 % à −17 dB,
  jusqu'à 79 % sur les puces avec inondation réelle — remplacé par le
  rapport avec métriques par classe + IC.
- Les faux positifs documentés (urbain, eau permanente) sont **retirés de
  l'emprise** avec ESA WorldCover 10 m (classes built-up et permanent
  water).
- `cd pipeline && uv run pytest tests/` — 87 tests ; `api/tests/` 9 ;
  `web/` 20 (vitest). La CI exécute les trois sur GitHub Actions.

## Licence

MIT — voir `LICENSE`.
