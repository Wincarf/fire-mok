# Fire Mok — redesign do frontend para leigos

Data: 2026-11-14 · Status: aguardando aprovação

## Intenção e porquê

O app funciona, mas exige que o usuário saiba o que é σ0, dB e "máscara". A meta
é que uma pessoa leiga (gestor, jurada, cidadã) abra a página e **entenda a
história da enchente de maio/2024 sem ajuda**, podendo depois explorar os dados.

## Abordagem escolhida

**C — Híbrido** (escolhido pelo usuário): modo história guiada por cima de um
dashboard polido. O app abre narrando; "pular" cai no dashboard; botão
"▶ Contar a história" reinicia.

Alternativas rejeitadas: A (só história) prende o explorador; B (só polimento)
ainda exige que o leigo dirija sozinho.

## O que muda

### 1. Modo história (`story` — roteiro de 6 passos)

Componente `StoryOverlay` + array de passos em `src/story.ts`. Cada passo:
`{ titulo, texto, camera: [lng,lat,zoom], layers, split, sel? }`.

| # | Texto (rascunho) | Ação |
|---|---|---|
| 1 | "Esta é a região metropolitana de Porto Alegre vista por radar de satélite — ele enxerga mesmo com nuvens." | SAR antes, zoom 9, split 50 |
| 2 | "Em maio de 2024 choveu em dias o que costuma chover em meses." | mesma câmera; legenda mostra nº de chuva (620–680 mm) |
| 3 | "Compare: à esquerda, a água normal de junho; à direita, o pico de 11 de maio." | divisor anima 0 → 50 (clip-path transition) |
| 4 | "Em vermelho: água onde não devia estar — ~3 milhões de pixels, 4,7% da região." | flood on, zoom 10 no Guaíba |
| 5 | "As cores dos municípios mostram o risco calculado — clique num deles." | muni on, abre painel de Porto Alegre |
| 6 | "Agora é com você." | libera exploração; botões [recomeçar] [explorar] |

Overlay: cartão no rodapé central com passo X/6, [pular] [◂] [▸].
Aplicação do passo: `flyTo` num mapa (o outro sincroniza via `move`),
`setLayers`, `setSplit` animado, `setSel` opcional.

### 2. Polimento do dashboard (linguagem de leigo)

- Renomear toggles: "Água onde não devia estar" · "Simulador de detecção" ·
  "Áreas naturalmente inundáveis" · "Municípios por risco"
- Slider: "Limiar de detecção: {x} dB" (mantém unidade, explica no tooltip)
- Header: subtítulo em linguagem simples
- Banner de números: soma de `pop_exposed` e municípios críticos
  (calculado no cliente a partir de `/api/municipalities`)
- Painel: número de expostos em destaque no topo; plano de ação abaixo
- Legenda de risco já existe — manter

### 3. Não-metas

- Não muda pipeline, API ou dados
- Não adiciona autenticação, i18n, ou mapa base novo
- Não mexe no algoritmo de risco

## Skills por etapa (visíveis na execução)

| Etapa | Skill |
|---|---|
| Design doc (este) | brainstorming |
| Plano de implementação | writing-plans |
| Execução | executing-plans |
| Código novo | test-driven-development (onde houver lógica pura: story script, agregações) |
| Revisão de figuras/UX | scientific-visualization |
| Verificação manual | verification-before-completion |

## Verificação

- `npm run build` + typecheck limpos
- Checklist manual: história avança/pula/reinicia; divisor anima; município
  seleciona nos dois mapas; painel fecha em clique vazio; slider atualiza
  máscara; toggles batem com camadas
- Commit + push em `feat/fire-mok`
