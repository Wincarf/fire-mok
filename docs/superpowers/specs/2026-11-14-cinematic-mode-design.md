# Modo Cinemático + Poster — Design

## Intenção e porquê

O usuário acha a visualização atual ruim: imagem de satélite sobre relevo parece "Google Earth", não um visual criado. Ele quer um **mundo 3D sintético e estilizado** — cara de game/render de Blender — construído com os dados reais do Fire Mok, mais um **poster estático** renderizado da mesma cena.

O modo cinemático é **separado**: um overlay full-screen sobre o app analítico existente, que permanece intocado.

## Goals

- Cena 3D em tempo real da AOI do Guaíba a partir de dados reais (terreno GLO-30, `flood_extent` como máscara de água, prédios OSM)
- Look estilizado de game: crepúsculo, bloom, fog, água com shader animado — **sem imagem de satélite**
- Exploração livre (OrbitControls) + voo cinematográfico ligado à story
- Poster: mesma cena renderizada em 4K → download PNG
- Overlay full-screen no app existente

## Non-goals / anti-goals

- Sem qualidade de render offline/path-traced — "game look", não filme
- Sem basemap de satélite na cena (é exatamente o que está sendo rejeitado)
- Sem mecânica de jogo (sem player controller/física) — é cena + órbita
- Sem mudanças no modo analítico
- Prédios são bônus: a cena funciona sem Overpass

## Constraints

- Uma dep pesada nova permitida: `three` (+`@types/three`); post-processing vem dos examples do próprio three
- Dados reais: DEM/flood via api; prédios via OSM Overpass em runtime (degrada graciosamente)
- Mesmo app Vite/React; worktree + commit por tarefa
- Alvo 60fps em GPU comum: heightmap ~512², prédios instanciados

## Abordagens consideradas

1. **Three.js cena custom (escolhida)** — controle total do look: shaders, luz, post. Custo: camada de render nova + dep `three`.
2. deck.gl sobre MapLibre — continua com cara de mapa. Rejeitada: não entrega o visual pedido.
3. Renders offline em Blender — melhor imagem, mas não interativo e exige Blender no env. Rejeitada para o modo e para o poster (o export 4K do mesmo renderer cobre).

## Design

### Fluxo de dados

- `GET /api/scene` → `{bounds:[w,s,e,n], nx, ny, cellsize_m}` — grade derivada do DEM
- `GET /api/scene/heightmap` → `application/octet-stream`, Float32 LE nx·ny na mesma grade (~512², ~1MB); nodata → 0
- `GET /api/scene/flood` → uint8 nx·ny, `flood_extent` reamostrada na mesma grade
- Prédios: Overpass `way["building"]` no bbox da AOI (POST client-side, CORS ok, timeout ~15s) → altura = `height` ?? `levels`·3 ?? 10; crédito "© OpenStreetMap" no canto do overlay
- Rasters reamostrados no backend via `rasterio.read(out_shape=)` na grade comum

### Sistema de coordenadas

Projeção equiretangular local: origem no centro da AOI, metros (`x = (lng-lng0)·cos(lat0)·R`, `z = (lat-lat0)·R`, `y` = elevação × exagero). Precisão de vizinhança é suficiente para uma cena local. Exagero vertical default ~2.5 (relevo do Guaíba é sutil).

### Cena (`web/src/scene/`)

- `heightmap.ts` — Float32 → PlaneGeometry com displacement + normals
- `terrain.ts` — MeshStandardMaterial estilizado: gradiente por altitude via vertex colors (baixo: lama escura → médio: oliva → alto: ardósia) + tint por slope
- `water.ts` — ShaderMaterial próprio: máscara flood recorta a água; normais procedurais animadas (2–3 oitavas seno/ruído), fresnel, cor profundo/raso, specular do sol, faixa de espuma no contorno da máscara
- `buildings.ts` — InstancedMesh de caixas; textura procedural de janelas emissivas; cor varia por hash do id
- `sky.ts` — background gradiente + sol direcional baixo + hemisphere light + fog
- `post.ts` — EffectComposer: RenderPass + UnrealBloomPass (+ vinheta sutil)
- `camera.ts` — OrbitControls; story: keyframes de dolly (position + lookAt interpolados)
- `CinematicMode.tsx` — overlay React: canvas, estado de loading, ESC fecha, botões Voo/Exportar Poster/Sair
- `poster.ts` — WebGLRenderTarget 3840×2160 → `readRenderTargetPixels` → canvas → toBlob → `poster_guaiba_2024.png`

### Integração com a story

Steps da story mapeiam para keyframes de câmera (lng/lat/zoom + pitch/bearing → posição no espaço da cena). No modo cinemático o HUD/timeline do mapa ficam ocultos; o overlay tem seu próprio controle de voo.

### Falhas e bordas

- `/api/scene*` indisponível → estado "dados indisponíveis" no overlay, fecha limpo
- Overpass falha/timeout → terreno+água renderizam, aviso "prédios indisponíveis"
- WebGL indisponível → mensagem + fechar

### Poster (modo foto)

Export **por clique, da visão atual** — imagens ilimitadas: o usuário enquadra a cena e cada clique baixa um PNG 3840×2160 novo. 3–4 presets de enquadramento curados como atalhos de câmera (ex.: "rio em primeiro plano", "aérea da cidade"). Sombras em alta + supersample 2× se a GPU aguentar. PNG via download.

### Performance (requisito)

- `three` carregado por `import()` dinâmico — zero custo de bundle até o primeiro uso
- A cena só renderiza com o overlay aberto; ao fechar: para o RAF loop, dispõe geometrias/texturas/renderer
- Export é um render único sob demanda (~200–500ms), nunca em loop

### Chamadas do builder

- Constantes de shader, paleta, keyframes — ajuste a olho no preview
- Resolução da grade (512 vs 1024) — pela performance observada
- Formato do poster 16:9 landscape — wallpaper/social-friendly

## Verificação

- pytest: endpoints (shape, dtype, bounds, 404 sem dados)
- vitest: decode heightmap→geometria, projeção lng/lat→metros, UV da máscara (helpers puros; nada de WebGL nos testes)
- build + preview com dados reais — `data/` não é commitada: junction para `.worktrees/fire-mok/data` no worktree, api na 8001 + `FIREMOK_API` (a api do usuário ocupa a 8000)
