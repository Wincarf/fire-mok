# Modo Cinemático + Poster — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Um overlay full-screen Three.js ("modo cinemático") que renderiza o Guaíba como mundo 3D estilizado a partir de dados reais (DEM, flood, OSM), com voo da story e export de poster 4K da visão atual.

**Architecture:** Endpoints binários novos na API FastAPI servem a AOI como grade única (heightmap Float32 + máscara flood). No front, um módulo `web/src/scene/` constrói terreno/água/prédios/céu com `three` carregado por `import()` dinâmico; helpers de geo/geometria ficam em TS puro testável. O poster re-renderiza a visão atual em 3840×2160 sob demanda.

**Tech Stack:** FastAPI + rio_tiler/rasterio (existentes); React 19 + Vite + `three` (nova dep única); vitest; pytest.

**Spec:** `docs/superpowers/specs/2026-11-14-cinematic-mode-design.md`

## Global Constraints

- Apenas UMA dep pesada nova: `three` (+`@types/three` dev). Sem R3F/drei/postprocessing externo — usar `three/examples/jsm`.
- `three` NUNCA importado estaticamente — só `await import("three")` dentro de `scene/` e `CinematicMode.tsx`; o chunk principal do app não pode crescer.
- Helpers testados em vitest não podem importar `three` nem tocar DOM/WebGL.
- Dados reais apenas; sem imagem de satélite na cena; sem valores mock.
- Prédios: Overpass client-side, timeout 15s, `AbortController`, degrada para cena sem prédios.
- Ao fechar o overlay: parar RAF, `dispose()` de geometrias/texturas/renderer/composer.
- Python testes: rodar com `../pipeline/.venv/Scripts/python.exe -m pytest` (env uv do worktree).

## Review Focus

1. `/api/scene*` sem arquivos de dados → deve 404 limpo (não 500) — teste na T1.
2. Overpass timeout/erro → cena renderiza sem prédios com aviso — teste unitário do fetcher na T4.
3. `flood` todo zero (máscara vazia) → água some sem erro — coberto pelo teste de dtype na T1.
4. WebGL indisponível (renderer ctor lança) → overlay mostra estado de erro e fecha limpo — componente de estado na T5.
5. `nx*ny` do meta ≠ bytes recebidos → heightmap decoder valida tamanho e lança — teste na T2.

---

### Task 1: Endpoints `/api/scene*`

**Files:**
- Modify: `api/app.py` (adicionar 3 rotas após `/terrain`)
- Test: `api/tests/test_api.py`

**Interfaces:**
- Produz: `GET /api/scene` → `{"bounds":[w,s,e,n], "nx":int, "ny":int, "cellsize_m":float}`; `GET /api/scene/heightmap` → `application/octet-stream` de `nx*ny*4` bytes (Float32 LE, nodata→0); `GET /api/scene/flood` → `nx*ny` bytes uint8 {0,1}. Mesma grade nos três; `ny` deriva do aspecto dos bounds do DEM com `nx=512`.

- [ ] **Step 1: testes falhando** — em `test_api.py` (fixture `client` já tem dem+flood):
```python
def test_scene_meta(client):
    r = client.get("/api/scene")
    assert r.status_code == 200
    m = r.json()
    assert m["nx"] == 512 and m["ny"] > 0
    assert len(m["bounds"]) == 4 and m["cellsize_m"] > 0

def test_scene_heightmap_binary(client):
    m = client.get("/api/scene").json()
    r = client.get("/api/scene/heightmap")
    assert r.status_code == 200 and len(r.content) == m["nx"] * m["ny"] * 4
    a = np.frombuffer(r.content, dtype="<f4")
    assert np.isfinite(a).all()  # nodata virou 0, nunca NaN

def test_scene_flood_binary(client):
    m = client.get("/api/scene").json()
    r = client.get("/api/scene/flood")
    assert r.status_code == 200 and len(r.content) == m["nx"] * m["ny"]
    a = np.frombuffer(r.content, dtype="uint8")
    assert set(np.unique(a)) <= {0, 1}

def test_scene_missing_dem_404(client, tmp_path):
    (tmp_path / "terrain/d.tif").unlink()
    assert client.get("/api/scene").status_code == 404
```

- [ ] **Step 2: rodar** — `cd api && ../pipeline/.venv/Scripts/python.exe -m pytest tests/test_api.py -k scene -x -q` → FAIL 404

- [ ] **Step 3: implementar** em `api/app.py` — helper `_scene_grid(dem_path)` (abre DEM, lê bounds 4326, `nx=512`, `ny=round(nx*altura/largura)`, `cellsize_m` via cos(lat)); `/api/scene` retorna meta; `/api/scene/heightmap` usa `rasterio.read(1, out_shape=(ny,nx), resampling=Resampling.bilinear, masked=True).filled(0)` → `astype("<f4").tobytes()`; `/api/scene/flood` mesma grade com `Resampling.nearest` sobre `flood_extent`, `filled(0).astype("uint8")`. 404 via `layer_path`.

- [ ] **Step 4: rodar suite** — `pytest tests/test_api.py -x -q` → 14 pass (10 antigos + 4 novos)

- [ ] **Step 5: commit** — `feat: endpoints /api/scene (meta, heightmap f32, máscara flood)`

---

### Task 2: Helpers geo/geometria (TS puro)

**Files:**
- Create: `web/src/scene/geo.ts`
- Test: `web/src/scene/geo.test.ts`

**Interfaces:**
- Produz: `lngLatToXZ(lng:number, lat:number, origin:{lng:number,lat:number}):[number,number]` (metros, equiretangular: `x=(lng-o.lng)*cos(o.lat)*111320`, `z=(lat-o.lat)*110540`); `decodeHeightmap(buf:ArrayBuffer, nx:number, ny:number):Float32Array` (lança se `buf.byteLength!==nx*ny*4`); `buildTerrainArrays(elev:Float32Array, nx:number, ny:number, cell:number, exag:number):{positions:Float32Array, uvs:Float32Array, indices:Uint32Array, colors:Float32Array}` — malha centrada na origem, `y=elev*exag`, gradiente de cor por elevação normalizada (baixo `#23281f` → médio `#4a4f3a` → alto `#5a6470`).

- [ ] **Step 1: testes falhando** — `geo.test.ts`: projeção (origem→[0,0]; 0.01°E→~±1km com sinal correto); decode (tamanho errado lança; little-endian lê valor conhecido); arrays (counts `nx*ny*3`, índices `(nx-1)*(ny-1)*6`, y respeita exag, uv em 0..1).
- [ ] **Step 2:** `cd web && npm test -- geo` → FAIL (arquivo não existe)
- [ ] **Step 3: implementar** `geo.ts` conforme assinaturas.
- [ ] **Step 4:** `npm test` → suíte toda verde
- [ ] **Step 5: commit** — `feat: helpers geo do modo cinemático (projeção, decode, malha)`

---

### Task 3: Núcleo da cena (terreno, água, céu, post, câmera)

**Files:**
- Create: `web/src/scene/world.ts`, `web/src/scene/terrain.ts`, `web/src/scene/water.ts`, `web/src/scene/sky.ts`, `web/src/scene/post.ts`, `web/src/scene/camera.ts`
- Instalar: `npm i three@latest-estável-≥7d && npm i -D @types/three` (verificar data de publicação via `npm view three time`)

**Interfaces:**
- Consome: T1 endpoints; T2 helpers.
- Produz: `type SceneData={meta:{bounds,nx,ny,cellsize_m}, elev:Float32Array, mask:Uint8Array}`; `createWorld(canvas:HTMLCanvasElement, data:SceneData):Promise<World>` onde `World={render():void, resize(w,h):void, flyTo(pos:[n,n,n], look:[n,n,n], ms:number):void, exportStill(w:number,h:number):Blob, dispose():void}` — via `await import("three")` interno.

- [ ] **Step 1:** instalar deps (pin exato, ≥7 dias publicado).
- [ ] **Step 2:** `world.ts` — renderer `antialias`, `shadowMap`, `outputColorSpace SRGB`; fog; RAF loop; `dispose()` completo; `exportStill` renderiza em `WebGLRenderTarget(w,h)` → `readRenderTargetPixels` → flip Y → `ImageData` → canvas → `toBlob("image/png")`.
- [ ] **Step 3:** `terrain.ts` — `BufferGeometry` com arrays da T2 + `MeshStandardMaterial({vertexColors:true, roughness:0.92, flatShading:false})`; normals computadas.
- [ ] **Step 4:** `water.ts` — plano na mesma grade, `ShaderMaterial` transparente: uniforms `{uMask,tTime,uDeep:color,uShallow,uSunDir}`; vertex passa uv; fragment: normais procedurais (3 ondas seno móveis), `alpha=uMask*0.82`, espuma = banda de gradiente da máscara (amostrar 4 vizinhos), fresnel→cor do céu, specular glint.
- [ ] **Step 5:** `sky.ts` (background gradiente via canvas texture + `HemisphereLight` + `DirectionalLight` crepúsculo com shadow camera cobrindo AOI) + `post.ts` (EffectComposer: RenderPass + UnrealBloomPass força ~0.55/threshold ~0.85 + OutputPass).
- [ ] **Step 6:** `camera.ts` — `OrbitControls` (damping, maxPolarAngle ~1.45); `flyTo` = tween manual pos+target no RAF.
- [ ] **Step 7: verificação** — `npm run build` compila; chunk `three` separado confirmado no output; `npm test` verde.
- [ ] **Step 8: commit** — `feat: núcleo da cena 3D (terreno, água shader, céu, bloom, câmera)`

---

### Task 4: Prédios OSM instanciados

**Files:**
- Create: `web/src/scene/buildings.ts`, `web/src/scene/buildings.test.ts`

**Interfaces:**
- Consome: `lngLatToXZ` da T2.
- Produz: `fetchBuildings(bbox:[w,s,e,n], timeoutMs=15000):Promise<Building[]>` onde `Building={cx:number,cz:number, w:number,d:number,h:number}` já em metros locais (usa origem = centro da AOI); `buildBuildingsMesh(THREE, list:Building[]):InstancedMesh`.

- [ ] **Step 1: testes falhando** — `buildings.test.ts`: fetcher com `fetch` mockado (vi.stubGlobal) — timeout aborta → `[]`; resposta Overpass válida → footprint→centro+dimensões, `height` ?? `levels*3` ?? 10; sem dep de three.
- [ ] **Step 2:** `npm test -- buildings` → FAIL
- [ ] **Step 3: implementar** — Overpass QL `way["building"](s,w,n,e);out geom;`; geometria→centro/footprint em metros; cap 15k (amostra se exceder); mesh: box unitário instanciado (scale por prédio), textura procedural de janelas emissivas (canvas 64×64, ~35% janelas acesas `#ffd9a0`), cor base `#7c8ea6` variando por hash.
- [ ] **Step 4:** `npm test` verde + `npm run build`
- [ ] **Step 5: commit** — `feat: prédios OSM instanciados com janelas emissivas`

---

### Task 5: CinematicMode overlay + voo da story

**Files:**
- Create: `web/src/components/CinematicMode.tsx`
- Modify: `web/src/App.tsx` (estado `cine`, botão), `web/src/components/MapHud.tsx` (botão `movie`)

**Interfaces:**
- Consome: `createWorld` (T3), `fetchBuildings/buildBuildingsMesh` (T4), `STORY` + helpers T2.
- Produz: `<CinematicMode open:boolean onClose:()=>void>`; `CINE_FLIGHT: {pos:[n,n,n],look:[n,n,n],ms:number}[]` derivado dos steps (mesma projeção).

- [ ] **Step 1:** `CinematicMode.tsx` — `fixed inset-0 z-50 bg-surface-container-lowest`; estados `loading|ready|error`; abre → `Promise.all([import scene, fetch meta/heightmap/flood])` → `createWorld`; RAF; ESC e botão fecham → `dispose()`; erro → painel "dados indisponíveis" + botão voltar; fetch de prédios em background (falha → aviso não-bloqueante).
- [ ] **Step 2:** barra de controle no rodapé do overlay: presets (3–4 enquadramentos curados), "Voo" (percorre `CINE_FLIGHT` com pausa por capítulo + legenda do capítulo), "Foto 4K" (stub → T6), "Sair"; linha discreta "© OpenStreetMap" no canto.
- [ ] **Step 3:** `App.tsx` — `const [cine,setCine]=useState(false)`; MapHud recebe `onCinematic`; renderiza overlay quando `cine`.
- [ ] **Step 4:** `MapHud.tsx` — botão `movie` na quickbar (mesmo estilo do 3d_rotation).
- [ ] **Step 5:** `npm test` + `npm run build`; verificar no dev server: overlay abre/fecha, dispose libera (performance.memory ou contagem de renderers).
- [ ] **Step 6: commit** — `feat: overlay do modo cinemático + voo da story`

---

### Task 6: Export de poster 4K

**Files:**
- Create: `web/src/scene/poster.ts`
- Modify: `web/src/components/CinematicMode.tsx`

**Interfaces:**
- Consome: `World.exportStill` (T3).
- Produz: `exportPoster(world:World):void` — 3840×2160 → `a.download="poster_guaiba_may2024.png"`.

- [ ] **Step 1:** `poster.ts` — wrapper: chama `exportStill(3840,2160)`, cria `<a>` e dispara download; trata Blob null.
- [ ] **Step 2:** ligar botão "Foto 4K" do overlay + estado "renderizando…" durante ~500ms.
- [ ] **Step 3:** `npm run build` + teste manual no preview: PNG 3840×2160 válido baixa.
- [ ] **Step 4: commit** — `feat: export de poster 4K da visão atual`

---

### Task 7: Verificação final + push

- [ ] `pytest` completo (14), `npm test` (todos), `npm run build` (chunk three separado; aviso 500kB aceitável no chunk lazy)
- [ ] Preview real: api 8001 (`FIREMOK_API`), junction `data/`; abrir modo, voar, exportar poster, fechar e reabrir
- [ ] `git push -u origin feat/cinematic-mode` + report
