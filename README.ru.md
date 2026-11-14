# Fire Mok

[English](README.md) | [Português](README.pt-BR.md) | [Español](README.es.md) | [Français](README.fr.md) | [中文](README.zh-CN.md) | **Русский**

[![CI](https://github.com/Wincarf/fire-mok/actions/workflows/ci.yml/badge.svg)](https://github.com/Wincarf/fire-mok/actions/workflows/ci.yml)
[![monitoring](https://github.com/Wincarf/fire-mok/actions/workflows/update-data.yml/badge.svg)](https://github.com/Wincarf/fire-mok/actions/workflows/update-data.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Платформа мониторинга наводнений для штата Риу-Гранди-ду-Сул (Бразилия).
Опорный случай: наводнение мая 2024 года в бассейне Гуаибы, обнаруженное
по данным SAR Sentinel-1 (и готовое к NISAR) и сопоставленное с
территорией (IBGE), погодой (Open-Meteo + NASA POWER), рельефом
(Copernicus DEM + HAND) и населением (WorldPop) в муниципальный индекс
риска с планом действий, где каждое правило прослеживается до данных.

> Результаты Fire Mok — это **триаж-оценка** для поддержки руководителей,
> а не официальное оповещение гражданской обороны.

## Попробовать онлайн (статическая демо-версия)

Ветка [`gh-pages`](https://github.com/Wincarf/fire-mok/tree/gh-pages)
размещает полную статическую версию приложения: хороплет риска, реальный
SAR-контур наводнения от 11.05.2024, сравнение «до/после», управляемый
сюжет и панели муниципалитетов — без бэкенда, с теми же конечными точками
API, зеркалируемыми файлами (`/api/municipalities`, `/api/layers`,
`/api/plan/{code}` и предрендеренными тайлами z6–12).

- URL: **https://wincarf.github.io/fire-mok/** (после включения Pages в
  *Settings → Pages → Deploy from a branch → gh-pages / root*)
- Для регенерации: `cd web && npm run build -- --base=/fire-mok/`, затем
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

Весь путь выше работает без учётных данных Earthdata (только открытые
источники).

## Непрерывный мониторинг

- `pipeline/scripts/update_latest.py` загружает самую свежую сцену
  Sentinel-1 RTC над AOI, строит контур по предыдущей сцене того же витка
  и применяет контекстные маски (`--dry-run` показывает план).
- GitHub Actions запускает это **ежедневно в 09:00 по времени Бразилии**
  (`update-data.yml`) и публикует новый контур как artifact.
- Индекс риска использует **бо́льшее** из значений: осадки, наблюдённые за
  7 дней, и осадки, **спрогнозированные** на следующие 7 дней
  (Open-Meteo forecast) — компонент теперь смотрит в будущее.

## NISAR (диапазон валидации миссии)

`pipeline/scripts/validate_nisar.py` скачивает сцену NISAR GCOV через ASF
DAAC и конвертирует HDF5 -> COG. Требует
`EARTHDATA_USERNAME`/`EARTHDATA_PASSWORD`; без учётных данных скрипт
логирует `skipped: no Earthdata creds` и завершается успешно. NISAR
(L-диапазон) и Sentinel-1 (C-диапазон) хранятся в **отдельных слоях** —
они несравнимы через разность.

## Валидация

- SAR-контур валидируется против Sentinel-2 NDWI (с маской SCL) на
  **стратифицированных чипах** (половина с присутствующей водой наводнения,
  половина сухая): матрица ошибок, **F1, IoU и каппа Коэна по порогу σ0,
  с 95%-м доверительным интервалом по bootstrap** между чипами. Оптическая
  сцена ранжируется по временной близости к сцене SAR. Отчёт
  регенерируется: `uv run python scripts/validate_flood.py --chips 30`.
- Первоначальный пилот (4 чипа, 2024): среднее согласие 66,6% при −17 дБ,
  до 79% на чипах с реальным наводнением — числа пилота, без ДИ; новый
  отчёт заменяет их метриками по классам + ДИ.
- Задокументированные ложные срабатывания (городская застройка,
  постоянные водоёмы) **вырезаются из контура** с помощью ESA WorldCover
  10 м (классы built-up и permanent water).
- `cd pipeline && uv run pytest tests/` — 87 тестов; `api/tests/` — 9;
  `web/` — 20 (vitest). CI запускает все три в GitHub Actions.

## Сценарий демонстрации (3 мин)

1. Карта открывается в режиме свайпа: слева σ0 от 04.06.2024 (спад), справа
   11.05.2024 (пик). Потяните разделитель — Гуаиба «наполняется» на экране.
2. Включите «Water where it shouldn't be» — красный = новая обнаруженная
   вода (уже очищена от застройки и постоянных водоёмов).
3. Подвигайте ползунок σ0 (−25 → −10 дБ): маска воды меняется в реальном
   времени — порог является решением, а не магическим числом.
4. Кликните по Eldorado do Sul или Charqueadas: риск `critical`,
   экспонированное население, суммированное по сетке WorldPop на
   затопленных пикселях, план действий с основаниями, прослеживаемыми до
   данных.
5. Сравните с Canoas/POA (`high`) и муниципалитетом в горах (`low`) —
   индекс упорядочивает приоритеты управления.

## Честность / ограничения

См. `docs/methodology.md`, раздел 6: базовая линия — спад (не
до-событийная сцена), фиксированный глобальный порог, разрешение ~10 м,
WorldPop 2020 (не перепись 2022), HAND с триаж-порогом (не гидравлика),
индекс откалиброван качественно по одному событию.

## Лицензия

MIT — см. `LICENSE`.
