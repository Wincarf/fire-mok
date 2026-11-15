# Fire Mok

[English](README.md) | [Português](README.pt-BR.md) | [Español](README.es.md) | [Français](README.fr.md) | [中文](README.zh-CN.md) | **Русский**

[![CI](https://github.com/Wincarf/fire-mok/actions/workflows/ci.yml/badge.svg)](https://github.com/Wincarf/fire-mok/actions/workflows/ci.yml)
[![monitoring](https://github.com/Wincarf/fire-mok/actions/workflows/update-data.yml/badge.svg)](https://github.com/Wincarf/fire-mok/actions/workflows/update-data.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Платформа мониторинга наводнений для штата Риу-Гранди-ду-Сул (Бразилия).
Опорный случай: наводнение мая 2024 года в бассейне Гуаибы — обнаружено
по данным SAR Sentinel-1 (интегрирован NISAR GCOV) и сопоставлено с территорией
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

## Танец воды и карточка на понедельник (новое)

- **Танец воды** — три реальных такта Sentinel-1 над наводнением мая 2024
  года, в слайдере времени с авто-проигрыванием: **пик 11 мая (203,7 км²,
  ~70,8 тыс. человек в зоне риска) → спад 30 мая (47,6 км²) → покой 4 июня
  (0 км²)**. Строится скриптом `pipeline/scripts/build_choreo.py`
  (оконные чтения RTC из Planetary Computer на общей сетке, очистка
  WorldCover, ареальная оценка экспозиции по муниципалитетам).
- **Карточка на понедельник** — один клик превращает выбранный такт в
  готовое для WhatsApp предупреждение на португальском (копировать и
  вставить). Каждая строка опирается на реальные данные; строки без
  источника (например, школы/больницы OSM при недоступности Overpass)
  просто опускаются — никогда не выдумываются.
- **Дуэт NISAR** — режим разделения C×L и три слоя L-диапазона уже встроены
  и появятся сами, как только появится первый продукт L-band (бесплатная
  учётная запись Earthdata → secrets репозитория → запустить
  *monitoring update*).
- Новые эндпоинты: `/api/choreo` и `/api/nisar_product`.

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

## NISAR (NASA–ISRO, L-диапазон) — интегрирован

NISAR подключён к конвейеру мониторинга (`pipeline/scripts/build_nisar.py`):

- **Всегда**: анонимный поиск ASF по AOI → публичный каталог сцен в
  `/api/nisar` (60 сцен GCOV над AOI Гуаибы за последний год; выполняется
  ежедневно в CI).
- **С бесплатным логином Earthdata** (`EARTHDATA_USER`/`EARTHDATA_PASS`
  или netrc): загружает последний гранул GCOV, конвертирует HDF5 → COG
  (dB) и публикует прокси открытой воды L-диапазона в каждом плане
  действий (блок `nisar` в `/api/plan/{code}`). Без учётных данных скрипт
  пишет `inventory-only` и завершается успешно.

NISAR (L-диапазон) и Sentinel-1 (C-диапазон) хранятся в **отдельных
слоях** — несопоставимы по разности.
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
- `cd pipeline && uv run pytest tests/` — 93 теста; `api/tests/` — 12;
  `web/` — 20 (vitest). CI запускает все три в GitHub Actions.

## Лицензия

MIT — см. `LICENSE`.
