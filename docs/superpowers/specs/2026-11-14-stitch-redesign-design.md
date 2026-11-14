# Fire Mok × Stitch — Redesign do frontend (design)

Data: 2026-11-14 · Branch: `feat/stitch-redesign` (worktree `.worktrees/stitch-redesign`)

## Intenção

O app `web/` (React 19 + TS + Vite + MapLibre) hoje tem visual improvisado: header/toolbar escuros,
painel de município branco, fonte system-ui. O objetivo é aplicar o design system do export
Stitch "Hydrologic Risk & Geospatial Command" (`DESIGN.md` + `code.html` em `.tmp_stitch/`):
HUD cartográfico dark, cyan radar, Geist + JetBrains Mono, layout de "war room" geoespacial.

Por quê: melhorar front-end e design do projeto original, elevando a credibilidade
da interface para uso em contexto de resposta a enchentes.

## Goals

- Redesign visual completo do app para o design system Stitch.
- Preservar 100% da funcionalidade real existente: dois mapas MapLibre sincronizados com
  swipe (clip-path), toggle de camadas, limiar σ0, clique em município → painel + plano,
  story guiada de 6 passos.
- Timeline inferior funcional conectada ao estado (story step / split / camadas).
- Somente dados reais vindos da API/pipeline (nada de métricas inventadas do mockup).
- Testes existentes (`story.test.ts`, 11 testes) continuam passando; `npm run build` limpo.

## Non-goals

- Novos endpoints de API ou mudanças no pipeline Python.
- Adoção de Tailwind (o Stitch usa CDN runtime — não portamos).
- Mapa real novo: o "mapa" do mockup é imagem estática Google — descartado; mantemos MapLibre.
- Responsividade completa mobile (fase opcional posterior; layout desktop-first).

## Anti-goals (falha mesmo se "funcionar")

- Métricas fabricadas (cota Guaíba 3.18m, lâmina d'água, "9.8/10" sem base, 6 passes SAR).
- Botões/links decorativos sem ação real.
- Quebrar o sync dos dois mapas ou o fluxo da story.
- Visual claro/branco remanescente em qualquer painel.

## Constraints

- DevDeps novas: `tailwindcss` + `@tailwindcss/vite` (v4, config CSS-first via `@theme` — sem `tailwind.config.js`). O CDN runtime do mockup NÃO é usado.
- Tokens do DESIGN.md viram `@theme` em `styles.css` (`--color-*`, `--text-*`, `--spacing-*`, `--radius-*`) gerando as mesmas utilities do mockup (`bg-surface-container-low`, `font-label-mono-xs`, `px-space-md`, …).
- CSS custom fica mínimo: canvas MapLibre, `clip-path` do swipe, scrollbar-hide, transitions.
- Ícones: Material Symbols via Google Fonts (como o Stitch) — fallback `system-ui` degrada para texto.
- Fontes: Geist (UI) + JetBrains Mono (métricas/labels técnicos) via Google Fonts em `index.html`.
- Apenas 2 cenas SAR reais: pico 11/mai/2024 (`sar_after`), recessão 04/jun/2024 (`sar_before`).
- API existente: `/api/layers`, `/api/municipalities`, `/api/plan/{code}`, `/api/flood_polygons`, `/tiles/{layer}/...`.
- UI em pt-BR.

## Approaches considerados

| Abordagem | Trade-off | Decisão |
|---|---|---|
| A. CSS vars + reestrutura de componentes | Sem deps; respeita convenção atual (`styles.css` único); mas cada futuro export Stitch exigiria tradução manual | Rejeitada |
| **B. Tailwind v4 + `@tailwindcss/vite`** | Uma devDep a mais; mas o JSX do `code.html` porta quase verbatim (mesmas classes), e futuros exports Stitch viram copiar-colar | **Escolhida (decisão do usuário)** |
| C. Só retematizar cores/fontes no CSS atual | Rápido, mas não entrega o layout HUD (drawer, triage, timeline) pedido | Rejeitada |

## Design

### Tokens (`styles.css` `@theme`)

Portar `DESIGN.md` → tokens Tailwind v4 (nomes idênticos ao `tailwind.config` do mockup,
para as classes portarem verbatim):

- **Cores**: `--color-surface*:{#0a0e18…#353944}`, `--color-primary:#4cd7f6`,
  `--color-primary-container:#06b6d4`, `--color-secondary*`, `--color-tertiary*`,
  `--color-error*`, `--color-on-*`, `--color-outline*`.
- **Risco** (municipalities, mantém semântica atual): critical/high/moderate/low mapeados
  para tertiary/error/warn/ok do sistema (contraste AA sobre superfície dark).
- **Tipografia**: `--text-{display-lg,headline-*,body-*,metric-*,label-mono-*}` com
  line-height/tracking do DESIGN.md; `--font-display:Geist`, `--font-mono:"JetBrains Mono"`.
- **Espaçamento**: `--spacing-space-{xs,sm,md,lg,xl}` + `gutter*` (0.25–1.5rem).
- **Raios**: `--radius-*` 4px/8px/pill.
- **Elevação**: sem sombras pesadas — bordas 1px `outline-variant` + `backdrop-blur`
  com `bg-surface-container-lowest/85` em painéis flutuantes.

### Layout (desktop-first)

```
┌──────────────────────────────────────────────────────────┐
│ HEADER fixo 64px: logo "Fire Mok" + chip versão │ status  │
│ rio-tiler │ coords live │ [Exportar] [▶ História]         │
├──────────┬───────────────────────────────────┬───────────┤
│ DRAWER   │                                   │  TRIAGE   │
│ 256-320px│   MAPA MAPLIBRE FULL-BLEED        │  dock     │
│ camadas  │   (2 mapas sync + swipe divider)  │  380px    │
│ + slider │   pills ESQ/DIR │ HUD coords │    │ (sob      │
│ + resumo │   quickbar zoom                   │ demanda)  │
├──────────┴───────────────────────────────────┴───────────┤
│ TIMELINE rail: passes SAR reais + capítulos da story     │
└──────────────────────────────────────────────────────────┘
```

### Mapeamento componente → dados reais

| Elemento Stitch | Implementação real |
|---|---|
| Header "Fire Mok" wordmark + chip `v1.2 — Sentinel-1` | Texto (sem img externa) |
| Status "rio-tiler: ONLINE" | `GET /api/layers` no mount → ok/erro + latência medida |
| Coords Lat/Lon | `mousemove` no mapa → `e.lngLat` (HUD pill real) |
| Botão Exportar | Download de `/api/municipalities` (GeoJSON) |
| Drawer camadas + chips banda | Toggles existentes (flood/mask/sus/muni) + chips informativos |
| Slider limiar σ0 | Mesmo state `thresh` (-25…-10 dB), restilizado (track cyan) |
| Gauge "Cota Guaíba" | **Removido** (sem dados); no lugar: card "Resumo da AOI" com `summary.exposed`/`summary.critical` (já calculado) |
| Último passe SAR | Data real extraída do nome da cena `sar_before` (04/jun/2024) + id Sentinel-1A do LAYERS |
| Pills ESQUERDA/DIREITA | Substitui `.tag` (textos reais: "RECESSÃO 04/JUN" / "PICO 11/MAI") |
| Divider com knob `drag_indicator` | Mesmo handler pointer; novo visual (linha glow + círculo) |
| Quickbar zoom | `map.zoomIn()/zoomOut()` nos dois mapas sincronizados |
| Painel triagem (score, pop, causas, ações) | `sel.risk` (índice real → score ×10 /10), `pop_exposed`, `flood_frac`, `precip_max7d_mm`, `soil_moisture_mean`, `sus_frac`; `plan.reasons`/`plan.actions` numeradas |
| "Exportar Polígonos GeoJSON" | `GET /api/flood_polygons` → download |
| Timeline cronologia | 2 marcos SAR reais (11/mai, 04/jun) + 6 nós de capítulo da story; clique → `setStep(i)`; indicador segue `step`/`split` |
| Story overlay | Mesmo componente `StoryOverlay`, restilizado (glass card, mono labels) |

### Componentes

- `App.tsx` — reestrutura o JSX portando a estrutura de `code.html` (mesmas utilities);
  refs de mapa e lógica inalterados.
- `styles.css` — `@import "tailwindcss"` + `@theme` com os tokens + ~30 linhas de CSS
  custom (mapa, swipe, scrollbar).
- `vite.config.ts` — plugin `@tailwindcss/vite`.
- Novos: `components/Header.tsx`, `components/LayersDrawer.tsx`, `components/Timeline.tsx`,
  `components/TriagePanel.tsx` (ex-`.panel`), `components/MapHud.tsx` (pills/coords/quickbar).
- `StoryOverlay.tsx` — só CSS/markup classes.
- Estado permanece em `App` (lifted); componentes novos recebem props.

## Deixado ao builder (minhas decisões)

- StoryOverlay e Timeline ambos no rodapé: o card da story sobe (docks acima do rail,
  `bottom ≈ 96px`); durante a story o capítulo ativo fica destacado no timeline.
- O `.banner` flutuante (pop. exposta total) é absorvido pelo card "Resumo da AOI" no drawer.
- Posição exata de pills/quickbar (mockup como referência, ajuste fino visual).
- Story CTA vive no header (botão secundário cyan-outline) + mantém `.story-btn` fora da toolbar.
- Legend de risco move-se para dentro do drawer (abaixo das camadas).
- Ícones Material Symbols onde o mockup usa; texto simples como fallback acessível.
- Divider knob usa `drag_indicator`; tags viram pills com dot pulsante só no lado "pico".

## Verificação

- `npm test` (11 testes vitest — lógica de story/labels intocada).
- `npm run build` tsc limpo.
- Preview visual via dev server (API real atrás do proxy vite existente).
