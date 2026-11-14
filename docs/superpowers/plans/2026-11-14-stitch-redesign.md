# Stitch Design-System Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reescrever o frontend `web/` no design system "Hydrologic Risk & Geospatial Command" (export Stitch) sobre Tailwind v4, mantendo 100% da funcionalidade real (mapas MapLibre sync + swipe, camadas, limiar σ0, municípios, story).

**Architecture:** Tailwind v4 CSS-first (`@theme` em `styles.css` com os tokens do DESIGN.md — mesmos nomes do mockup, classes portam verbatim). Componentes novos finos em `src/components/`; estado e efeitos MapLibre permanecem em `App.tsx`.

**Tech Stack:** React 19 + TS + Vite 6 + MapLibre GL 5 + Tailwind CSS 4 + Vitest.

**Spec:** `docs/superpowers/specs/2026-11-14-stitch-redesign-design.md`

## Global Constraints

- Somente dados reais da API existente: `/api/layers`, `/api/municipalities`, `/api/plan/{code}`, `/api/flood_polygons`, `/tiles/{layer}/...`. Nenhuma métrica inventada (sem cota Guaíba, sem lâmina d'água, sem passes SAR extras — só 11/mai e 04/jun reais).
- UI em pt-BR; labels técnicos uppercase com tracking (JetBrains Mono).
- Sem `cdn.tailwindcss.com`; build via `@tailwindcss/vite` plugin.
- Não quebrar: sync dos 2 mapas, swipe clip-path, story de 6 passos, testes existentes (11 verdes).
- Paleta/valores exatos do DESIGN.md (copiados verbatim, não aproximados).
- Commits pequenos ao fim de cada task; estilo `type: resumo` (ex.: `feat:`, `refactor:`).

## Review Focus

1. `/api/layers` falha ou API offline → header deve mostrar `OFFLINE`, nunca quebrar render (Task 3, step de teste manual + guarda no fetch).
2. `sel.risk` não-finito/ausente → score mostra `—` (Task 2 cobre via teste unitário).
3. Clique em capítulo da timeline fora da story → entra na story naquele capítulo (Task 7, comportamento pinado).
4. `/api/flood_polygons` 404 → botão desabilitado com tooltip, sem erro não tratado (Task 6).
5. Utilidades Tailwind referenciadas devem existir nos tokens — typo de classe gera estilo ausente silencioso (Task 8 visual check + build não-validador: revisar diff de classes contra `@theme`).

---

### Task 1: Toolchain — Tailwind v4, tokens, fontes

**Files:**
- Modify: `web/package.json` (via npm install)
- Modify: `web/vite.config.ts`
- Rewrite: `web/src/styles.css`
- Modify: `web/index.html`

**Interfaces:**
- Produces: utilities Tailwind com nomes do mockup — `bg-surface-container-low{,est}`, `text-on-surface{,-variant}`, `text-primary`, `bg-primary`, `font-label-mono-{xs,sm,md}`, `font-metric-{lg,xl}`, `font-headline-*`, `font-body-*`, `p|px|py|m|gap-space-{xs,sm,md,lg,xl}`, `*-gutter{,-desktop}`, `rounded-{lg,xl}`.
- CSS custom residuais: `.map-canvas` (fill absoluto p/ MapLibre), `.divider-anim` (transition 0.8s), `.no-scrollbar`.

- [ ] **Step 1: Instalar devDeps**

```bash
cd web && npm i -D tailwindcss@4 @tailwindcss/vite@4
```

- [ ] **Step 2: Plugin no `vite.config.ts`** — `import tailwindcss from "@tailwindcss/vite"` + `tailwindcss()` em `plugins`.

- [ ] **Step 3: `styles.css`** — `@import "tailwindcss";` + `@theme {…}` com todas as cores do `tailwind.config` do `code.html` (verbatim), `--text-*` por token tipográfico do DESIGN.md (fontSize+lineHeight+letterSpacing), `--spacing-*` (space-xs .25rem, space-sm .5rem, space-md .75rem, space-lg 1rem, space-xl 1.5rem, gutter .75rem, gutter-desktop 1rem, margin-desktop 1.25rem), `--font-display:"Geist"`, `--font-mono:"JetBrains Mono"`. CSS custom final ≤40 linhas (mapa, divider, scrollbar, tabular-nums).

- [ ] **Step 4: `index.html`** — `<link>` Google Fonts: Geist 300–700, JetBrains Mono 400–600, Material Symbols Outlined; `<html class="dark">` desnecessário (dark-only), remover se houver.

- [ ] **Step 5: Verificar build**

Run: `npm run build && npm test`
Expected: build ok, 11 testes verdes (JSX antigo continua compilando; classes antigas viram no-op).

- [ ] **Step 6: Commit** `chore: tailwind v4 + design tokens do Stitch`

### Task 2: `src/format.ts` — helpers de exibição (TDD)

**Files:**
- Create: `web/src/format.ts`
- Test: `web/src/format.test.ts`

**Interfaces:**
- Produces:
  - `riskScore10(risk: number): string` — `0.984→"9.8"`; clamp 0–10; `NaN/Infinity→"—"`.
  - `sarSceneDate(file: string): string` — acha `(\d{8})T\d{6}` no nome → `"04/jun/2024"` (meses pt-BR minúsculos); sem match → `"—"`.
  - `SAR_PLATFORM: string` — constante `"Sentinel-1A · IW GRD"`.

- [ ] **Step 1: Escrever teste falhando** em `format.test.ts` cobrindo: `riskScore10(0.984)==="9.8"`, `(1.2)==="10.0"` clamp, `(NaN)==="—"`; `sarSceneDate("S1A_IW_GRDH_1SDV_20240604T084924_20240604T084953_054171_069681_rtc_vv_db.tif")==="04/jun/2024"`, `sarSceneDate("foo")==="—"`.

- [ ] **Step 2:** `npx vitest run format` → FAIL (módulo inexistente).

- [ ] **Step 3: Implementar `format.ts`** — parse regex; meses `["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"]`.

- [ ] **Step 4:** `npx vitest run` → todos verdes.

- [ ] **Step 5: Commit** `feat: format helpers para score SAR e datas de cena`

### Task 3: App shell + `Header.tsx`

**Files:**
- Create: `web/src/components/Header.tsx`
- Modify: `web/src/App.tsx` (return JSX + novos states/effects; lógica de mapa intocada)

**Interfaces:**
- Consumes: `riskScore10` etc. (Task 2 não requerido aqui).
- Produces:
  - `Header({ tiler, tilerMs, coords, onExport, onStory })` onde `tiler:"loading"|"online"|"offline"`, `tilerMs:number|null`, `coords:{lng:number;lat:number}|null`.
  - `downloadJson(url: string, filename: string): Promise<void>` — helper em `App.tsx` (fetch→blob→`<a download>`), reusado na Task 6.

- [ ] **Step 1: `Header.tsx`** — port do `<header>` do `code.html`: wordmark "Fire Mok" (texto, não img), chip `v1.2 — Sentinel-1`, pill status `rio-tiler: ONLINE (Xms)`/`OFFLINE` (dot pulsante), pill coords `Lat/Lon` mono, botões `Exportar` (primário, `download` icon) e `▶ História` (secundário outline).

- [ ] **Step 2: `App.tsx` shell** — substituir `<header>`+`.toolbar` por `<Header/>` + grid shell `header fixed h-16 / pl-64 main`; novos states `tiler`, `tilerMs`, `coords`; effect: `fetch("/api/layers")` com `performance.now()` → setTiler/tilerMs (catch → `"offline"`); `mousemove` nos 2 mapas → `setCoords(e.lngLat)`; `onExport = () => downloadJson("/api/municipalities","municipios_risco_may2024.geojson")`; `onStory = () => setStep(0)`; remover `<span>` subtitle e toolbar JSX.

- [ ] **Step 3:** `npm run build && npm test` → verde.

- [ ] **Step 4: Commit** `feat: header fixo + shell HUD`

### Task 4: `LayersDrawer.tsx`

**Files:**
- Create: `web/src/components/LayersDrawer.tsx`
- Modify: `web/src/App.tsx`

**Interfaces:**
- Produces: `LayersDrawer({ layers, onToggle, thresh, onThresh, summary, lastPass })` — `onToggle:(k:keyof Vis,v:boolean)=>void`; `summary:{exposed:number;critical:number}`; `lastPass:string`.
- Consumes: `Vis` (`src/vis.ts`), `sarSceneDate` (Task 2).

- [ ] **Step 1: Componente** — port do `<aside>` esquerdo do `code.html`: seção "CAMADAS & SENSORES" com 4 toggles reais — `flood` "Água onde não devia estar" (chip `SAR`), `mask` "Simulador de detecção" (`σ0`), `sus` "Áreas naturalmente inundáveis" (`DEM`), `muni` "Municípios por risco" (`IBGE`); slider `Limiar σ0` -25..-10 step .5 (valor mono + dB); legenda de risco 4 cores; card "RESUMO DA AOI" (`exposed`/`critical` formatados pt-BR); rodapé `ÚLTIMO PASSE SAR` + `sarSceneDate` + `SAR_PLATFORM`.

- [ ] **Step 2: Wire no App** — `<aside>` fixed left-0 top-16 bottom-0 w-64; `lastPass = sarSceneDate("S1A_IW_GRDH_1SDV_20240604T084924_20240604T084953_054171_069681_rtc_vv_db.tif")` via constante compartilhada `SAR_SCENE_BEFORE` em `App.tsx` (a mesma string do `LAYERS` da API — declarar const no topo).

- [ ] **Step 3:** build+test verde. **Step 4: Commit** `feat: drawer de camadas com tokens Stitch`

### Task 5: `MapHud.tsx` + swipe restilizado

**Files:**
- Create: `web/src/components/MapHud.tsx`
- Modify: `web/src/App.tsx` (bloco `.compare`)

**Interfaces:**
- Produces: `MapHud({ zoom, onZoom, split, onDividerDown, topAnim, afterRef, beforeRef, children })` — onde `onZoom:(d:1|-1)=>void`, `onDividerDown:(e:React.PointerEvent)=>void`, `topAnim:boolean`. `children` = slot p/ banner/overlays futuros.
- Consumes: refs de mapa existentes (`beforeRef`, `afterRef`).

- [ ] **Step 1: `MapHud.tsx`** — viewport `relative overflow-hidden`; 2 slots de mapa (`beforeRef`/`afterRef` com `map-canvas` + `clipPath` no after); pills flutuantes `RECESSÃO · 04/JUN/24` (dot primary) / `PICO SAR · 11/MAI/24` (dot error, pulse); HUD top-right mono `RES 10m · POL VV/VH · Z {zoom.toFixed(1)}`; quickbar direita `add`/`remove` (36px, surface-low, hover primary); divider `absolute` com linha `bg-primary` glow + knob `drag_indicator` + handler `onPointerDown` repassado.

- [ ] **Step 2: Wire no App** — substituir JSX `.compare` por `<MapHud>`; mover lógica de drag existente para `onDividerDown` (mesmo código); `zoom` state via `move`/`zoom` listener no afterMap (`setZoom(m.getZoom())`); `onZoom` chama `zoomIn/zoomOut` em `maps.current`; tags `.tag`/`.banner` removidas (banner absorvido pelo drawer).

- [ ] **Step 3:** build+test verde. **Step 4: Commit** `feat: HUD do mapa + divider estilizado`

### Task 6: `TriagePanel.tsx` + export GeoJSON

**Files:**
- Create: `web/src/components/TriagePanel.tsx`
- Modify: `web/src/App.tsx`

**Interfaces:**
- Produces: `TriagePanel({ sel, plan, floodOk, onClose, onExportFlood })` — `sel:Record<string,any>` (properties), `plan:{priority:string;reasons:string[];actions:string[]}|null`, `floodOk:boolean`, `onExportFlood:()=>void`.
- Consumes: `RISK_LABEL`, `ptRisk`, `riskScore10`, `downloadJson` (Task 3).

- [ ] **Step 1: Componente** — port do painel direito do `code.html`: header `TRIAGEM` + badge `NÍVEL {RISK_LABEL}` colorido por categoria; KPI row `SCORE {riskScore10(sel.risk)}/10`, `POP. EXPOSTA`, `ÁREA SUBMERSA` (`flood_frac`%); seção "DADOS" lista `precip_max7d_mm`, `soil_moisture_mean`, `sus_frac`, `population` (labels mono); "DIRETRIZES DE AÇÃO" = `plan.actions` numeradas + `plan.reasons` como causas (`ptRisk` em ambos); CTA `Ver Plano de Ação` (scroll-to `#acoes`) + `Exportar Polígonos GeoJSON` (disabled `!floodOk`, tooltip "camada não gerada").

- [ ] **Step 2: Wire no App** — substituir `<aside className="panel">`; `floodOk` = `tiler==="online"` && probe `HEAD /api/flood_polygons` no mount (ok→true); `onExportFlood = () => downloadJson("/api/flood_polygons","areas_alagadas_may2024.geojson")`.

- [ ] **Step 3:** build+test verde. **Step 4: Commit** `feat: painel de triagem municipal`

### Task 7: `Timeline.tsx` conectada à story

**Files:**
- Create: `web/src/components/Timeline.tsx`
- Modify: `web/src/App.tsx`

**Interfaces:**
- Produces: `Timeline({ step, onChapter })` — `step:number|null`, `onChapter:(i:number)=>void`.
- Consumes: `STORY` (`src/story.ts`), `Step`.

- [ ] **Step 1: Componente** — rail fixo bottom (`backdrop-blur`, surface-lowest/85): label `CRONOLOGIA · MAI–JUN 2024`; eixo com 2 marcos SAR reais estáticos `11/MAI PICO` (dot error) e `04/JUN RECESSÃO` (dot primary) posicionados nas pontas + 6 nós de capítulo (dot + nº + título truncated, hover) gerados de `STORY`; nó ativo = `step` (glow primary); `step===null` → nenhum ativo, rail continua clicável; `onChapter(i)` → `setStep(i)` (entra na story naquele capítulo — comportamento pinado).

- [ ] **Step 2: Wire no App** — `<Timeline step={step} onChapter={setStep}/>` antes do `</div>` raiz; espaçamento `pb-24` no main p/ não cobrir mapa… não — rail é overlay como no mockup (`absolute bottom-3 inset-x-3`), mapa continua full-bleed.

- [ ] **Step 3:** build+test verde. **Step 4: Commit** `feat: timeline cronologia ligada à story`

### Task 8: `StoryOverlay` restyle + limpeza

**Files:**
- Modify: `web/src/components/StoryOverlay.tsx`
- Modify: `web/src/styles.css` (remover classes mortas se restaram)
- Modify: `web/src/App.tsx` (posicionamento overlay)

**Interfaces:**
- Consumes: mesma `Props` de hoje — assinatura inalterada.

- [ ] **Step 1: Restyle** — glass card (`bg-surface-container-lowest/85 backdrop-blur-xl`, borda `outline-variant`, `rounded-xl`), `story-count` → `label-mono-xs text-primary tracking-wider`, botões primary cyan/ghost surface-high; posição `absolute bottom-24 left-1/2 -translate-x-1/2 z-30` (acima do rail).

- [ ] **Step 2: Caça-mortos** — garantir que nenhuma classe antiga (`header`, `.toolbar`, `.panel`, `.tag`, `.banner`, `.story*`) permanece no JSX; remover blocos CSS não usados do `styles.css`.

- [ ] **Step 3: Verificação visual** — `npm run dev`, abrir preview: comparar contra `screen.png` do mockup (layout, paleta, densidade); conferir estados: sem seleção, município selecionado, story ativa, slider σ0, swipe.

- [ ] **Step 4:** `npm run build && npm test` verde.

- [ ] **Step 5: Commit** `feat: story overlay + ajuste fino final`

---

## Self-Review

- **Spec coverage:** tokens→T1, header/shell→T3, drawer→T4, HUD/pills/quickbar/divider→T5, triage+exports→T6, timeline+story-link→T7, overlay→T8, verificação→T8. Gauge-cota→Resumo-AOI (T4) e banner→drawer (T5) conforme spec. ✅
- **Type consistency:** `Vis`, `Step`, `riskScore10`, `downloadJson`, props dos 5 componentes — nomes fixos acima. ✅
- **Step scan:** cada step = 1 ação verificável; corpos só onde spec pinava valor (regex data, meses). ✅
- **Review focus:** itens 1–5 mapeados para tasks indicadas. ✅
