# Fire Mok

[English](README.md) | [Português](README.pt-BR.md) | **Español** | [Français](README.fr.md) | [中文](README.zh-CN.md) | [Русский](README.ru.md) | [العربية](README.ar.md)

[![CI](https://github.com/Wincarf/fire-mok/actions/workflows/ci.yml/badge.svg)](https://github.com/Wincarf/fire-mok/actions/workflows/ci.yml)
[![monitoring](https://github.com/Wincarf/fire-mok/actions/workflows/update-data.yml/badge.svg)](https://github.com/Wincarf/fire-mok/actions/workflows/update-data.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Plataforma de monitoreo de inundaciones para Río Grande del Sur, Brasil.
Caso ancla: la inundación de mayo de 2024 en la cuenca del Guaíba —
detectada en SAR Sentinel-1 (con NISAR GCOV integrado), cruzada con territorio
(IBGE), clima (Open-Meteo + NASA POWER), terreno (Copernicus DEM + HAND)
y población (WorldPop) en un índice de riesgo municipal con un plan de
acción rastreable hasta los datos.

> Los resultados de Fire Mok son una **puntuación de triaje** para apoyar
> a los gestores, no una alerta oficial de defensa civil.

## Pruébalo en línea (demo estática)

App completa, sin backend — la rama [`gh-pages`](https://github.com/Wincarf/fire-mok/tree/gh-pages)
sirve coropletas de riesgo, la extensión SAR real de la inundación del
11/05/2024, comparación antes/después, historia guiada, paneles
municipales y las tres capas NISAR de banda L (retrodispersión, agua
abierta, dueto C×L). Los endpoints de la API se reflejan como archivos
(`/api/municipalities`, `/api/layers`, `/api/plan/{code}`, teselas
pregeneradas z6–12).

- URL: **https://wincarf.github.io/fire-mok/** (activa Pages en
  *Settings → Pages → Deploy from a branch → gh-pages / root*)
- Regenerar: `cd web && npm run build -- --base=/fire-mok/` y luego
  `cd pipeline && uv run python ../scripts/build_pages.py --dist ../web/dist
  --out ../pages_site --data ../data` (los datos en `data/` deben existir).

## La Danza y la tarjeta del lunes (nuevo)

- **La Danza** — tres latidos reales de Sentinel-1 sobre la inundación de
  mayo de 2024, en un deslizador temporal con reproducción: **pico 11/may
  (203,7 km², ~70,8 mil personas expuestas) → recesión 30/may (47,6 km²)
  → calma 4/jun (0 km²)**. Generada por `pipeline/scripts/build_choreo.py`
  (lecturas RTC de Planetary Computer en una rejilla común, limpieza
  WorldCover, exposición areal por municipio).
- **Tarjeta del lunes** — un clic convierte el latido elegido en una
  alerta en portugués lista para WhatsApp (copiar y pegar). Cada línea
  proviene de datos reales; las líneas sin fuente (p. ej., escuelas y
  hospitales de OSM cuando Overpass no está accesible) simplemente se
  omiten — nunca se inventan.
- **Duet NISAR** — el modo dividido C×L y las tres capas de banda L
  (retrodispersión, agua abierta, dueto) ya están **en vivo**: el primer
  producto banda L (gránulo GCOV del 01/11/2026) fue generado por el
  workflow diario y publicado en gh-pages. Para reproducirlo: cuenta
  Earthdata gratuita con los campos de perfil obligatorios (Study Area) +
  autorización de la app ASF → secrets del repositorio → ejecutar
  *monitoring update*.
- Nuevos endpoints: `/api/choreo` y `/api/nisar_product`.

## Arquitectura

```
pipeline/   Python 3.13 (uv): STAC -> COG -> máscaras -> variables -> riesgo
api/        FastAPI + rio-tiler: teselas ráster + endpoints JSON
web/        React + Vite + MapLibre: swipe antes/después, capas, deslizador σ0
data/       artefactos generados (gitignored)
docs/       metodología + especificaciones + plan
.github/    CI (tests) + ingestión diaria programada de la última extensión
```

## Cómo ejecutar

```bash
# 1) datos (una vez; descarga ~500 MB de escenas de Planetary Computer)
cd pipeline && uv sync
uv run python scripts/build_may2024.py        # SAR -> extensión de inundación (con máscaras de contexto)
uv run python scripts/build_municipalities.py # IBGE + Censo 2022 + exposición (WorldPop)
uv run python scripts/build_meteo.py --aoi-only
uv run python scripts/build_terrain.py        # Cop DEM -> HAND -> susceptibilidad
uv run python scripts/build_risk.py           # índice de riesgo municipal
uv run python scripts/build_action_plans.py   # planes de acción

# 2) API
uv run uvicorn --app-dir ../api app:app --port 8000   # /healthz comprueba las capas

# 3) aplicación web
cd ../web && npm install && npm run dev       # http://localhost:5173

# o todo en contenedor
docker build -t fire-mok . && docker run -p 8000:8000 -v "$PWD/data:/app/data" fire-mok
```

Solo fuentes públicas — sin credenciales de Earthdata.

## Monitoreo continuo

- `pipeline/scripts/update_latest.py` busca la escena Sentinel-1 RTC más
  reciente sobre el AOI, construye la extensión contra la escena anterior
  del mismo pase y aplica las máscaras de contexto (`--dry-run` muestra el
  plan).
- ¿Sin par de cobertura completa en la ventana de 14 días y con el espacio
  de trabajo vacío (CI nuevo)? Reconstruye la extensión de referencia con
  una ventana de 30 días, para que el dueto C×L siempre tenga una
  contraparte banda C.
- GitHub Actions lo ejecuta **a diario a las 09:00 (hora de Brasilia)**
  (`update-data.yml`) y publica la nueva extensión como artifact.
- Lluvia con vista al futuro: el índice usa la **mayor** entre la lluvia
  observada en los últimos 7 días y el **pronóstico** Open-Meteo de los
  próximos 7 días.

## NISAR (NASA–ISRO, banda L) — en vivo

NISAR está integrado en el pipeline de monitoreo (`pipeline/scripts/build_nisar.py`):

- **Siempre**: búsqueda ASF anónima sobre el AOI → inventario público de
  escenas en `/api/nisar` (60 escenas GCOV sobre el AOI Guaíba en el último
  año; corre a diario en CI).
- **Con una cuenta Earthdata gratuita** (`EARTHDATA_USER`/`EARTHDATA_PASS`
  o netrc): descarga el gránulo GCOV más reciente, convierte HDF5 → COG
  (dB) y genera el dB de la ventana del AOI, el proxy de agua abierta y el
  **diff del dueto C×L** contra la extensión Sentinel-1 más reciente — todo
  publicado en `/api/nisar_product` y en cada plan de acción (bloque
  `nisar` en `/api/plan/{code}`). Credenciales ausentes **o rechazadas**
  (p. ej., un perfil EDL incompleto) caen a `inventory-only`: el run sigue
  en verde y el monitoreo diario nunca se bloquea.

Banda L y banda C viven en **capas separadas**; el **dueto C×L** compara
sus máscaras de agua (3 clases: solo C / solo L) en fechas rotuladas —
nunca una diferencia bruta de dB.

## Validación

- Extensión SAR validada contra Sentinel-2 NDWI (máscara SCL) en **chips
  estratificados** (mitad con agua de inundación, mitad seca): matriz de
  confusión, **F1, IoU y kappa de Cohen por umbral σ0, con IC del 95% por
  bootstrap**. La escena óptica se ordena por proximidad temporal a la
  escena SAR. Regenerar:
  `uv run python scripts/validate_flood.py --chips 30`.
- Piloto original (4 chips, 2024): 66,6% de acuerdo medio a −17 dB, hasta
  79% en chips con inundación real — sustituido por el informe con
  métricas por clase + IC.
- Los falsos positivos documentados (urbano, agua permanente) se
  **recortan de la extensión** con ESA WorldCover 10 m (clases built-up y
  permanent water).
- `cd pipeline && uv run pytest tests/` — 95 tests; `api/tests/` 12;
  `web/` 20 (vitest). CI ejecuta los tres en GitHub Actions.

## Licencia

MIT — ver `LICENSE`.
