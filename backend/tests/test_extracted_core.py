"""Tests unitaires sur les fonctions pures extraites (sans Mongo)."""
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

from routers.punches import punch_break_minutes, punch_hours
from routers.shifts import validate_shift_core, fmt_shift_txt


def test_punch_hours_unpaid_break():
    p = {
        "punch_in": "2026-09-11T12:00:00+00:00",
        "punch_out": "2026-09-11T16:00:00+00:00",
        "breaks": [{"start": "2026-09-11T13:00:00+00:00", "end": "2026-09-11T13:30:00+00:00"}],
    }
    assert punch_break_minutes(p) == 30.0
    assert punch_hours(p, {"rounding_minutes": 0, "breaks_paid": False}) == 3.5
    assert punch_hours(p, {"rounding_minutes": 0, "breaks_paid": True}) == 4.0


def test_punch_hours_open_shift_is_zero():
    assert punch_hours({"punch_in": "2026-09-11T12:00:00+00:00"}, {}) == 0.0


def test_validate_shift_core_ok():
    validate_shift_core("2026-09-11", "08:00", "16:00")


def test_validate_shift_core_bad_time():
    with pytest.raises(HTTPException) as exc:
        validate_shift_core("2026-09-11", "8h", "16:00")
    assert exc.value.status_code == 400


def test_validate_shift_core_end_before_start():
    with pytest.raises(HTTPException):
        validate_shift_core("2026-09-11", "16:00", "08:00")


def test_fmt_shift_txt():
    assert "le 2026-09-11 de 08:00 à 16:00" in fmt_shift_txt(
        {"date": "2026-09-11", "start": "08:00", "end": "16:00", "department": "Général"}
    )
