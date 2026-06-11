"""Per-resource booking availability windows.

Some resources (like Neo School halls — we rent the school's space, the
school is occupied during regular school hours) can only be booked
inside specific weekly windows. This module is the single source of
truth for those constraints; ``check_availability`` calls in here so
the same rule shows up wherever a booking is created or proposed.

The frontend mirrors the same constants (src/utils/resourceWindows.ts)
so the chessboard can grey out forbidden slots before the user even
tries to book — but the backend remains the enforcing authority.

Format: ``{resource_id: {dow: [(start_hhmm, end_hhmm), ...]}}``
where ``dow`` is 0=Mon..6=Sun.
Resources NOT in this dict are unconstrained (24/7 bookable).
A day-of-week missing from a constrained resource = day OFF entirely.
"""
from typing import Optional

# Mon–Fri evenings 18:00–22:00, Sat–Sun 09:00–21:00
_NEO_SCHOOL_WINDOW = {
    0: [("18:00", "22:00")],   # Mon
    1: [("18:00", "22:00")],   # Tue
    2: [("18:00", "22:00")],   # Wed
    3: [("18:00", "22:00")],   # Thu
    4: [("18:00", "22:00")],   # Fri
    5: [("09:00", "21:00")],   # Sat
    6: [("09:00", "21:00")],   # Sun
}

RESOURCE_WINDOWS: dict[str, dict[int, list[tuple[str, str]]]] = {
    "neo_school_room_1": _NEO_SCHOOL_WINDOW,  # Аудитория 1 (legacy)
    "neo_school_room_2": _NEO_SCHOOL_WINDOW,  # Зал 1 (50+ м²)
    "neo_school_room_3": _NEO_SCHOOL_WINDOW,  # Зал 2 (50+ м²)
    "neo_school_gym_1":  _NEO_SCHOOL_WINDOW,  # Спортзал (66 м²)
}


def _hhmm_to_minutes(s: str) -> int:
    h, m = s.split(":")
    return int(h) * 60 + int(m)


def is_within_window(
    resource_id: str,
    dow: int,
    start_time: str,
    duration_minutes: int,
) -> tuple[bool, Optional[str]]:
    """Return (allowed, reason).

    - ``allowed=True`` for any resource not in RESOURCE_WINDOWS (no restriction).
    - For constrained resources: the booking [start, start+duration) must fit
      ENTIRELY inside one of the day's windows. Crossing a window boundary
      (e.g. starting 17:30 for a 18:00–22:00 window) counts as forbidden —
      the rented space simply isn't available before 18:00.
    """
    windows = RESOURCE_WINDOWS.get(resource_id)
    if windows is None:
        return True, None

    day_windows = windows.get(dow)
    if not day_windows:
        ru_dow = ["понедельник", "вторник", "среду", "четверг",
                  "пятницу", "субботу", "воскресенье"][dow]
        return False, f"Эта локация в {ru_dow} закрыта"

    start_m = _hhmm_to_minutes(start_time)
    end_m = start_m + duration_minutes
    for w_start, w_end in day_windows:
        ws = _hhmm_to_minutes(w_start)
        we = _hhmm_to_minutes(w_end)
        if start_m >= ws and end_m <= we:
            return True, None

    # Build a friendly hint
    hint = " / ".join(f"{ws}–{we}" for ws, we in day_windows)
    return False, f"Слот вне окна доступа этой локации (доступно: {hint})"
