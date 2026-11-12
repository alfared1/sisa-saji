"""
Evening rain for the Surplus Prediction Engine, from Open-Meteo (free, no API key).

One request per group of locations returns hourly precipitation for the past weeks
(observed / reanalysis) and the coming days (forecast). The feature is the rain that
falls during the surplus evening, 17:00-22:59 WIB, at the warung's location.

Warung are grouped on a 0.1 degree grid (about 11 km) so the 95 seeded warung need
about 21 locations. Any network or API error returns no data: the caller then uses
NaN, which LightGBM treats as "missing", so training never fails because of weather.
"""
from __future__ import annotations

import json
import math
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta

API = "https://api.open-meteo.com/v1/forecast"
EVENING_HOURS = range(17, 23)  # 17:00 .. 22:59 WIB
MAX_PAST_DAYS = 92  # Open-Meteo forecast API limit
MAX_FORECAST_DAYS = 16
CHUNK = 25  # locations per request
TIMEOUT_S = 20

GridKey = tuple[float, float]


def grid_key(lat: float, lng: float) -> GridKey:
    return (round(lat, 1), round(lng, 1))


def _fetch_chunk(points: list[GridKey], past_days: int, forecast_days: int) -> list[dict]:
    query = urllib.parse.urlencode(
        {
            "latitude": ",".join(f"{p[0]:.1f}" for p in points),
            "longitude": ",".join(f"{p[1]:.1f}" for p in points),
            "hourly": "precipitation",
            "timezone": "Asia/Jakarta",
            "past_days": past_days,
            "forecast_days": forecast_days,
        }
    )
    req = urllib.request.Request(f"{API}?{query}", headers={"User-Agent": "sisa-saji-ml/1.0"})
    with urllib.request.urlopen(req, timeout=TIMEOUT_S) as res:  # noqa: S310 - fixed https endpoint
        body = json.loads(res.read().decode("utf-8"))
    # One location returns an object, several return a list.
    return body if isinstance(body, list) else [body]


def evening_rain(
    points: set[GridKey], start: date, end: date, today: date, log=print
) -> dict[tuple[GridKey, date], float]:
    """Evening rain in mm per (grid point, date) for start..end (inclusive). Empty on failure."""
    if not points:
        return {}
    past_days = min(MAX_PAST_DAYS, max(0, (today - start).days))
    forecast_days = min(MAX_FORECAST_DAYS, max(1, (end - today).days + 1))
    out: dict[tuple[GridKey, date], float] = {}
    ordered = sorted(points)
    try:
        for i in range(0, len(ordered), CHUNK):
            chunk = ordered[i : i + CHUNK]
            for key, loc in zip(chunk, _fetch_chunk(chunk, past_days, forecast_days)):
                hourly = loc.get("hourly", {})
                totals: dict[date, float] = {}
                seen: dict[date, int] = {}
                for t, mm in zip(hourly.get("time", []), hourly.get("precipitation", [])):
                    stamp = datetime.fromisoformat(t)
                    if stamp.hour not in EVENING_HOURS or mm is None:
                        continue
                    d = stamp.date()
                    totals[d] = totals.get(d, 0.0) + float(mm)
                    seen[d] = seen.get(d, 0) + 1
                for d, total in totals.items():
                    # Only full evenings: a partial day would understate the rain.
                    if seen[d] == len(EVENING_HOURS):
                        out[(key, d)] = round(total, 1)
    except Exception as exc:  # noqa: BLE001 - weather is optional, never fatal
        log(f"cuaca tidak tersedia ({type(exc).__name__}: {exc}); fitur hujan diisi kosong")
        return {}
    return out


def rain_for(rain: dict[tuple[GridKey, date], float], lat: float, lng: float, d: date) -> float:
    """mm for the warung's grid point on date d, NaN when unknown."""
    return rain.get((grid_key(lat, lng), d), math.nan)


def days_between(start: date, end: date) -> list[date]:
    return [start + timedelta(days=k) for k in range((end - start).days + 1)]
