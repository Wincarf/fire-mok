# Fire Mok UI Redesign (modo história + polimento) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reescrever a camada de UI para que um leigo entenda a enchente de maio/2024: modo história guiada (6 passos) sobre um dashboard polido em linguagem simples.

**Architecture:** O roteiro é um array de passos em `src/story.ts`; cada passo aplica `flyTo` (o segundo mapa sincroniza via `move`), visibilidade absoluta de camadas, posição do divisor e seleção opcional de município. Nenhuma mudança em API/pipeline/dados.

**Tech Stack:** React 19, MapLibre GL 5, TypeScript, Vite, vitest (novo devDep para a lógica pura).

**Spec:** `docs/superpowers/specs/2026-11-14-fire-mok-ui-design.md`

## Global Constraints

- Idioma: português simples — nada de "máscara", "σ0" sem contexto, "extent"
- Não alterar `api/`, `pipeline/`, `data/` nem algoritmos
- Sem novas dependências de UI (sem Material, Tailwind); CSS no `styles.css` existente
- Cada tarefa termina com `Invoke skills` + commit + push em `feat/fire-mok`
- Manter swipe manual, sync de mapas e toggles funcionando

## Review Focus

1. Passo de história com `layers` contendo chave inválida → aplicaria silenciosamente errado — esperado: teste que valida chaves ⊆ `Vis` (T1).
2. `/api/municipalities` falha → banner não pode quebrar a página — esperado: renderizar `null` sem crash (T3, teste de `summarize` + guard).
3. Usuário avança passos rápido → `flyTo` em voo deve ser interrompido pelo próximo — esperado: sem exceção, câmera termina no último passo (verificação manual T2).
4. Replay da história após toggles manuais → estado deve ser absoluto, não delta — esperado: `applyStep` seta `Vis` inteiro (T2).
5. Animação do divisor não pode deixar o arrasto manual "pesado" — esperado: `transition` só quando `.anim` presente (T2).

---

### Task 1: Módulos puros — roteiro da história + agregação de stats

**Invoke skills:** `test-driven-development` (RED → GREEN → refactor; teste antes do código), `executing-plans`

**Files:**
- Create: `web/src/story.ts`
- Create: `web/src/stats.ts`
- Test: `web/src/story.test.ts`
- Modify: `web/package.json` (devDep vitest + script `test`)

**Interfaces:**
- Produces:
  - `type Step = { title: string; text: string; camera: [number, number, number]; layers: Vis; split: number; sel?: string }`
  - `export const STORY: Step[]` — 6 passos conforme spec §1
  - `export function summarizeMunicipalities(features: any[]): { exposed: number; critical: number }` — soma `pop_exposed`, conta `risk_category === "critical"`; retorna `{exposed:0, critical:0}` para array vazio/inválido
- Consumes: `Vis` type já em `App.tsx` — mover para `src/vis.ts` e reimportar (evitar ciclo story↔App).

- [ ] **Step 1 — teste RED:** escrever `story.test.ts` com: (a) `STORY.length === 6`; (b) toda chave de `step.layers` ⊆ `{flood,mask,sus,muni}`; (c) `step.camera` = 3 números finitos, zoom entre 6 e 13; (d) `summarizeMunicipalities` soma `pop_exposed` e conta `critical` corretamente num fixture de 3 features; (e) retorna zeros para `[]` e para entrada não-array.
- [ ] **Step 2:** `npx vitest run` → FAIL (módulos inexistentes).
- [ ] **Step 3:** implementar `src/vis.ts` (`export type Vis`), `src/stats.ts`, `src/story.ts` com o roteiro de 6 passos do design (textos do spec §1, câmeras: passos 1–2 `[-51.15,-30.05,9]`, passo 3 mesmo centro, passo 4 `[-51.2,-30.05,10]`, passo 5 `[-51.23,-30.03,9.5]` sel `"4314902"`, passo 6 volta `[-51.15,-30.05,9]`).
- [ ] **Step 4:** `npx vitest run` → PASS (verde).
- [ ] **Step 5:** `npx tsc --noEmit` limpo; commit `feat: story script + municipality stats (pure modules)`; push.

### Task 2: StoryOverlay + modo história no App

**Invoke skills:** `executing-plans`; `test-driven-development` se houver lógica pura nova (o overlay é glue DOM — verificação manual, registrar no ledger que TDD não se aplica)

**Files:**
- Create: `web/src/components/StoryOverlay.tsx`
- Modify: `web/src/App.tsx` (estado `step: number | null`, `applyStep`, overlay, botão "▶ Contar a história")
- Modify: `web/src/styles.css` (cartão da história + `.map.top.anim { transition: clip-path .8s ease }`)

**Interfaces:**
- Consumes: `STORY`, `Step` de T1; `Vis`; `maps.current`, `afterMap`, `setLayers`, `setSplit`, `setSel` existentes.
- Produces: `<StoryOverlay step onPrev onNext onSkip />`; `applyStep(s: Step)` usado pelo App; nada exportado para outras tasks além do comportamento.

- [ ] **Step 1:** estado `step` (inicia `0`), `applyStep`: `afterMap.current.flyTo({center:[lng,lat],zoom})`, `setLayers(step.layers)`, `setSplit(step.split)`, `setSel(muni code → objeto via fetch em `/api/municipalities` cacheado ou `null`)`. Classe `anim` ligada enquanto `step !== null` (transição suave do clip-path).
- [ ] **Step 2:** `StoryOverlay`: cartão fixo rodapé-centro com `PASSO {i+1}/6`, título, texto, botões `[pular] [◂] [▸]`; no último passo `[▸]` vira `[explorar]` (fecha) + `[recomeçar]` (volta ao 0).
- [ ] **Step 3:** verificação manual — avançar 6 passos rápido (flyTo interrompe ok), pular, recomeçar, divisor anima só no modo história.
- [ ] **Step 4:** `npm run build` limpo; commit `feat: guided story mode`; push.

### Task 3: Polimento do dashboard (linguagem de leigo + banner + painel)

**Invoke skills:** `executing-plans`, `scientific-visualization` (legibilidade/hierarquia visual dos números)

**Files:**
- Modify: `web/src/App.tsx` (labels, banner de stats, ordem do painel)
- Modify: `web/src/styles.css`

**Interfaces:**
- Consumes: `summarizeMunicipalities` de T1; `Vis`.
- Produces: nenhuma interface nova — só apresentação.

- [ ] **Step 1:** renomear toggles → "Água onde não devia estar", "Simulador de detecção", "Áreas naturalmente inundáveis", "Municípios por risco"; slider → "Limiar de detecção: {x} dB"; subtítulo do header em linguagem simples; botão "▶ Contar a história" visível quando `step === null`.
- [ ] **Step 2:** banner (canto superior esquerdo sobre o mapa): `~X pessoas potencialmente afetadas · Y municípios em risco crítico` via `summarizeMunicipalities` sobre `/api/municipalities` cacheado; renderiza `null` se fetch falhar.
- [ ] **Step 3:** painel — primeiro o número de expostos em destaque grande, depois badge de risco, stats restantes, plano de ação; manter fechar/clique-vazio.
- [ ] **Step 4:** `npm run build` + `npx vitest run` limpos; checklist manual do spec; commit `feat: layperson dashboard polish`; push.

### Final: verificação integrada + revisão

**Invoke skills:** `verification-before-completion` (verificar antes de declarar pronto), `requesting-code-review`

- [ ] Checklist do spec §verificação inteira executada manualmente no browser
- [ ] `npx vitest run` + `npm run build` + suíte Python intacta
- [ ] Review Focus 1–5 confirmados
- [ ] Apresentar diff ao usuário
