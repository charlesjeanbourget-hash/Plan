"""Tests sans FastAPI / Mongo — logiques pures recopiées pour CI locale minimale."""
from datetime import date, datetime, timezone
import math


def punch_break_minutes(p):
    total = 0.0
    for b in (p.get("breaks") or []):
        if b.get("start") and b.get("end"):
            total += (datetime.fromisoformat(b["end"]) - datetime.fromisoformat(b["start"])).total_seconds() / 60
    return round(total, 1)


def punch_hours(p, settings):
    if not p.get("punch_out"):
        return 0.0
    m = int(settings.get("rounding_minutes") or 0)
    mode = settings.get("rounding_mode") or "nearest"
    def _round(dt):
        if m <= 0:
            return dt
        secs = m * 60
        ts = dt.timestamp()
        if mode == "up":
            rounded = math.ceil(ts / secs) * secs
        elif mode == "down":
            rounded = math.floor(ts / secs) * secs
        else:
            rounded = round(ts / secs) * secs
        return datetime.fromtimestamp(rounded, tz=timezone.utc)
    t_in = _round(datetime.fromisoformat(p["punch_in"]))
    t_out = _round(datetime.fromisoformat(p["punch_out"]))
    h = max(0.0, (t_out - t_in).total_seconds() / 3600)
    if not settings.get("breaks_paid"):
        h = max(0.0, h - punch_break_minutes(p) / 60)
    return h


def leave_days(start, end):
    return float((date.fromisoformat(end) - date.fromisoformat(start)).days + 1)


def test_punch_unpaid_break():
    p = {
        "punch_in": "2026-09-11T12:00:00+00:00",
        "punch_out": "2026-09-11T16:00:00+00:00",
        "breaks": [{"start": "2026-09-11T13:00:00+00:00", "end": "2026-09-11T13:30:00+00:00"}],
    }
    assert punch_break_minutes(p) == 30.0
    assert punch_hours(p, {"rounding_minutes": 0, "breaks_paid": False}) == 3.5


def test_punch_paid_break():
    p = {
        "punch_in": "2026-09-11T12:00:00+00:00",
        "punch_out": "2026-09-11T16:00:00+00:00",
        "breaks": [{"start": "2026-09-11T13:00:00+00:00", "end": "2026-09-11T13:30:00+00:00"}],
    }
    assert punch_hours(p, {"rounding_minutes": 0, "breaks_paid": True}) == 4.0


def test_open_shift_zero():
    assert punch_hours({"punch_in": "2026-09-11T12:00:00+00:00"}, {}) == 0.0


def test_leave_inclusive_days():
    assert leave_days("2026-09-11", "2026-09-13") == 3.0
    assert leave_days("2026-09-11", "2026-09-11") == 1.0
