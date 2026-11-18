# Fire Mok

[English](README.md) | **Português** | [Español](README.es.md) | [Français](README.fr.md) | [中文](README.zh-CN.md) | [Русский](README.ru.md) | [العربية](README.ar.md)

[![CI](https://github.com/Wincarf/fire-mok/actions/workflows/ci.yml/badge.svg)](https://github.com/Wincarf/fire-mok/actions/workflows/ci.yml)
[![monitoring](https://github.com/Wincarf/fire-mok/actions/workflows/update-data.yml/badge.svg)](https://github.com/Wincarf/fire-mok/actions/workflows/update-data.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Plataforma de monitoramento de enchentes para o Rio Grande do Sul.
Caso âncora: enchente de maio/2024 na bacia do Guaíba — detectada em SAR
Sentinel-1 (com NISAR GCOV integrado), cruzada com território (IBGE), clima
(Open-Meteo + NASA POWER), terreno (Copernicus DEM + HAND) e população
(WorldPop) num índice de risco municipal com plano de ação rastreável aos
dados.

> Saídas do Fire Mok são um **score de triagem** para apoiar gestores,
> não um alerta oficial de defesa civil.

## Ver online (demo estática)

App completo, sem backend — o branch [`gh-pages`](https://github.com/Wincarf/fire-mok/tree/gh-pages)
serve o choropleth de risco, o extento SAR real da enchente de
11/mai/2024, compare antes/depois, story guiado, painéis municipais e as três
camadas NISAR de banda L (backscatter, água aberta, dueto C×L). Os
endpoints da API são espelhados em arquivos (`/api/municipalities`,
`/api/layers`, `/api/plan/{code}`, tiles pré-renderizados z6–12).

- URL: **https://wincarf.github.io/fire-mok/** (ative Pages em
  *Settings → Pages → Deploy from a branch → gh-pages / root*)
- Regenerar: `cd web && npm run build -- --base=/fire-mok/` e depois
  `cd pipeline && uv run python ../scripts/build_pages.py --dist ../web/dist
  --out ../pages_site --data ../data` (dados em `data/` precisam existir).

## A Dança e o card de segunda-feira (novos)

- **A Dança** — três batidas reais do Sentinel-1 sobre a enchente de
  maio/2024, em um slider de tempo com play: **pico 11/mai (203,7 km²,
  ~70,8 mil pessoas expostas) → recessão 30/mai (47,6 km²) → calma 4/jun
  (0 km²)**. Gerada por `pipeline/scripts/build_choreo.py` (leituras RTC
  do Planetary Computer em grid comum, limpeza WorldCover, exposição areal
  por município).
- **Card de segunda-feira** — um clique transforma a batida escolhida em um
  alerta pt-BR pronto para WhatsApp (copiar e colar). Toda linha vem de
  dados reais; linha sem fonte (ex.: escolas/hospitais do OSM quando o
  Overpass está inacessível) simplesmente não aparece — nunca inventada.
- **Duet NISAR** — o modo dividido C×L e as três camadas de banda L
  (backscatter, água aberta, dueto) já estão **no ar**: o primeiro produto
  banda L (granule GCOV de 1/nov/2026) foi gerado pelo workflow diário e
  publicado no gh-pages. Para reproduzir: login Earthdata gratuito com os
  campos de perfil obrigatórios (Study Area) + autorização do app ASF →
  secrets do repositório → rodar *monitoring update*.
- Novos endpoints: `/api/choreo` e `/api/nisar_product`.

## Arquitetura

```
pipeline/   Python 3.13 (uv): STAC -> COG -> máscaras -> features -> risco
api/        FastAPI + rio-tiler: tiles de raster + endpoints JSON
web/        React + Vite + MapLibre: swipe antes/depois, camadas, slider σ0
data/       artefatos gerados (gitignored)
docs/       metodologia + specs + plano
.github/    CI (testes) + ingestão diária agendada do extento mais recente
```

## Como rodar

```bash
# 1) dados (uma vez; baixa ~500 MB de cenas do Planetary Computer)
cd pipeline && uv sync
uv run python scripts/build_may2024.py        # SAR -> extento de inundação (com máscaras de contexto)
uv run python scripts/build_municipalities.py # IBGE + Censo 2022 + exposição (WorldPop)
uv run python scripts/build_meteo.py --aoi-only
uv run python scripts/build_terrain.py        # Cop DEM -> HAND -> suscetibilidade
uv run python scripts/build_risk.py           # índice de risco municipal
uv run python scripts/build_action_plans.py   # planos de ação

# 2) API
uv run uvicorn --app-dir ../api app:app --port 8000   # /healthz checa camadas

# 3) app web
cd ../web && npm install && npm run dev       # http://localhost:5173

# ou tudo em container
docker build -t fire-mok . && docker run -p 8000:8000 -v "$PWD/data:/app/data" fire-mok
```

Só fontes públicas — sem credenciais Earthdata.

## Monitoramento contínuo

- `pipeline/scripts/update_latest.py` busca a cena Sentinel-1 RTC mais
  recente sobre o AOI, constrói o extento contra a cena anterior do mesmo
  passe e aplica as máscaras de contexto (`--dry-run` mostra o plano).
- Sem par de cobertura completa na janela de 14 dias e workspace vazio
  (CI novo)? Ele reconstrói o extento de referência com uma janela de 30
  dias, para que o dueto C×L sempre tenha uma contraparte banda C.
- GitHub Actions roda **diariamente às 09h (horário de Brasília)**
  (`update-data.yml`) e publica o extento novo como artifact.
- Chuva olhando pra frente: o índice usa o **maior** entre a chuva
  observada nos últimos 7 dias e a **previsão** Open-Meteo dos próximos 7
  dias.

## NISAR (NASA–ISRO, banda L) — no ar

O NISAR está plugado no pipeline de monitoramento (`pipeline/scripts/build_nisar.py`):

- **Sempre**: busca ASF anônima sobre o AOI → inventário público de cenas em
  `/api/nisar` (60 cenas GCOV sobre o AOI Guaíba no último ano; roda
  diariamente no CI).
- **Com login Earthdata gratuito** (`EARTHDATA_USER`/`EARTHDATA_PASS` ou
  netrc): baixa o granule GCOV mais recente, converte HDF5 → COG (dB) e
  gera o dB da janela do AOI, o proxy de água aberta e o **diff do dueto
  C×L** contra o extento Sentinel-1 mais recente — tudo publicado em
  `/api/nisar_product` e nos planos de ação (bloco `nisar` em
  `/api/plan/{code}`). Credenciais ausentes **ou recusadas** (ex.: perfil
  EDL incompleto) caem para `inventory-only`: o run fica verde e o
  monitoramento diário nunca bloqueia.

Banda L e banda C ficam em **camadas separadas**; o **dueto C×L** compara
as máscaras de água (3 classes: só C / só L) em datas rotuladas — nunca
uma diferença bruta de dB.

## Validação

- Extento SAR validado contra Sentinel-2 NDWI (máscara SCL) em **chips
  estratificados** (metade com água de enchente, metade seca): matriz de
  confusão, **F1, IoU e kappa de Cohen por limiar σ0, com IC de 95% por
  bootstrap**. A cena óptica é ranqueada por proximidade temporal à cena
  SAR. Regenerar: `uv run python scripts/validate_flood.py --chips 30`.
- Piloto original (4 chips, 2024): 66,6% de concordância média a −17 dB,
  até 79% em chips com inundação real — substituído pelo relatório com
  métricas por classe + IC.
- Falsos positivos documentados (urbano, água permanente) são **cortados
  do extento** com ESA WorldCover 10 m (classes built-up e permanent
  water).
- `cd pipeline && uv run pytest tests/` — 95 testes; `api/tests/` 12;
  `web/` 20 (vitest). CI roda os três no GitHub Actions.

## Licença

MIT — ver `LICENSE`.
