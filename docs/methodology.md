# Fire Mok — Metodologia de detecção de inundação (SAR)

Documento técnico do pipeline de detecção de água e extento de inundação.
Público: gestores técnicos, revisores científicos, jurados.

> **Aviso**: saídas do Fire Mok são um *score de triagem* para apoiar decisão,
> não um alerta oficial de defesa civil.

## 1. Dados

| Camada | Fonte | Produto | Acesso |
|---|---|---|---|
| Backscatter SAR (histórico) | Sentinel-1 | RTC gamma0, banda VV, coleção `sentinel-1-rtc` | Microsoft Planetary Computer STAC, sem autenticação |
| Backscatter SAR (presente) | NISAR | GCOV (HDF5, L-band) | ASF DAAC, requer Earthdata |
| Validação óptica | Sentinel-2 | L2A (B03, B08, SCL) | Planetary Computer STAC |
| Contexto (falsos positivos) | ESA WorldCover | 10 m, classes 50 (built-up) e 80 (água permanente), época 2021 | Planetary Computer STAC (`esa-worldcover`) |
| Terreno | Copernicus DEM | GLO-30 -> HAND (Height Above Nearest Drainage) | Planetary Computer STAC |
| População | WorldPop | 100 m, 2020, CC-BY 4.0 (alternativa documentada: NASA SEDAC GPW v4) | data.worldpop.org (leitura por janela HTTP) |
| Clima observado | Open-Meteo + NASA POWER | precipitação diária + umidade do solo; POWER (MERRA-2) como estimativa independente | APIs públicas |

Os dois sensores SAR ficam em **camadas separadas**: NISAR é L-band,
Sentinel-1 é C-band. Não fazemos diferença cruzada entre eles — frequências
diferentes respondem diferente à mesma superfície.

## 2. Caso âncora: enchente de maio/2024 no Guaíba

- **Cena "molhada"**: `S1A_...20240511T084943_rtc` — 11/mai/2024, pico da
  inundação, track descendente 08:49, cobertura de 100% do AOI.
- **Cena "seca" (baseline)**: `S1A_...20240604T084924_rtc` — 04/jun/2024,
  recessão, mesma track 08:49, cobertura de 100%.

**Ruling documentado**: a coleção RTC do Planetary Computer não possui cena
pré-maio/2024 para este AOI (arquivo parcial, não completo). Usamos a imagem
de recessão como baseline seca — metodologia padrão quando não há pré-evento:
`flood = água(depois) AND NOT água(antes)`, com `antes` = cena pós-recessão.
Isso pode **superestimar** o extento em áreas que ainda estavam alagadas em
04/jun, e é mitigado exigindo pixel válido (não-nodata) no baseline.

## 3. Detecção de água

- Conversão linear → dB: `σ0_dB = 10·log10(σ0)` (nodata preservado).
- Máscara de água: `σ0 < threshold`. Limiar padrão **−17 dB** (VV),
  calibrado pela validação abaixo e ajustável interativamente no app.
- Extento de inundação: `água(depois) AND NOT água(antes) AND válido(antes)`.
- Limpeza de speckle: remoção de blobs conectados < 25 px (≈ 2.500 m² a 10 m).
- **Limpeza de contexto (WorldCover 10 m)**: o extento final exclui pixels de
  área urbana (classe 50) e água permanente (classe 80). Superfícies urbanas
  viram de bright para dark entre cenas e enganam o change detection — eram
  os falsos positivos documentados na seção 6; água permanente escapa da
  regra de baseline válido nas bordas de cobertura. As duas máscaras ficam
  disponíveis como camadas no app (`permanent_water`, `urban`).
  Falha ao baixar o WorldCover nunca bloqueia o build (máscara é contexto).

## 4. Validação (Sentinel-2 NDWI, chips estratificados no AOI)

Referências: cenas S2 L2A do maio/2024 com nuvem < 40%, **ranqueadas por
proximidade temporal à cena SAR** (era por overlap de footprint). NDWI > 0,15
com máscara de nuvem SCL. Relatório completo:
`data/reports/may2024_validation.md` (não versionado, gerado por
`pipeline/scripts/validate_flood.py --chips 30`).

**Design estatístico (upgrade sobre o piloto de 4 chips):**

- **Amostragem estratificada**: 30 chips de ~5,5 km, metade do estrato
  `flood` (≥ 5% de pixels de água no NDWI) e metade do estrato `dry` —
  métricas agregadas seriam dominadas por chips sem água.
- **Métricas por classe**, não só concordância bruta: matriz de confusão
  (TP/FP/FN/TN), **F1, IoU e kappa de Cohen** por limiar σ0, com
  **intervalo de confiança 95% por bootstrap** (reamostragem de chips,
  1000 iterações, semente fixa). Concordância bruta infla com
  desbalanceamento de classe; F1/IoU medem a água que importa.
- **Nodata excluído de ambos os lados**: pixels sem dado SAR ou óptico não
  votam (antes, NaN do SAR contava como "não-água" e inflava agreement).
- Sub-tabelas por estrato no relatório, com IC por estrato.

**Piloto original (4 chips, 2024 — números sem IC, mantidos como referência
histórica):**

| Limiar σ0 | Concordância média |
|---|---|
| −13 dB | 52,6% |
| −15 dB | 57,4% |
| **−17 dB** | **66,6%** |
| −19 dB | 76,4% |

### Interpretação honesta dos números

- **Mismatch temporal**: o SAR é de 11/mai; as referências S2 são 1–10 dias
  depois, com a enchente já em recessão. O SAR *corretamente* mostra mais água.
- **SAR detecta mais água que o NDWI**: parte é água real em recessão,
  parte são falsos positivos conhecidos do método — solo saturado,
  superfícies urbanas lisas e sombras de radar também têm backscatter baixo.
  Os dois últimos são agora **cortados na seção 3**; solo saturado continua.
- **NDWI subdetecta água de inundação turva** (rico em sedimentos), então a
  referência óptica também tem viés.
- −19 dB tem concordância maior mas subdetecta área útil; −17 dB é o
  compromisso escolhido. O slider do app deixa o gestor explorar esse trade-off.

## 5. Índice de risco municipal

Score de triagem 0–1 por município, combinação linear ponderada de quatro
componentes normalizados (implementação: `pipeline/pipeline/risk.py`):

| Componente | Fonte | Normalização | Peso |
|---|---|---|---|
| Chuva máxima em 7 dias (maior entre observado e previsto) | Open-Meteo archive + forecast; NASA POWER como verificação cruzada | cap 300 mm | 0,30 |
| Umidade do solo | Open-Meteo (soil_moisture_0_to_7cm) | cap 0,5 m³/m³ | 0,20 |
| Terreno suscetível | Cop DEM GLO-30 -> **HAND < 15 m** AND slope < 5° | fração da área | 0,25 |
| Inundação observada | Extento SAR (seção 3) | cap 15% da área | 0,25 |

Categorias: `low` ≤ 0,25 · `moderate` ≤ 0,50 · `high` ≤ 0,75 · `critical` > 0,75.

**Componente de chuva olha para frente**: usa o maior entre o observado em
7 dias (archive) e o previsto para os próximos 7 dias (Open-Meteo forecast).
Chuva prevista acima do que já caiu é o driver futuro de enchente; forecast
ausente contribui 0. O POWER (MERRA-2, NASA) serve de **verificação
independente** da mesma chuva: viés médio e divergência máxima entre as duas
fontes entram nos features (`power_vs_openmeteo_bias_mm`) e divergência
grande sinaliza problema de dados.

**Terreno por HAND**: a regra anterior (`elev < 50 m`) confunde várzea com
qualquer região baixa. HAND (Height Above Nearest Drainage, Rennó et al. 2008)
é a diferença de elevação entre a célula e a drenagem mais próxima a jusante —
a mesma altitude é alagável no vale do Guaíba e irrelevante em platô.
Implementação sem dependências externas (priority-flood ε, D8, acumulação,
pointer-doubling); limiar 15 m é triagem, não hidráulica.

**Exposição populacional real**: população exposta soma a grade WorldPop 2020
(100 m) sobre os pixels alagados de cada município (conversão
count-preservante por densidade), substituindo a suposição de densidade
uniforme. Sem a grade (rede sem Range HTTP), o cálculo volta para a estimativa
uniforme e marca o método (`pop_method`) no GeoJSON de saída.

Calibração qualitativa contra mai/2024: Charqueadas (0,81) e Eldorado do Sul
(0,75) saem `critical`; Triunfo, Nova Santa Rita, Porto Alegre e Canoas saem
`high` — consistente com a geografia real do desastre. O índice é triagem,
não previsão: pesos e caps estão fixos e documentados aqui, sem ajuste
automático por evento.

### Referências do método

- Twele, A. et al. (2016/2018). *Unsupervised Rapid Flood Mapping Using
  Sentinel-1 GRD SAR Images.* IEEE TGRS. doi:10.1109/tgrs.2018.2797536 —
  detecção de água por limiar em σ0.
- Clement, M. et al. (2018). *An automatic change detection approach for
  rapid flood mapping in Sentinel-1 SAR data.* Int. J. Appl. Earth Obs.
  doi:10.1016/j.jag.2018.05.023 — diferença antes/depois (nossa seção 3).
- DeVries, B. et al. (2020). *Rapid Flood Mapping and Evaluation with a
  Supervised Classifier and Change Detection.* Remote Sensing.
  doi:10.3390/rs12132073 — validação contra referência óptica.
- Rennó, C. D. et al. (2008). *HAND, a new terrain descriptor using SRTM-DEM:
  mapping terra-firme rainforest environments in Amazonia.* Remote Sensing of
  Environment. doi:10.1016/j.rse.2008.03.018 — base do índice HAND (seção 5).

(Referências SAR recuperadas via OpenAlex em 2026-11-14; Rennó 2008 é a
referência canônica do descritor HAND.)

## 6. Limitações conhecidas

1. Limiar fixo global — não usa Otsu/método adaptativo por cena (roadmap).
2. Sem correção de ângulo de incidência — RTC já é gamma0, o que reduz o efeito.
3. Falsos positivos urbanos e de água permanente são **cortados pelo
   WorldCover** (seção 3), mas o WorldCover é da época 2021: áreas urbanizadas
   depois disso podem voltar a gerar FP; solo saturado continua como FP
   potencial (é água real em transição, não um bug).
4. Baseline é recessão, não pré-evento — ver ruling na seção 2.
5. Resolução efetiva ~10–20 m: ruas estreitas alagadas ficam abaixo do pixel.
6. WorldPop é 2020 e é uma *estimativa* de grade, não o Censo 2022; a soma
   sobre pixels alagados é aproximada e conserva a distribuição espacial, não
   um número de desabrigados.
7. HAND com limiar fixo de 15 m é triagem de planície, não modelagem
   hidráulica — profundidade e proteção por diques não entram.
8. O índice segue calibrado qualitativamente contra um único evento
   (mai/2024); o backtest multi-evento (ex.: enchente de set/2023 no Taquari)
   é o próximo passo para testar generalização dos pesos.

## 7. Operação

- Ingestão automática: `pipeline/scripts/update_latest.py` (cron/Actions
  diário) constrói o extento da cena mais recente contra o baseline do
  mesmo passe orbital — o índice e o app acompanham o presente, não só
  o caso âncora.
- CI: `.github/workflows/ci.yml` roda os 96 testes Python + 22 vitest a cada
  push/PR; `.github/workflows/update-data.yml` roda a ingestão diária.
- API em container: `docker build -t fire-mok . && docker run -p 8000:8000
  -v "$PWD/data:/app/data" fire-mok`; `/healthz` reporta camadas disponíveis.

## 8. Reprodutibilidade

```bash
cd pipeline
uv run python scripts/build_may2024.py            # baixa cenas, gera máscara + polígonos + preview (com contexto WorldCover)
uv run python scripts/validate_flood.py --chips 30 # validação estratificada vs Sentinel-2 NDWI (F1/IoU/kappa + IC)
uv run python scripts/update_latest.py --dry-run   # plano de ingestão da cena mais recente
uv run python scripts/validate_nisar.py           # NISAR GCOV (requer Earthdata)
```

Artefatos: `data/sar/flood_extent_may2024.tif` (COG),
`data/vector/flood_polygons_may2024.geojson`,
`data/context/permanent_water_guaiba.tif`, `data/context/urban_guaiba.tif`,
`data/terrain/hand_guaiba.tif`,
`data/population/worldpop_bra_aoi.tif` (cache),
`data/reports/may2024_preview.png`, `data/reports/may2024_validation.md`.
