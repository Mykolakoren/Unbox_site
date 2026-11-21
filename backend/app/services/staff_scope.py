"""Кто из сотрудников что может менять на сайте.

Переезд 21.11.2026 (решение владельца): в новом центре UNBOX 99 администратор
один — Валентина. Елизавета и Егор до 30.11 работают в старых центрах как
обычно, но в UNBOX 99 чужие брони не трогают; с 01.12 у них «только просмотр».
Кабинет 1 в UNBOX 99 — практика владельца: он виден всем, но бронь там может
стоять только на людей из списка.

Три правила, все проверяет сервер:

1. Закреплённый кабинет — ``Resource.allowed_user_ids``. Проверка стоит в
   ``check_availability`` (через неё идёт любое создание, перенос и продление):
   бронь на человека не из списка не пройдёт, кто бы её ни ставил.
2. Администраторы филиала — ``Location.staff_ids``. Если список задан, чужие
   брони, блокировки и карточки кабинетов этого филиала меняют только владелец
   и люди из списка. Остальные администраторы там — как обычные клиенты.
3. «Только просмотр» — ``User.view_only_from``. С этой даты администратор видит
   админку, но менять может только своё: свои брони, профиль, свою Psy-CRM.

Правила 2 и 3 проверяет один «турникет» — ``write_refusal``. Он стоит на входе
всего API (api/staff_guard.py) и смотрит только на изменяющие запросы. Почему
не в каждой ручке: изменяющих ручек 134, многие проверяют лишь роль — в каждой
не допишешь и новую легко забыть. Турникет для «только просмотра» запрещает всё,
чего нет в коротком списке «своё», поэтому новая ручка по умолчанию закрыта.

Владельца правила 2 и 3 не касаются. Обычных клиентов и специалистов — тоже.
"""
import logging
import re
from datetime import date, datetime, timedelta, timezone
from typing import Iterable, Optional
from uuid import UUID

from sqlmodel import Session, select

from app.core.permissions import ADMIN_ROLES
from app.models.booking import Booking
from app.models.location import Location
from app.models.resource import Resource
from app.models.user import User

logger = logging.getLogger("unbox.staff_scope")

SAFE_METHODS = ("GET", "HEAD", "OPTIONS")

VIEW_ONLY_TEXT = (
    "У вас доступ только на просмотр. Менять можно свои брони и свой профиль; "
    "всё остальное на сайте делает действующий администратор."
)

# Запросы, которые только считают и ничего не записывают.
_READ_LIKE = {"/bookings/check-availability", "/bookings/recurring/quote", "/pricing/quote"}

# Действия с бронью, которые делает только администратор (не клиент над своей).
_ADMIN_BOOKING_ACTIONS = ("/price", "/bonus-hour", "/approve", "/reject",
                          "/add-extras", "/remove-extra", "/to-subscription")
# Действия со своей бронью, которые не трогают ни время, ни деньги.
_HARMLESS_OWN_ACTIONS = ("/link-client", "/dismiss-end-reminder")

LATE_TEXT = (
    "У вас доступ только на просмотр. Свою бронь на ближайшие сутки (или уже прошедшую) "
    "оформляет и меняет действующий администратор — напишите ему."
)

# Адреса сверяем целиком (fullmatch). Вместо «похоже на id» берём любой кусок
# пути и разбираем его так же, как ручка: сервер принимает id и без дефисов,
# и в фигурных скобках — узкий шаблон такой запрос пропускал мимо (ревизия 21.11).
_RE_BOOKING = re.compile(r"/bookings/([^/]+)(/[\w-]+)?")
_RE_SERIES = re.compile(r"/bookings/recurring/([^/]+)(/[\w-]+)?")
_RE_WAIVE = re.compile(r"/billing/bookings/([^/]+)/[\w-]+")
_RE_BLOCK = re.compile(r"/maintenance-blocks/([^/]+)")
_RE_BLOCK_GROUP = re.compile(r"/maintenance-blocks/group/([^/]+)")
_RE_RESOURCE = re.compile(r"/resources/([^/]+)")
_RE_LOCATION = re.compile(r"/locations/([^/]+)")
_RE_SPECIALIST = re.compile(r"/specialists/([^/]+)/(schedule|appointments)(/[^/]+)?")
_RE_WAITLIST_ENTRY = re.compile(r"/waitlist/([^/]+)")


def _as_uuid(value) -> Optional[UUID]:
    try:
        return UUID(str(value))
    except (ValueError, AttributeError, TypeError):
        return None


# «Своё» для режима «только просмотр» (кроме броней — они проверяются по хозяину).
_SELF_EXACT = {
    "/users/me", "/users/me/vacation", "/telegram/link-token",
    "/specialists/me", "/specialists/apply", "/upload", "/waitlist",
}
_SELF_PREFIXES = ("/auth/", "/notifications/", "/crm/")
_NOT_SELF_PREFIXES = ("/crm/access-requests/",)  # одобрение чужих заявок — работа админа


def now_tbilisi() -> datetime:
    from app.services.billing_defer import tbilisi_now
    return tbilisi_now()


def today_tbilisi() -> date:
    return now_tbilisi().date()


def is_view_only(user: Optional[User], today: Optional[date] = None) -> bool:
    """Администратор с наступившей датой «только просмотр». Владелец — никогда."""
    if user is None or user.role not in ADMIN_ROLES or user.role == "owner":
        return False
    raw = getattr(user, "view_only_from", None)
    if not raw:
        return False
    try:
        start = date.fromisoformat(str(raw).strip()[:10])
    except ValueError:
        # Дату вписывают в базу руками. Опечатка не должна молча снять
        # ограничение — считаем, что оно уже действует, и пишем в журнал.
        logger.error("view_only_from у %s не разобрать: %r — считаю «только просмотр»", user.email, raw)
        return True
    return (today or today_tbilisi()) >= start


# ── Правило 1: закреплённый кабинет ──────────────────────────────────────────

def room_access_reason(session: Session, resource_id: str, booking_owner_uuid) -> Optional[str]:
    """None — на этого человека бронь в кабинете ставить можно; иначе текст отказа."""
    room = session.get(Resource, resource_id)
    allowed = [str(x) for x in (getattr(room, "allowed_user_ids", None) or [])] if room else []
    if not allowed:
        return None
    if booking_owner_uuid is not None and str(booking_owner_uuid) in allowed:
        return None
    loc = session.get(Location, room.location_id)
    where = f" в «{loc.name}»" if loc else ""
    return (
        f"{room.name}{where} закреплён за специалистами центра и не сдаётся. "
        "Выберите другой кабинет."
    )


# ── Правило 2: администраторы филиала ────────────────────────────────────────

def _staff_names(session: Session, staff_ids: Iterable[str]) -> str:
    names = []
    for sid in staff_ids:
        key = _as_uuid(sid)
        u = session.get(User, key) if key else None
        if u is not None and u.name:
            names.append(u.name)
    return ", ".join(names)


def branch_refusal(session: Session, user: User, location_ids: Iterable[str]) -> Optional[str]:
    """Отказ, если филиал ведут другие администраторы. None — можно."""
    if user.role == "owner":
        return None
    me = str(user.id)
    for lid in {x for x in location_ids if x}:
        loc = session.get(Location, lid)
        staff = [str(x) for x in (getattr(loc, "staff_ids", None) or [])] if loc else []
        if staff and me not in staff:
            who = _staff_names(session, staff)
            who = f" ({who})" if who else ""
            return (
                f"В «{loc.name}» чужие брони и настройки кабинетов меняет только "
                f"администратор этого центра{who}. Свои брони здесь вы ставите как обычно."
            )
    return None


def _locations_of(session: Session, resource_ids: Iterable[str]) -> set:
    out = set()
    for rid in {x for x in resource_ids if x}:
        room = session.get(Resource, str(rid))
        if room is not None and room.location_id:
            out.add(room.location_id)
    return out


# ── Турникет ────────────────────────────────────────────────────────────────

def _booking_rows(session: Session, where) -> list:
    # Только колонки, не объекты: турникет не должен оставлять в сессии «снимок»
    # брони — ручки потом берут её с блокировкой строки и обязаны увидеть свежую.
    return list(session.exec(select(
        Booking.user_uuid, Booking.resource_id, Booking.user_id,
        Booking.date, Booking.start_time, Booking.status).where(where)).all())


def _is_mine(user: User, owner_uuid, owner_key) -> bool:
    """Бронь этого человека. У старых броней хозяин записан только почтой (user_id)."""
    if owner_uuid is not None:
        return str(owner_uuid) == str(user.id)
    key = str(owner_key or "").strip()
    return bool(key) and (key.lower() == str(user.id).lower() or key == (user.email or "").strip())


def _same_person(target, user: User) -> bool:
    # Почту сверяем точно, как ручки (User.email == target): в базе бывают
    # двойники, отличающиеся регистром.
    t = str(target or "").strip()
    return not t or t.lower() == str(user.id).lower() or t == (user.email or "").strip()


def _start_of(day, hhmm) -> Optional[datetime]:
    """Начало брони по Тбилиси (без пояса) из даты и «ЧЧ:ММ»; None — не разобрать."""
    try:
        if isinstance(day, datetime):
            d = day
        else:
            d = datetime.fromisoformat(str(day).strip().replace("Z", "+00:00"))
        if d.tzinfo is not None:
            d = (d.astimezone(timezone.utc) + timedelta(hours=4)).replace(tzinfo=None)
        h, m = str(hhmm).split(":")[:2]
        return d.replace(hour=int(h), minute=int(m), second=0, microsecond=0)
    except (ValueError, TypeError, AttributeError):
        return None


def _is_soon(start: Optional[datetime], now: datetime) -> bool:
    """Меньше суток до начала или уже началась/прошла."""
    return start is not None and start - now < timedelta(hours=24)


def _is_hot(start: Optional[datetime], now: datetime) -> bool:
    """Новая бронь попадает в «срочное» окно (клиенту её подтверждает админ) или в прошлое."""
    if start is None:
        return False
    if start <= now:
        return True
    from app.services.booking_policy import is_hot_start
    return is_hot_start(start, (now - timedelta(hours=4)).replace(tzinfo=timezone.utc))


class _Scope:
    """Что трогает запрос про брони."""
    def __init__(self, foreign: bool, rooms: set, late_own: bool = False):
        self.foreign, self.rooms, self.late_own = foreign, rooms, late_own


def _booking_scope(session: Session, user: User, path: str, body: dict, now: datetime) -> Optional[_Scope]:
    """Чьи брони и какие кабинеты трогает запрос. None — запрос не про брони.

    ``late_own`` — своя бронь, но на ближайшие сутки/в прошлом: у обычного клиента
    на это есть правила и штрафы, у администратора — послабления. В режиме
    «только просмотр» послаблений быть не должно, такие действия — через админа.
    """
    rooms = {body.get("resource_id"), body.get("new_resource_id")}
    slots = [x for x in (body.get("slots") or []) if isinstance(x, dict)]
    rooms |= {x.get("resource_id") for x in slots}
    rooms.discard(None)

    if path in ("/bookings", "/bookings/multi-slot", "/bookings/recurring"):
        starts = [_start_of(body.get("date") or body.get("first_date"), body.get("start_time"))]
        starts += [_start_of(x.get("date"), x.get("start_time")) for x in slots]
        return _Scope(not _same_person(body.get("target_user_id"), user), rooms,
                      late_own=any(_is_hot(st, now) for st in starts))

    m = _RE_SERIES.fullmatch(path)
    if m:
        rows = _booking_rows(session, Booking.recurring_group_id == m.group(1))
        action = m.group(2) or ""
        # Серия: прошедшие встречи не в счёт, важны только те, что вот-вот начнутся.
        late = any(st is not None and now < st and _is_soon(st, now)
                   for st in (_start_of(d, t) for _, _, _, d, t, status in rows
                              if status in ("confirmed", "pending_approval")))
    else:
        m = _RE_BOOKING.fullmatch(path) or _RE_WAIVE.fullmatch(path)
        if not m:
            return None
        key = _as_uuid(m.group(1))
        if key is None:
            return None  # это не id брони — ручка сама ответит «не найдено»
        rows = _booking_rows(session, Booking.id == key)
        action = (m.group(2) or "") if m.re is _RE_BOOKING else "/waive"
        late = any(_is_soon(_start_of(d, t), now) for _, _, _, d, t, _ in rows)
    foreign = any(not _is_mine(user, owner, key_) for owner, _, key_, _, _, _ in rows)
    rooms |= {rid for _, rid, _, _, _, _ in rows if rid}
    admin_action = action == "/waive" or action in _ADMIN_BOOKING_ACTIONS
    return _Scope(foreign or admin_action, rooms,
                  late_own=late and action not in _HARMLESS_OWN_ACTIONS)


def _own_specialist(session: Session, user: User, specialist_id: str) -> bool:
    try:
        from app.models.specialist import Specialist
        sp = session.get(Specialist, _as_uuid(specialist_id) or specialist_id)
        return sp is not None and str(getattr(sp, "user_id", "")) == str(user.id)
    except Exception:
        return False  # не смогли проверить — значит, не своё


def _is_self_service(session: Session, user: User, method: str, path: str) -> bool:
    if path in _SELF_EXACT:
        return True
    if path.startswith(_NOT_SELF_PREFIXES):
        return False
    if (path + "/").startswith(_SELF_PREFIXES):
        return True
    m = _RE_WAITLIST_ENTRY.fullmatch(path)
    if m and method == "DELETE":
        # Снять можно только свою запись в листе ожидания (ручка админу разрешает любую).
        from app.models.waitlist import Waitlist
        key = _as_uuid(m.group(1))
        row = session.exec(select(Waitlist.user_uuid, Waitlist.user_id).where(Waitlist.id == key)).first() if key else None
        return row is not None and _is_mine(user, row[0], row[1])
    m = _RE_SPECIALIST.fullmatch(path)
    if m:
        # Записаться на приём к специалисту может любой; расписание и отмена
        # записей — только у своей карточки специалиста.
        if m.group(2) == "appointments" and method == "POST":
            return True
        return _own_specialist(session, user, m.group(1))
    return False


def write_refusal(session: Session, user: Optional[User], method: str, path: str,
                  body: Optional[dict] = None, today: Optional[date] = None,
                  now: Optional[datetime] = None) -> Optional[str]:
    """Текст отказа для изменяющего запроса администратора или None, если можно.

    ``path`` — без префикса /api/v1. Владелец, клиенты и специалисты проходят всегда.
    """
    if method.upper() in SAFE_METHODS or user is None:
        return None
    if user.role not in ADMIN_ROLES or user.role == "owner":
        return None
    path = path.rstrip("/") or "/"
    if path in _READ_LIKE:
        return None
    body = body if isinstance(body, dict) else {}
    if now is None:  # ``today`` — для проверок: полдень этого дня
        now = datetime.combine(today, datetime.min.time()).replace(hour=12) if today else now_tbilisi()
    view_only = is_view_only(user, now.date())

    scope = _booking_scope(session, user, path, body, now)
    if scope is not None:
        if not scope.foreign:
            # своя бронь — как у любого клиента; в «только просмотре» без админских послаблений
            return LATE_TEXT if (view_only and scope.late_own) else None
        if view_only:
            return VIEW_ONLY_TEXT
        return branch_refusal(session, user, _locations_of(session, scope.rooms))

    if view_only and not _is_self_service(session, user, method.upper(), path):
        return VIEW_ONLY_TEXT

    # Блокировки кабинетов и карточки кабинетов/филиалов — тоже «по филиалу».
    locations: set = set()
    if path == "/maintenance-blocks":
        locations = _locations_of(session, [body.get("resource_id")])
    elif path == "/resources":
        locations = {body.get("location_id")} - {None}  # новый кабинет в чужом филиале
    else:
        m = _RE_BLOCK.fullmatch(path)
        mg = _RE_BLOCK_GROUP.fullmatch(path)
        mr = _RE_RESOURCE.fullmatch(path)
        ml = _RE_LOCATION.fullmatch(path)
        if mg:
            locations = _locations_of(session, [
                r[1] for r in _booking_rows(session, Booking.recurring_group_id == mg.group(1))])
        elif m:
            key = _as_uuid(m.group(1))
            locations = _locations_of(session, [
                r[1] for r in _booking_rows(session, Booking.id == key)]) if key else set()
        elif mr:
            locations = _locations_of(session, [mr.group(1)])
        elif ml:
            locations = {ml.group(1)}
    return branch_refusal(session, user, locations) if locations else None
