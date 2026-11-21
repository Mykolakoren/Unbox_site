"""Даты работы филиала: с какого и по какое число он принимает брони.

Переезд 21.11.2026 (решение владельца): Палиашвили работает по 29.11, Абусеридзе
по 30.11, новый центр UNBOX 99 — с 30.11. Раньше сайт не знал «филиал закрыт с
такого-то числа»: люди продолжали ставить брони в закрывающиеся центры на декабрь.

Даты лежат в таблице филиалов (Location.open_from / open_until, включительно).
Единственный, кто решает, — сервер: ``closure_reason`` зовёт ``check_availability``,
а через неё проходит любое создание, перенос и продление брони. Экраны читают те
же даты из /locations, чтобы закрыть клетки заранее, но доверять им нельзя.
"""
from datetime import date, datetime
from typing import Optional, Union

from sqlmodel import Session

from app.models.location import Location
from app.models.resource import Resource


def _parse(value: Optional[str]) -> Optional[date]:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None  # кривую дату в базе считаем «границы нет», а не «закрыто навсегда»


def _ru(d: date) -> str:
    return d.strftime("%d.%m.%Y")


def location_closure_reason(loc: Optional[Location], day: Union[date, datetime]) -> Optional[str]:
    """None — филиал в этот день работает; иначе текст для человека."""
    if loc is None:
        return None
    # hasattr, а не isinstance: тесты подменяют класс datetime «замороженным»,
    # и isinstance на настоящем объекте тогда врёт.
    d = day.date() if hasattr(day, "hour") else day
    start, end = _parse(loc.open_from), _parse(loc.open_until)
    if start and d < start:
        return f"«{loc.name}» открывается {_ru(start)} — на более ранние даты бронь недоступна."
    if end and d > end:
        return (
            f"«{loc.name}» работает по {_ru(end)}. "
            "Unbox переезжает в новый центр UNBOX 99 (Парнаваз Мепе, 99) — выберите его."
        )
    return None


def closure_reason(session: Session, resource_id: str, day: Union[date, datetime]) -> Optional[str]:
    """То же по кабинету: находит его филиал и сверяет дату."""
    res = session.get(Resource, resource_id)
    if res is None:
        return None  # неизвестный кабинет отсекают другие проверки
    return location_closure_reason(session.get(Location, res.location_id), day)
