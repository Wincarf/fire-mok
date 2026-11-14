"""Milestone-1 validation: real NISAR GCOV scene -> HDF5 -> usable COG layer."""

import argparse
import datetime
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pipeline.aoi import get_aoi
from pipeline.nisar import download_gcov, earthdata_session, gcov_to_cog, search_nisar_gcov

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("validate_nisar")

DATA_DIR = Path(__file__).resolve().parents[2] / "data" / "sar"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--aoi", default="guaiba")
    parser.add_argument("--pol", default="HHHH")
    args = parser.parse_args()
    aoi = get_aoi(args.aoi)

    session = earthdata_session()
    if session is None:
        print("skipped: no Earthdata creds (set EARTHDATA_USER/EARTHDATA_PASS or ~/.netrc)")
        return 0

    today = datetime.date.today().isoformat()
    scenes = search_nisar_gcov(aoi.bbox, "2026-10-21", today)
    print(f"found {len(scenes)} GCOV scenes over {aoi.name} since 2026-10-21")
    if not scenes:
        return 0

    scene = scenes[0]
    print(f"scene: {scene.id} @ {scene.datetime}")
    h5 = download_gcov(scene, session, DATA_DIR)
    print(f"downloaded -> {h5} ({h5.stat().st_size / 1e6:.1f} MB)")

    cog = gcov_to_cog(h5, pol=args.pol)
    print(f"COG -> {cog}")

    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        import rasterio

        with rasterio.open(cog) as src:
            db = src.read(1, masked=True)
        png = DATA_DIR / f"{cog.stem}_preview.png"
        plt.figure(figsize=(8, 8))
        plt.imshow(db, cmap="gray", vmin=-30, vmax=0)
        plt.colorbar(label="sigma0 (dB)")
        plt.title(f"NISAR GCOV {args.pol} — {scene.datetime[:10]}")
        plt.savefig(png, dpi=120, bbox_inches="tight")
        print(f"preview -> {png}")
    except ImportError:
        print("matplotlib not installed; skipping preview")

    return 0


if __name__ == "__main__":
    sys.exit(main())
