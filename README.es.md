# Fire Mok

[English](README.md) | [Português](README.pt-BR.md) | **Español** | [Français](README.fr.md) | [中文](README.zh-CN.md) | [Русский](README.ru.md)

[![CI](https://github.com/Wincarf/fire-mok/actions/workflows/ci.yml/badge.svg)](https://github.com/Wincarf/fire-mok/actions/workflows/ci.yml)
[![monitoring](https://github.com/Wincarf/fire-mok/actions/workflows/update-data.yml/badge.svg)](https://github.com/Wincarf/fire-mok/actions/workflows/update-data.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Plataforma de monitoreo de inundaciones para Río Grande del Sur, Brasil.
Caso ancla: la inundación de mayo de 2024 en la cuenca del Guaíba,
detectada en SAR Sentinel-1 (y lista para NISAR), cruzada con territorio
(IBGE), clima (Open-Meteo + NASA POWER), terreno (Copernicus DEM + HAND) y
población (WorldPop) en un índice de riesgo municipal con un plan de acción
cuyas reglas son rastreables hasta los datos.

> Los resultados de Fire Mok son una **puntuación de triaje** para apoyar a
> los gestores, no una alerta oficial de defensa civil.

## Pruébalo en línea (demo estática)

La rama [`gh-pages`](https://github.com/Wincarf/fire-mok/tree/gh-pages)
aloja una versión estática completa de la aplicación: coropletas de riesgo,
extensión SAR real de la inundación del 11/05/2024, comparación antes/después,
historia guiada y paneles municipales — sin backend, con los mismos endpoints
de la API reflejados como archivos (`/api/municipalities`, `/api/layers`,
`/api/plan/{code}` y teselas pregeneradas en z6–12).

- URL: **https://wincarf.github.io/fire-mok/** (tras activar Pages en
  *Settings → Pages → Deploy from a branch → gh-pages / root*)
- Para regenerar: `cd web && npm run build -- --base=/fire-mok/` y luego
  `cd pipeline && uv run python ../scripts/build_pages.py --dist ../web/dist
  --out ../pages_site --data ../data` (los datos en `data/` deben existir).

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

Todo el flujo anterior funciona sin credenciales de Earthdata (solo
fuentes públicas).

## Monitoreo continuo

- `pipeline/scripts/update_latest.py` busca la escena Sentinel-1 RTC más
  reciente sobre el AOI, construye la extensión contra la escena anterior
  del mismo pase y aplica las máscaras de contexto (`--dry-run` muestra el
  plan).
- GitHub Actions lo ejecuta **a diario a las 09:00 (hora de Brasilia)**
  (`update-data.yml`) y publica la nueva extensión como artifact.
- El índice de riesgo usa la **mayor** entre la lluvia observada en 7 días y
  la lluvia **pronosticada** para los próximos 7 días (Open-Meteo forecast):
  el componente pasa a mirar hacia adelante.

## NISAR (banda de validación de la misión)

`pipeline/scripts/validate_nisar.py` descarga una escena NISAR GCOV vía ASF
DAAC y convierte HDF5 -> COG. Requiere
`EARTHDATA_USERNAME`/`EARTHDATA_PASSWORD`; sin credenciales el script
registra `skipped: no Earthdata creds` y termina con éxito. NISAR (banda L)
y Sentinel-1 (banda C) viven en **capas separadas** — no son comparables por
diferencia.

## Validación

- La extensión SAR se valida contra Sentinel-2 NDWI (con máscara SCL) en
  **chips estratificados** (mitad con agua de inundación presente, mitad
  seca): matriz de confusión, **F1, IoU y kappa de Cohen por umbral σ0, con
  intervalo de confianza del 95% por bootstrap** entre chips. La escena
  óptica se ordena por proximidad temporal a la escena SAR. Informe
  regenerable: `uv run python scripts/validate_flood.py --chips 30`.
- Piloto original (4 chips, 2024): acuerdo medio del 66,6% a −17 dB, hasta
  79% en chips con inundación real — cifras del piloto, sin IC; el nuevo
  informe las sustituye por métricas por clase + IC.
- Los falsos positivos documentados (urbano, agua permanente) se **recortan
  de la extensión** con ESA WorldCover 10 m (clases built-up y permanent
  water).
- `cd pipeline && uv run pytest tests/` — 87 tests; `api/tests/` con 9;
  `web/` con 20 (vitest). CI ejecuta los tres en GitHub Actions.

## Guion de demo (3 min)

1. El mapa abre en el swipe: a la izquierda σ0 del 04/06/2024 (recesión), a
   la derecha 11/05/2024 (pico). Arrastra el divisor — el Guaíba "se llena"
   en pantalla.
2. Activa "Water where it shouldn't be" — rojo = agua nueva detectada (ya
   limpia de urbano y agua permanente).
3. Mueve el deslizador σ0 (−25 → −10 dB): la máscara de agua cambia en vivo:
   demuestra que el umbral es una decisión, no un número mágico.
4. Haz clic en Eldorado do Sul o Charqueadas: riesgo `critical`, población
   expuesta sumada desde la malla WorldPop sobre los píxeles inundados,
   plan de acción con razones rastreables a los datos.
5. Compara con Canoas/POA (`high`) y un municipio de sierra (`low`) — el
   índice ordena la prioridad de gestión.

## Honestidad / limitaciones

Ver `docs/methodology.md`, sección 6: la línea base es recesión (no
pre-evento), umbral global fijo, resolución ~10 m, WorldPop 2020 (no es el
Censo 2022), HAND con umbral de triaje (no hidráulica), índice calibrado
cualitativamente contra un único evento.

## Licencia

MIT — ver `LICENSE`.
