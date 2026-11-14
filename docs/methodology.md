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

## 4. Validação (Sentinel-2 NDWI, chips aleatórios no AOI)

Referências: `S2A_...20240518` (27,8% nuvem) e `S2A_...20240521` (4,1% nuvem),
tile 22JDM. NDWI > 0,15 com máscara de nuvem SCL. Relatório completo:
`data/reports/may2024_validation.md` (não versionado, gerado por
`pipeline/scripts/validate_flood.py`).

| Limiar σ0 | Concordância média |
|---|---|
| −13 dB | 52,6% |
| −15 dB | 57,4% |
| **−17 dB** | **66,6%** |
| −19 dB | 76,4% |

### Interpretação honesta dos números

- **Mismatch temporal**: o SAR é de 11/mai; as referências S2 são 18 e 21/mai,
  com a enchente já em recessão. O SAR *corretamente* mostra mais água.
- **SAR detecta 2,5–3,5× mais água que o NDWI**: parte é água real em recessão,
  parte são falsos positivos conhecidos do método — solo saturado, superfícies
  urbanas lisas e sombras de radar também têm backscatter baixo.
- **NDWI subdetecta água de inundação turva** (rico em sedimentos), então a
  referência óptica também tem viés.
- Em chips com água de inundação real presente, a concordância é **71–79%**.
- −19 dB tem concordância maior mas subdetecta área útil; −17 dB é o
  compromisso escolhido. O slider do app deixa o gestor explorar esse trade-off.

## 5. Índice de risco municipal

Score de triagem 0–1 por município, combinação linear ponderada de quatro
componentes normalizados (implementação: `pipeline/pipeline/risk.py`):

| Componente | Fonte | Normalização | Peso |
|---|---|---|---|
| Chuva máxima em 7 dias | Open-Meteo (precipitation_sum) | cap 300 mm | 0,30 |
| Umidade do solo | Open-Meteo (soil_moisture_0_to_7cm) | cap 0,5 m³/m³ | 0,20 |
| Terreno suscetível | Cop DEM GLO-30 (elev < 50 m E slope < 5°) | fração da área | 0,25 |
| Inundação observada | Extento SAR (seção 3) | cap 15% da área | 0,25 |

Categorias: `low` ≤ 0,25 · `moderate` ≤ 0,50 · `high` ≤ 0,75 · `critical` > 0,75.

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

(Recuperados via OpenAlex em 2026-11-14, consulta `search=Sentinel-1 flood
mapping SAR` — recuperação parcial, 8 de 13.715 registros.)

## 6. Limitações conhecidas

1. Limiar fixo global — não usa Otsu/método adaptativo por cena (roadmap).
2. Sem correção de ângulo de incidência — RTC já é gamma0, o que reduz o efeito.
3. Áreas urbanas densas podem gerar falsos positivos (double-bounce inverso).
4. Baseline é recessão, não pré-evento — ver ruling na seção 2.
5. Resolução efetiva ~10–20 m: ruas estreitas alagadas ficam abaixo do pixel.

## 7. Reprodutibilidade

```bash
cd pipeline
uv run python scripts/build_may2024.py            # baixa cenas, gera máscara + polígonos + preview
uv run python scripts/validate_flood.py           # validação vs Sentinel-2 NDWI
uv run python scripts/validate_nisar.py           # NISAR GCOV (requer Earthdata)
```

Artefatos: `data/sar/flood_extent_may2024.tif` (COG),
`data/vector/flood_polygons_may2024.geojson`,
`data/reports/may2024_preview.png`, `data/reports/may2024_validation.md`.
