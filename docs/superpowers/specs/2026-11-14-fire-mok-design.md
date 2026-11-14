# Fire Mok — Design

## Intenção e porquê

Construir o **Fire Mok**: plataforma inteligente de monitoramento de enchentes com
foco no Rio Grande do Sul.

O objetivo é um app interativo que use dados de radar (NISAR) para rastrear e
visualizar mudança de superfície. Nossa mudança de superfície é **água onde não
deveria ter água**: enchentes. SAR é o sensor certo — opera à noite e através de
nuvem, exatamente quando enchentes acontecem e sensores ópticos falham.

Pilares do produto:

1. **Monitoramento de enchentes** — extensão de água detectada por SAR
   (NISAR GCOV; Sentinel-1 RTC como fallback/baseline histórico).
2. **Análise de vulnerabilidade** — precipitação, umidade do solo e terreno
   combinados em score de risco de alagamento por região/município.
3. **Painel da comunidade** — dados IBGE por município + plano de ação
   gerado por regras de risco.

Impacto: gestor público vê áreas alagadas e áreas em risco antes/durante o
evento, com plano de ação por município.

## Goals

- Pipeline que baixa cenas SAR de um AOI no RS e produz máscara de água +
  camadas de mudança em COG.
- Âncora do demo: **enchente de maio/2024** (Sentinel-1 RTC, arquivo aberto,
  sem login) + dados NISAR recentes (VALIDATED desde 6-nov-2026) quando o
  login Earthdata estiver pronto.
- Camada de risco: precipitação (CHIRPS/Open-Meteo) + umidade do solo +
  susceptibilidade de terreno (SRTM/HAND) → score por município.
- Painel IBGE: município clicável → população exposta + plano de ação.
- App React + MapLibre com swipe antes/depois, time slider, toggles de camada.
- API FastAPI servindo tiles dos COGs + endpoints de risco/plano.
- Vídeo demo.

## Non-goals

- Datasets fora do escopo de enchente (descoped pelo usuário).
- Deploy em nuvem / usuários / autenticação — demo local + vídeo.
- Modelo hidrológico operacional (HEC-RAS etc.).

## Anti-goals

- Não apresentar previsão como oficial/certificada — é triagem de risco
  ("screening"), não aviso de defesa civil.
- Não misturar backscatter L-band (NISAR) e C-band (Sentinel-1) num mesmo
  diff como se fossem comparáveis — sensores diferentes ficam em camadas
  separadas no app.
- Não baixar arquivo inteiro/TB — AOI limitado, poucas cenas (~centenas de MB).
- Não depender de LLM ou serviço pago no caminho crítico do demo.

## Constraints

- ~1,5 dia de sprint; a máquina é Windows (Python 3.14/3.13/3.11, Node 24, uv).
- Python **3.13** via `uv` para o pipeline (rasterio/GDAL têm wheels; 3.14 é
  novo demais).
- Earthdata Login: usuário vai criar; até lá, tudo funciona com fontes sem auth.
- NISAR VALIDATED cobre aquisições desde 21-out-2026 (~3 semanas de dados);
  pares temporais em RS podem ser finos → Sentinel-1 cobre a enchente de 2024
  e serve de baseline histórico.
- NISAR GCOV é HDF5 → converter para COG na pipeline.

## Abordagens consideradas

### Dados SAR

- **A — NISAR only (asf_search + Earthdata):** mais alinhado à missão NISAR, mas
  cobertura temporal curta (VALIDATED ~3 semanas) e trava sem login.
- **B — Sentinel-1 RTC via MS Planetary Computer (STAC, sem auth):** arquivo
  desde 2014, captura a enchente de mai/2024 inteira; funciona hoje. Mas é
  C-band, não é NISAR — sozinho, cobertura temporal curta demais.
- **C — Híbrido (escolhida):** Sentinel-1 RTC como baseline histórico e
  narrativa (mai/2024), NISAR GCOV como "o presente" da plataforma.
  Se o login atrasar, o demo não trava; quando entrar, ganhamos o diferencial
  L-band (penetra vegetação melhor, detecta água sob dossel).

### Tiles no frontend

- **Pré-render PNG/XYZ:** simples, mas sem interatividade de valores.
- **TiTiler/rio-tiler dinâmico (escolhido):** FastAPI + rio-tiler serve tiles
  dos COGs locais com colormap dB — slider de threshold funciona de verdade
  (usuário ajusta o corte de σ0 e vê a máscara de água mudar). Esse gesto é o
  "uau" do demo: raw data → decisão.

### Plano de ação

- **LLM-gerado:** risco de latência/falha no demo.
- **Regras determinísticas (escolhido):** score de risco por município
  (água∩população + precip 7d + umidade solo + susceptibilidade) → checklist
  de ações por faixa de risco. Previsível, auditável, funciona offline.

## Como (decidido)

- Stack: React (Vite) + MapLibre GL + FastAPI + rio-tiler. Usuário escolheu.
- Escopo de dados: só Dancing with the SARs. Usuário escolheu.
- Earthdata: usuário cria; fallback sem auth cobre tudo até lá.
- Fontes (minhas escolhas):
  - SAR: `asf_search` (NISAR GCOV/RUNW) + `pystac-client` (S1 RTC no PC).
  - Precipitação: CHIRPS daily (aberto) + Open-Meteo forecast (sem key).
  - Umidade do solo: Open-Meteo (sem key); NISAR SME2/SMAP se Earthdata cair cedo.
  - Terreno/susceptibilidade: SRTM via AWS Terrain Tiles/Terrarium + distância
    a drenagem (HAND simplificado).
  - Território/população: APIs IBGE (localidades, malhas GeoJSON, pop. Censo 2022).

## Estrutura

```
Fire Mok/
  .devin/skills/          # subset do scientific-agent-skills (geo stack)
  docs/superpowers/specs/ # este doc
  pipeline/               # python 3.13: download, process, layers, ibge
  api/                    # FastAPI: /tiles, /api/municipalities, /api/risk, /api/plan
  web/                    # Vite + React + MapLibre
  data/                   # COGs, GeoJSON, cache (gitignored)
```

## Deixado para o builder

- AOIs exatos (default: região metropolitana de Porto Alegre + Guaíba/Jacuí;
  Eldorado do Sul; Vale do Taquari).
- Limiares de σ0 para água (calibrar por cena; ~-15 a -17 dB VH é ponto de partida).
- Se RUNW (interferograma) entra como camada extra — stretch goal, não core.
- Detalhes de UI/polish do painel.
