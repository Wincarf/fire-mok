# Fire Mok

Plataforma de monitoramento de enchentes para o Rio Grande do Sul.
Caso âncora: enchente de maio/2024 na bacia do Guaíba, detectada em SAR
Sentinel-1, cruzada com território (IBGE), clima (Open-Meteo) e terreno
(Cop DEM) num índice de risco municipal com plano de ação por regras.

> Saídas do Fire Mok são um **score de triagem** para apoiar gestores,
> não um alerta oficial de defesa civil.

## Arquitetura

```
pipeline/   Python 3.13 (uv): STAC -> COG -> máscaras -> features -> risco
api/        FastAPI + rio-tiler: tiles de raster + endpoints JSON
web/        React + Vite + MapLibre: swipe antes/depois, camadas, slider σ0
data/       artefatos gerados (gitignored)
docs/       metodologia + specs + plano
.devin/skills/  subconjunto do k-dense-ai/scientific-agent-skills
```

## Como rodar

```bash
# 1) dados (uma vez; baixa ~500 MB de cenas do Planetary Computer)
cd pipeline && uv sync
uv run python scripts/build_may2024.py        # SAR -> extento de inundação
uv run python scripts/build_municipalities.py # IBGE + Censo 2022 + exposição
uv run python scripts/build_meteo.py --aoi-only
uv run python scripts/build_terrain.py        # Cop DEM -> suscetibilidade
uv run python scripts/build_risk.py           # índice de risco municipal
uv run python scripts/build_action_plans.py   # planos de ação

# 2) API
uv run uvicorn --app-dir ../api app:app --port 8000

# 3) app web
cd ../web && npm install && npm run dev       # http://localhost:5173
```

Sem Earthdata/credenciais todo o caminho acima funciona (só fontes públicas).

## NISAR (faixa de validação da missão)

`pipeline/scripts/validate_nisar.py` baixa uma cena NISAR GCOV via ASF DAAC e
converte HDF5 -> COG. Requer `EARTHDATA_USERNAME`/`EARTHDATA_PASSWORD`; sem
credenciais o script loga `skipped: no Earthdata creds` e sai com sucesso.
NISAR (L-band) e Sentinel-1 (C-band) ficam em **camadas separadas** — não são
comparáveis por diferença.

## Validação

- Extento SAR validado contra Sentinel-2 NDWI (SCL-masked) em chips
  aleatórios: concordância média 66,6% a −17 dB, até 79% em chips com
  inundação real. Detalhes e limitações: `docs/methodology.md` e
  `data/reports/may2024_validation.md` (regenerável).
- `cd pipeline && uv run pytest tests/` — 30+ testes; `api/tests/` separado.

## Roteiro de demo (3 min)

1. Mapa abre no swipe: esquerda σ0 de 04/jun/2024 (recessão), direita
   11/mai/2024 (pico). Arraste o divisor — o Guaíba "enche" na tela.
2. Ligue "Extensão da enchente" — vermelho = água nova detectada.
3. Mova o slider σ0 (−25 → −10 dB): a máscara de água muda ao vivo —
   mostra que limiar é decisão, não número mágico.
4. Clique em Eldorado do Sul ou Charqueadas: risco `critical`, população
   exposta estimada, plano de ação com razões rastreáveis aos dados.
5. Compare com Canoas/POA (`high`) e um município de serra (`low`) —
   o índice ordena prioridade de gestão.

## Honestidade / limitações

Ver `docs/methodology.md` seção 6: baseline é recessão (não pré-evento),
limiar global fixo, falso positivo em área urbana densa, resolução ~10 m,
população exposta assume densidade uniforme.
