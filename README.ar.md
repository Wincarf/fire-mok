# Fire Mok

[English](README.md) | [Português](README.pt-BR.md) | [Español](README.es.md) | [Français](README.fr.md) | [中文](README.zh-CN.md) | [Русский](README.ru.md) | **العربية**

[![CI](https://github.com/Wincarf/fire-mok/actions/workflows/ci.yml/badge.svg)](https://github.com/Wincarf/fire-mok/actions/workflows/ci.yml)
[![monitoring](https://github.com/Wincarf/fire-mok/actions/workflows/update-data.yml/badge.svg)](https://github.com/Wincarf/fire-mok/actions/workflows/update-data.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

منصة لرصد الفيضانات في ولاية ريو غراندي دو سول بالبرازيل. الحالة المرجعية:
فيضان مايو/أيار 2024 في حوض غوايبا — اكتُشف عبر SAR Sentinel-1 (مع تكامل
NISAR GCOV) وقوبل بالأراضي (IBGE) والمناخ (Open-Meteo + NASA POWER)
والتضاريس (Copernicus DEM + HAND) والسكان (WorldPop) في مؤشر مخاطر على
مستوى البلديات مع خطة عمل يمكن تتبعها حتى مصادر البيانات.

> مخرجات Fire Mok هي **درجة فرز** لدعم المتخذين للقرار، وليست إنذارًا رسميًا
> من الدفاع المدني.

## تجربته عبر الإنترنت (عرض ثابت)

تطبيق كامل بلا خادم خلفي — فرع [`gh-pages`](https://github.com/Wincarf/fire-mok/tree/gh-pages)
يخدم خرائط تلوين المخاطر، والنطاق SAR الحقيقي لفيضان 11/مايو/2024،
والمقارنة قبل/بعد، والقصة الموجهة، واللوحات البلدية، والطبقات الثلاث
لـ NISAR نطاق L (الارتداد الخلفي، المياه المفتوحة، الثنائي C×L). تُعكس
نقاط نهاية الـ API كملفات (`/api/municipalities`، `/api/layers`،
`/api/plan/{code}`، وبلاطات مُعدّة مسبقًا z6–12).

- الرابط: **https://wincarf.github.io/fire-mok/** (فعّل Pages في
  *Settings → Pages → Deploy from a branch → gh-pages / root*)
- إعادة التوليد: `cd web && npm run build -- --base=/fire-mok/` ثم
  `cd pipeline && uv run python ../scripts/build_pages.py --dist ../web/dist
  --out ../pages_site --data ../data` (يجب أن تكون البيانات في `data/` موجودة).

## رقصة المياه وبطاقة الاثنين (جديد)

- **رقصة المياه (The Dance)** — ثلاث نبضات حقيقية من Sentinel-1 على فيضان
  مايو/أيار 2024، في شريط زمني مع تشغيل تلقائي: **الذروة 11/مايو
  (203.7 km²، ~70.8 ألف شخص معرضون) → التراجع 30/مايو (47.6 km²) →
  الهدوء 4/يونيو (0 km²)**. تُبنى بـ `pipeline/scripts/build_choreo.py`
  (قراءات RTC من Planetary Computer على شبكة مشتركة، تنظيف WorldCover،
  وتعرض مساحي لكل بلدية).
- **بطاقة الاثنين** — نقرة واحدة تحوّل النبضة المختارة إلى بطاقة إنذار
  بالبرتغالية جاهزة لواتساب (نسخ ولصق). كل سجل مبني على بيانات حقيقية؛
  والسجلات بلا مصدر (مثل مدارس/مستشفيات OSM عند تعذر الوصول إلى
  Overpass) تُحذف ببساطة — لا تُختلق أبدًا.
- **ثنائي NISAR** — وضع التقسيم C×L والطبقات الثلاث لنطاق L (الارتداد
  الخلفي، المياه المفتوحة، الثنائي) **منشورة الآن**: أول منتج نطاق L
  (granule GCOV بتاريخ 01/11/2026) بُني بواسطة سير العمل اليومي ونُشر على
  gh-pages. للإعادة: حساب Earthdata مجاني مع الحقول الإلزامية في الملف
  الشخصي (Study Area) + تفويض تطبيق ASF → secrets المستودع → تشغيل
  *monitoring update*.
- نقاط نهاية جديدة: `/api/choreo` و`/api/nisar_product`.

## البنية

```
pipeline/   Python 3.13 (uv): STAC -> COG -> أقنعة -> خصائص -> مخاطر
api/        FastAPI + rio-tiler: بلاطات راستر + نقاط نهاية JSON
web/        React + Vite + MapLibre: تمرير قبل/بعد، طبقات، منزلق σ0
data/       مخرجات مُولّدة (gitignored)
docs/       المنهجية + المواصفات + الخطة
.github/    CI (اختبارات) + استيعاب يومي مجدول لأحدث نطاق
```

## كيفية التشغيل

```bash
# 1) البيانات (مرة واحدة؛ ينزّل ~500 MB من المشاهد من Planetary Computer)
cd pipeline && uv sync
uv run python scripts/build_may2024.py        # SAR -> نطاق الفيضان (مع أقنعة السياق)
uv run python scripts/build_municipalities.py # IBGE + تعداد 2022 + التعرض (WorldPop)
uv run python scripts/build_meteo.py --aoi-only
uv run python scripts/build_terrain.py        # Cop DEM -> HAND -> قابلية الفيضان
uv run python scripts/build_risk.py           # مؤشر المخاطر البلدي
uv run python scripts/build_action_plans.py   # خطط العمل

# 2) API
uv run uvicorn --app-dir ../api app:app --port 8000   # /healthz يفحص الطبقات

# 3) تطبيق الويب
cd ../web && npm install && npm run dev       # http://localhost:5173

# أو كل شيء في حاوية
docker build -t fire-mok . && docker run -p 8000:8000 -v "$PWD/data:/app/data" fire-mok
```

مصادر عامة فقط — لا حاجة لبيانات اعتماد Earthdata.

## المراقبة المستمرة

- `pipeline/scripts/update_latest.py` يجلب أحدث مشهد Sentinel-1 RTC فوق
  منطقة الاهتمام، ويبني النطاق مقابل المشهد السابق من نفس الممر، ويطبّق
  أقنعة السياق (`--dry-run` يعرض الخطة).
- لا زوج بتغطية كاملة في نافذة 14 يومًا ومساحة العمل فارغة (CI جديد)؟
  يعيد بناء النطاق المرجعي بنافذة 30 يومًا، ليكون للثنائي C×L نظير C-نطاق
  دائمًا.
- GitHub Actions يشغّله **يوميًا على الساعة 09:00 بتوقيت برازيليا**
  (`update-data.yml`) وينشر النطاق الجديد كـ artifact.
- الأمطار المواكبة للمستقبل: يستخدم مؤشر المخاطر **الأكبر** بين أمطار
  7 أيام الماضية المرصودة و**توقعات** Open-Meteo لـ 7 أيام قادمة.

## NISAR (ناسا–إيسرو، نطاق L) — يعمل الآن

NISAR مدمج في خط أنابيب المراقبة (`pipeline/scripts/build_nisar.py`):

- **دائمًا**: بحث ASF مجهول فوق منطقة الاهتمام → جرد مشاهد عام في
  `/api/nisar` (60 مشهد GCOV فوق AOI غوايبا خلال العام الماضي؛ يعمل
  يوميًا في CI).
- **مع حساب Earthdata مجاني** (`EARTHDATA_USER`/`EARTHDATA_PASS` أو
  netrc): ينزّل أحدث granule من GCOV، ويحوّل HDF5 → COG (dB)، ويبني dB
  نافذة منطقة الاهتمام، ووكيل المياه المفتوحة، و**فرق الثنائي C×L** مقابل
  أحدث نطاق Sentinel-1 — كل ذلك منشور في `/api/nisar_product` وفي كل خطة
  عمل (كتلة `nisar` في `/api/plan/{code}`). بيانات الاعتماد الناقصة
  **أو المرفوضة** (مثلًا ملف EDL غير مكتمل) تعود إلى `inventory-only`:
  يبقى run أخضر والمراقبة اليومية لا تُعطَّل أبدًا.

نطاق L ونطاق C يبقيان في **طبقات منفصلة**؛ **الثنائي C×L** يقارن أقنعة
المياه (3 فئات: C فقط / L فقط) في تواريخ موسومة — لا فرق dB خام أبدًا.

## التحقق من الصحة

- نطاق SAR مُتحقق منه مقابل Sentinel-2 NDWI (بقناع SCL) على **رقائق
  طبقية** (نصفها بمياه فيضان ونصفها جاف): مصفوفة الالتباس، **F1 وIoU
  وكابا كوهين لكل عتبة σ0، مع فترة ثقة 95% بطريقة bootstrap**. يُرتَّب
  المشهد البصري حسب القرب الزمني من مشهد SAR. إعادة التوليد:
  `uv run python scripts/validate_flood.py --chips 30`.
- التجربة الأصلية (4 رقائق، 2024): توافق متوسط 66.6% عند −17 dB، حتى 79%
  على رقائق بفيضان حقيقي — عُوّض بالتقرير بمقاييس لكل فئة + فترة ثقة.
- الإيجابيات الكاذبة الموثقة (عمراني، مياه دائمة) **تُقص من النطاق** بـ
  ESA WorldCover 10 m (فئتا built-up وpermanent water).
- `cd pipeline && uv run pytest tests/` — 95 اختبارًا؛ `api/tests/` 12؛
  `web/` 20 (vitest). CI يشغّل الثلاثة على GitHub Actions.

## الرخصة

MIT — انظر `LICENSE`.
