# Fire Mok

[English](README.md) | [Português](README.pt-BR.md) | [Español](README.es.md) | [Français](README.fr.md) | [中文](README.zh-CN.md) | **Русский**

[![CI](https://github.com/Wincarf/fire-mok/actions/workflows/ci.yml/badge.svg)](https://github.com/Wincarf/fire-mok/actions/workflows/ci.yml)
[![monitoring](https://github.com/Wincarf/fire-mok/actions/workflows/update-data.yml/badge.svg)](https://github.com/Wincarf/fire-mok/actions/workflows/update-data.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Платформа мониторинга наводнений для штата Риу-Гранди-ду-Сул (Бразилия).
Опорный случай: наводнение мая 2024 года в бассейне Гуаибы — обнаружено
по данным SAR Sentinel-1 (готово к NISAR) и сопоставлено с территорией
(IBGE), погодой (Open-Meteo + NASA POWER), рельефом (Copernicus DEM +
HAND) и населением (WorldPop) в муниципальный индекс риска с планом
действий, прослеживаемым до данных.

> Результаты Fire Mok — это **триаж-оценка** для поддержки руководителей,
> а не официальное оповещение гражданской обороны.

## Попробовать онлайн (статическая демо-версия)

Полное приложение без бэкенда — ветка [`gh-pages`](https://github.com/Wincarf/fire-mok/tree/gh-pages)
отдаёт хороплет риска, реальный SAR-контур наводнения от 11.05.2024,
сравнение «до/после», управляемый сюжет и панели муниципалитетов.
Конечные точки API зеркалируются файлами (`/api/municipalities`,
`/api/layers`, `/api/plan/{code}`, предрендеренные тайлы z6–12).

- URL: **https://wincarf.github.io/fire-mok/** (включите Pages в
  *Settings → Pages → Deploy from a branch → gh-pages / root*)
- Регенерация: `cd web && npm run build -- --base=/fire-mok/`, затем
  `cd pipeline && uv run python ../scripts/build_pages.py --dist ../web/dist
  --out ../pages_site --data ../data` (данные в `data/` должны существовать).

## Архитектура

```
pipeline/   Python 3.13 (uv): STAC -> COG -> маски -> признаки -> риск
api/        FastAPI + rio-tiler: растровые тайлы + JSON-эндпоинты
web/        React + Vite + MapLibre: свайп до/после, слои, ползунок σ0
data/       сгенерированные артефакты (gitignored)
docs/       методология + спецификации + план
.github/    CI (тесты) + ежедневный плановый приём последнего контура
```

## Как запустить

```bash
# 1) данные (один раз; загружает ~500 МБ сцен с Planetary Computer)
cd pipeline && uv sync
uv run python scripts/build_may2024.py        # SAR -> контур наводнения (с контекстными масками)
uv run python scripts/build_municipalities.py # IBGE + перепись 2022 + экспозиция (WorldPop)
uv run python scripts/build_meteo.py --aoi-only
uv run python scripts/build_terrain.py        # Cop DEM -> HAND -> уязвимость
uv run python scripts/build_risk.py           # муниципальный индекс риска
uv run python scripts/build_action_plans.py   # планы действий

# 2) API
uv run uvicorn --app-dir ../api app:app --port 8000   # /healthz проверяет слои

# 3) веб-приложение
cd ../web && npm install && npm run dev       # http://localhost:5173

# или всё в контейнере
docker build -t fire-mok . && docker run -p 8000:8000 -v "$PWD/data:/app/data" fire-mok
```

Только открытые источники — учётные данные Earthdata не нужны.

## Непрерывный мониторинг

- `pipeline/scripts/update_latest.py` загружает самую свежую сцену
  Sentinel-1 RTC над AOI, строит контур по предыдущей сцене того же витка
  и применяет контекстные маски (`--dry-run` показывает план).
- GitHub Actions запускает это **ежедневно в 09:00 по времени Бразилии**
  (`update-data.yml`) и публикует новый контур как artifact.
- Осадки с взглядом вперёд: индекс риска использует **бо́льшее** из
  значений — наблюдённые за 7 дней осадки и **прогноз** Open-Meteo на
  следующие 7 дней.

## NISAR (диапазон валидации миссии)

`pipeline/scripts/validate_nisar.py` скачивает сцену NISAR GCOV через ASF
DAAC и конвертирует HDF5 -> COG.

- Требует `EARTHDATA_USERNAME`/`EARTHDATA_PASSWORD`; без учётных данных
  скрипт логирует `skipped: no Earthdata creds` и завершается успешно.
- NISAR (L-диапазон) и Sentinel-1 (C-диапазон) хранятся в **отдельных
  слоях** — несравнимы через разность.

## Валидация

- SAR-контур валидируется против Sentinel-2 NDWI (с маской SCL) на
  **стратифицированных чипах** (половина с водой наводнения, половина
  сухая): матрица ошибок, **F1, IoU и каппа Коэна по порогу σ0, с 95%-м
  доверительным интервалом по bootstrap**. Оптическая сцена ранжируется
  по временной близости к сцене SAR. Регенерация отчёта:
  `uv run python scripts/validate_flood.py --chips 30`.
- Первоначальный пилот (4 чипа, 2024): среднее согласие 66,6% при −17 дБ,
  до 79% на чипах с реальным наводнением — заменён отчётом с метриками по
  классам + ДИ.
- Задокументированные ложные срабатывания (застройка, постоянные водоёмы)
  **вырезаются из контура** с помощью ESA WorldCover 10 м (классы
  built-up и permanent water).
- `cd pipeline && uv run pytest tests/` — 87 тестов; `api/tests/` — 9;
  `web/` — 20 (vitest). CI запускает все три в GitHub Actions.

## Лицензия

MIT — см. `LICENSE`.
