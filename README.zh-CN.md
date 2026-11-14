# Fire Mok

[English](README.md) | [Português](README.pt-BR.md) | [Español](README.es.md) | [Français](README.fr.md) | **中文** | [Русский](README.ru.md)

[![CI](https://github.com/Wincarf/fire-mok/actions/workflows/ci.yml/badge.svg)](https://github.com/Wincarf/fire-mok/actions/workflows/ci.yml)
[![monitoring](https://github.com/Wincarf/fire-mok/actions/workflows/update-data.yml/badge.svg)](https://github.com/Wincarf/fire-mok/actions/workflows/update-data.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

面向巴西南里奥格兰德州（Rio Grande do Sul）的洪水监测平台。
锚定案例：2024 年 5 月瓜伊巴（Guaíba）流域洪水，基于 Sentinel-1 SAR
检测（并已为 NISAR 做好准备），融合行政区域（IBGE）、气象
（Open-Meteo + NASA POWER）、地形（Copernicus DEM + HAND）与人口
（WorldPop）数据，生成市级风险指数，并给出每条规则均可溯源到数据的
行动计划。

> Fire Mok 的输出是辅助管理者的**分诊评分**，并非官方民防预警。

## 在线体验（静态演示）

[`gh-pages`](https://github.com/Wincarf/fire-mok/tree/gh-pages) 分支托管了
应用的完整静态版本：风险分级统计地图、2024 年 5 月 11 日洪水的真实 SAR
淹没范围、前后对比（compare）、引导式故事讲解和市政面板——无需后端，
API 端点以文件形式镜像（`/api/municipalities`、`/api/layers`、
`/api/plan/{code}`，以及 z6–12 的预渲染瓦片）。

- 网址：**https://wincarf.github.io/fire-mok/**（需先在
  *Settings → Pages → Deploy from a branch → gh-pages / root* 启用 Pages）
- 重新生成：`cd web && npm run build -- --base=/fire-mok/`，然后
  `cd pipeline && uv run python ../scripts/build_pages.py --dist ../web/dist
  --out ../pages_site --data ../data`（需要 `data/` 中的数据）。

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

以上全流程无需 Earthdata 凭据即可运行（仅使用公开数据源）。

## 持续监测

- `pipeline/scripts/update_latest.py` 获取 AOI 上最新的 Sentinel-1 RTC
  影像，基于同一轨道的前一景构建淹没范围，并应用上下文掩膜
  （`--dry-run` 显示处理计划）。
- GitHub Actions **每天 09:00（巴西利亚时间）** 运行该流程
  （`update-data.yml`），并将新的淹没范围发布为 artifact。
- 风险指数取**两者较大值**：过去 7 天的实测降雨与未来 7 天的**预报**
  降雨（Open-Meteo forecast）——该组件从此具备前瞻性。

## NISAR（任务验证波段）

`pipeline/scripts/validate_nisar.py` 通过 ASF DAAC 下载 NISAR GCOV 影像，
并将 HDF5 转换为 COG。需要 `EARTHDATA_USERNAME`/`EARTHDATA_PASSWORD`；
无凭据时脚本会记录 `skipped: no Earthdata creds` 并正常退出。
NISAR（L 波段）与 Sentinel-1（C 波段）分别保存在**不同图层**——
二者不可通过差值进行比较。

## 验证

- SAR 淹没范围与 Sentinel-2 NDWI（经 SCL 掩膜）在**分层抽样切片**上进行
  验证（一半为有洪水水体的切片，一半为干燥切片）：混淆矩阵、
  **各 σ0 阈值下的 F1、IoU 与 Cohen's kappa，并给出基于 bootstrap 的
  95% 置信区间**。光学影像按与 SAR 影像的时间接近度排序。报告可重新生成：
  `uv run python scripts/validate_flood.py --chips 30`。
- 早期试点（4 个切片，2024 年）：−17 dB 下平均一致率 66.6%，含真实洪水的
  切片最高达 79%——这些是试点数字，无置信区间；新报告以分类别指标 +
  置信区间取代。
- 已记录的假阳性（城市地表、永久水体）通过 ESA WorldCover 10 m
  （built-up 与 permanent water 类别）**从淹没范围中剔除**。
- `cd pipeline && uv run pytest tests/` — 87 个测试；`api/tests/` 9 个；
  `web/` 20 个（vitest）。CI 在 GitHub Actions 上运行全部三套。

## 演示脚本（3 分钟）

1. 地图以滑动对比打开：左侧为 2024/06/04 的 σ0（退水期），右侧为
   2024/05/11（洪峰）。拖动分割线——瓜伊巴河在屏幕上"涨水"。
2. 打开 "Water where it shouldn't be"——红色 = 新检测到的水体
   （已剔除城市地表与永久水体）。
3. 移动 σ0 滑块（−25 → −10 dB）：水体掩膜实时变化——说明阈值是
   一种决策，而不是魔法数字。
4. 点击 Eldorado do Sul 或 Charqueadas：`critical` 风险、由 WorldPop
   网格在淹没像元上累加的暴露人口、以及可溯源到数据的行动计划。
5. 对比 Canoas/POA（`high`）与一个山区市镇（`low`）——指数为治理
   优先级排序。

## 诚实性 / 局限性

见 `docs/methodology.md` 第 6 节：基线为退水期（而非灾前影像）、固定
全局阈值、约 10 m 分辨率、WorldPop 2020（非 2022 年人口普查）、HAND
仅作分诊阈值（非水力学模型）、指数仅针对单一事件做定性校准。

## 许可证

MIT — 见 `LICENSE`。
