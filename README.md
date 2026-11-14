# Fire Mok

[![CI](https://github.com/Wincarf/fire-mok/actions/workflows/ci.yml/badge.svg)](https://github.com/Wincarf/fire-mok/actions/workflows/ci.yml)
[![monitoring](https://github.com/Wincarf/fire-mok/actions/workflows/update-data.yml/badge.svg)](https://github.com/Wincarf/fire-mok/actions/workflows/update-data.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Plataforma de monitoramento de enchentes para o Rio Grande do Sul.
Caso âncora: enchente de maio/2024 na bacia do Guaíba, detectada em SAR
Sentinel-1 (e pronto para NISAR), cruzada com território (IBGE), clima
(Open-Meteo + NASA POWER), terreno (Cop DEM + HAND) e população (WorldPop)
num índice de risco municipal com plano de ação por regras rastreáveis.

> Saídas do Fire Mok são um **score de triagem** para apoiar gestores,
> não um alerta oficial de defesa civil.

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

Sem Earthdata/credenciais todo o caminho acima funciona (só fontes públicas).

## Monitoramento contínuo

- `pipeline/scripts/update_latest.py` busca a cena Sentinel-1 RTC mais
  recente sobre o AOI, constrói o extento contra a cena anterior do mesmo
  passe e aplica as máscaras de contexto (`--dry-run` mostra o plano).
- GitHub Actions roda isso **diariamente às 09h (Brasília)**
  (`update-data.yml`) e publica o extento novo como artifact.
- O índice de risco usa o **maior** entre a chuva observada em 7 dias e a
  chuva **prevista** para os próximos 7 dias (Open-Meteo forecast) — o
  componente passa a olhar para frente.

## NISAR (faixa de validação da missão)

`pipeline/scripts/validate_nisar.py` baixa uma cena NISAR GCOV via ASF DAAC e
converte HDF5 -> COG. Requer `EARTHDATA_USERNAME`/`EARTHDATA_PASSWORD`; sem
credenciais o script loga `skipped: no Earthdata creds` e sai com sucesso.
NISAR (L-band) e Sentinel-1 (C-band) ficam em **camadas separadas** — não são
comparáveis por diferença.

## Validação

- Extento SAR validado contra Sentinel-2 NDWI (SCL-masked) em **chips
  estratificados** (metade com água de enchente presente, metade seca):
  matriz de confusão, **F1, IoU e kappa de Cohen por limiar σ0, com
  intervalo de confiança 95% por bootstrap** entre chips. Cenário óptico
  ranqueado por proximidade temporal à cena SAR. Relatório regenerável:
  `uv run python scripts/validate_flood.py --chips 30`.
- Piloto original (4 chips, 2024): concordância média 66,6% a −17 dB, até
  79% em chips com inundação real — números do piloto, sem IC; o relatório
  novo substitui por métricas de classe + IC.
- Falsos positivos documentados (urbano, água permanente) são **cortados do
  extento** com ESA WorldCover 10 m (classes built-up e permanent water).
- `cd pipeline && uv run pytest tests/` — 87 testes; `api/tests/` com 9;
  `web/` com 22 (vitest). CI roda os três no GitHub Actions.

## Roteiro de demo (3 min)

1. Mapa abre no swipe: esquerda σ0 de 04/jun/2024 (recessão), direita
   11/mai/2024 (pico). Arraste o divisor — o Guaíba "enche" na tela.
2. Ligue "Extensão da enchente" — vermelho = água nova detectada (já limpa
   de urbano e água permanente).
3. Mova o slider σ0 (−25 → −10 dB): a máscara de água muda ao vivo —
   mostra que limiar é decisão, não número mágico.
4. Clique em Eldorado do Sul ou Charqueadas: risco `critical`, população
   exposta somada da grade WorldPop sobre os pixels alagados, plano de ação
   com razões rastreáveis aos dados.
5. Compare com Canoas/POA (`high`) e um município de serra (`low`) —
   o índice ordena prioridade de gestão.

## Honestidade / limitações

Ver `docs/methodology.md` seção 6: baseline é recessão (não pré-evento),
limiar global fixo, resolução ~10 m, WorldPop 2020 (não é Censo 2022),
HAND com limiar de triagem (não hidráulica), índice calibrado qualitativamente
contra um evento.

## Licença

MIT — ver `LICENSE`.
