"""Areas of interest for Fire Mok, in EPSG:4326 lon/lat bboxes."""

from dataclasses import dataclass


@dataclass(frozen=True)
class AOI:
    name: str
    bbox: tuple[float, float, float, float]
    epsg: int = 4326


AOIS: dict[str, AOI] = {
    "guaiba": AOI("guaiba", (-51.6, -30.4, -50.7, -29.7)),
    "taquari": AOI("taquari", (-52.4, -29.5, -51.6, -29.0)),
}


def get_aoi(name: str) -> AOI:
    return AOIS[name]
