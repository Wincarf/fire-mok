"""Planetary Computer STAC catalog constant + scene-id metadata helpers."""

import re
from datetime import datetime, timezone

PC_STAC_URL = "https://planetarycomputer.microsoft.com/api/stac/v1"


def scene_datetime_from_id(scene_id: str) -> datetime | None:
    """Sensing datetime encoded in a scene id ('YYYYMMDDTHHMMSS'), or None."""
    m = re.search(r"(\d{8})T(\d{6})", scene_id)
    if not m:
        return None
    return datetime.strptime(m.group(1) + m.group(2), "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
