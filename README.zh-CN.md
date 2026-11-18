# Fire Mok

[English](README.md) | [Português](README.pt-BR.md) | [Español](README.es.md) | [Français](README.fr.md) | **中文** | [Русский](README.ru.md) | [العربية](README.ar.md)

[![CI](https://github.com/Wincarf/fire-mok/actions/workflows/ci.yml/badge.svg)](https://github.com/Wincarf/fire-mok/actions/workflows/ci.yml)
[![monitoring](https://github.com/Wincarf/fire-mok/actions/workflows/update-data.yml/badge.svg)](https://github.com/Wincarf/fire-mok/actions/workflows/update-data.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

面向巴西南里奥格兰德州（Rio Grande do Sul）的洪水监测平台。
锚定案例：2024 年 5 月瓜伊巴（Guaíba）流域洪水——基于 Sentinel-1 SAR
检测（已集成 NISAR GCOV），融合行政区域（IBGE）、气象
（Open-Meteo + NASA POWER）、地形（Copernicus DEM + HAND）与人口
（WorldPop）数据，生成市级风险指数及可溯源到数据的行动计划。

> Fire Mok 的输出是辅助管理者的**分诊评分**，并非官方民防预警。

## 在线体验（静态演示）

完整应用，无需后端——[`gh-pages`](https://github.com/Wincarf/fire-mok/tree/gh-pages)
分支提供风险分级统计地图、2024 年 5 月 11 日洪水的真实 SAR 淹没范围、
前后对比、引导式故事讲解、市政面板，以及三个 NISAR L 波段图层
（后向散射、开阔水域、C×L 二重奏）。API 端点以文件形式镜像
（`/api/municipalities`、`/api/layers`、`/api/plan/{code}`，
以及 z6–12 的预渲染瓦片）。

- 网址：**https://wincarf.github.io/fire-mok/**（需先在
  *Settings → Pages → Deploy from a branch → gh-pages / root* 启用 Pages）
- 重新生成：`cd web && npm run build -- --base=/fire-mok/`，然后
  `cd pipeline && uv run python ../scripts/build_pages.py --dist ../web/dist
  --out ../pages_site --data ../data`（需要 `data/` 中的数据）。

## 洪水之舞与周一晨报卡片（新功能）

- **洪水之舞（The Dance）** — 哨兵-1号在 2024 年 5 月洪水期间的三个真实时相，
  带时间滑块和自动播放：**5 月 11 日峰值（203.7 km²，约 7.08 万人暴露）→
  5 月 30 日消退（47.6 km²）→ 6 月 4 日平静（0 km²）**。由
  `pipeline/scripts/build_choreo.py` 生成（Planetary Computer RTC 窗口化
  读取、公共网格、WorldCover 清理、按市镇的面积插值人口暴露）。
- **周一晨报卡片** — 一键将所选时相转为葡萄牙语、可直接粘贴到 WhatsApp 的
  通报卡片。每行都来自真实数据；没有数据源的行（例如 Overpass 不可达时的
  学校/医院统计）会直接省略 — 绝不编造。
- **NISAR 二重奏** — C×L 分屏模式与三个 L 波段图层（后向散射、开阔水域、
  二重奏）**已上线**：首个 L 波段产品（2026 年 11 月 1 日的 GCOV 分块）
  已由每日工作流生成并部署到 gh-pages。复现方式：注册免费 Earthdata
  账号并填写必填资料（Study Area）+ 授权 ASF 应用 → 配置仓库 secrets →
  运行 *monitoring update*。
- 新端点：`/api/choreo` 与 `/api/nisar_product`。

## 架构

```
pipeline/   Python 3.13 (uv)：STAC -> COG -> 掩膜 -> 特征 -> 风险
api/        FastAPI + rio-tiler：栅格瓦片 + JSON 端点
web/        React + Vite + MapLibre：前后滑动对比、图层、σ0 滑块
data/       生成的数据产物（已 gitignore）
docs/       方法论 + 规格 + 计划
.github/    CI（测试）+ 每日定时摄取最新淹没范围
```

## 如何运行

```bash
# 1) 数据（只需一次；从 Planetary Computer 下载约 500 MB 影像）
cd pipeline && uv sync
uv run python scripts/build_may2024.py        # SAR -> 洪水范围（含上下文掩膜）
uv run python scripts/build_municipalities.py # IBGE + 2022 年人口普查 + 暴露人口（WorldPop）
uv run python scripts/build_meteo.py --aoi-only
uv run python scripts/build_terrain.py        # Cop DEM -> HAND -> 易涝性
uv run python scripts/build_risk.py           # 市级风险指数
uv run python scripts/build_action_plans.py   # 行动计划

# 2) API
uv run uvicorn --app-dir ../api app:app --port 8000   # /healthz 检查图层

# 3) Web 应用
cd ../web && npm install && npm run dev       # http://localhost:5173

# 或全部放入容器运行
docker build -t fire-mok . && docker run -p 8000:8000 -v "$PWD/data:/app/data" fire-mok
```

仅使用公开数据源——无需 Earthdata 凭据。

## 持续监测

- `pipeline/scripts/update_latest.py` 获取 AOI 上最新的 Sentinel-1 RTC
  影像，基于同一轨道的前一景构建淹没范围，并应用上下文掩膜
  （`--dry-run` 显示处理计划）。
- 若 14 天窗口内没有全覆盖影像对且工作区为空（全新 CI）：会用 30 天
  窗口重建参考淹没范围，确保 C×L 二重奏始终有 C 波段对照。
- GitHub Actions **每天 09:00（巴西利亚时间）** 运行该流程
  （`update-data.yml`），并将新的淹没范围发布为 artifact。
- 前瞻式降雨：风险指数取**两者较大值**——过去 7 天的实测降雨与
  Open-Meteo 未来 7 天的**预报**降雨。

## NISAR（NASA–ISRO，L 波段）— 已上线

NISAR 已接入监测流水线（`pipeline/scripts/build_nisar.py`）：

- **始终**：对 AOI 进行匿名 ASF 搜索 → `/api/nisar` 公开场景目录（过去一年
  Guaíba AOI 上空有 60 景 GCOV；CI 每日运行）。
- **使用免费 Earthdata 登录后**（`EARTHDATA_USER`/`EARTHDATA_PASS` 或
  netrc）：下载最新的 GCOV 分块，转换 HDF5 → COG（dB），生成 AOI 窗口的
  dB 图、开阔水域代理图层，以及对照最新 Sentinel-1 淹没范围的 **C×L
  二重奏差异图**——全部发布在 `/api/nisar_product` 和每个行动计划中
  （`/api/plan/{code}` 的 `nisar` 块）。凭据缺失**或被拒**（例如 EDL 资料
  不完整）时回退到 `inventory-only`：运行保持绿色，每日监测永不阻塞。

L 波段与 C 波段分别保存在**不同图层**；**C×L 二重奏**在各自标注日期上
比较两者的水体掩膜（3 类：仅 C / 仅 L）——绝不做原始 dB 差值。

## 验证

- SAR 淹没范围与 Sentinel-2 NDWI（经 SCL 掩膜）在**分层抽样切片**上
  验证（一半为有洪水水体的切片，一半为干燥切片）：混淆矩阵、
  **各 σ0 阈值下的 F1、IoU 与 Cohen's kappa，并给出基于 bootstrap 的
  95% 置信区间**。光学影像按与 SAR 影像的时间接近度排序。重新生成：
  `uv run python scripts/validate_flood.py --chips 30`。
- 早期试点（4 个切片，2024 年）：−17 dB 下平均一致率 66.6%，含真实洪水的
  切片最高达 79%——已由分类别指标 + 置信区间的新报告取代。
- 已记录的假阳性（城市地表、永久水体）通过 ESA WorldCover 10 m
  （built-up 与 permanent water 类别）**从淹没范围中剔除**。
- `cd pipeline && uv run pytest tests/` — 95 个测试；`api/tests/` 12 个；
  `web/` 20 个（vitest）。CI 在 GitHub Actions 上运行全部三套。

## 许可证

MIT — 见 `LICENSE`。
