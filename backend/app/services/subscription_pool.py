"""Single source of truth for reading/writing ``user.subscription``.

``user.subscription`` is a free-form JSON blob passed verbatim between frontend
and backend — there is no serializer in between. The two sides ended up speaking
different dialects of it, and each one silently overwrote the other's:

* the frontend writes and reads camelCase (``remainingHours``, ``isFrozen``);
* the billing code writes and reads snake_case (``remaining_hours``) and used to
  *delete* the camel keys after every deduction.

That cost real money in both directions:

* an admin top-up wrote only ``remainingHours``, so ``billing_defer`` (snake-only)
  saw an empty pool, fell through to the cash fallback and charged the client's
  balance for hours they had already paid for;
* a deduction deleted ``remainingHours``, so the subscription card in the UI lost
  the remaining balance right after the first booking.

Read with :func:`get_float` / :func:`get`, write with :func:`update`. Both keep
the two dialects in sync, so neither side can starve the other. Legacy one-sided
pools are read correctly and repaired on the next write — no migration needed.
"""

from datetime import datetime
from typing import Any, Optional

# snake_case (backend) → camelCase (frontend). Every field either side writes.
_ALIASES: dict[str, str] = {
    "remaining_hours": "remainingHours",
    "used_hours": "usedHours",
    "total_hours": "totalHours",
    "bonus_hours": "bonusHours",
    "is_frozen": "isFrozen",
    "freeze_count": "freezeCount",
    "frozen_until": "frozenUntil",
    "frozen_at": "frozenAt",
    "expiry_date": "expiryDate",
    "plan_id": "planId",
    "free_reschedules": "freeReschedules",
    # Обещания тарифа (владелец 01.10, services/subscription_perks.py):
    # сколько бесплатных переносов позже суток уже потрачено.
    "free_reschedules_used": "freeReschedulesUsed",
    # Заморозка по тарифу (владелец 01.10): бюджет дней паузы на абонемент,
    # израсходовано, осталось (для экрана) и выдано на текущую паузу.
    "freeze_days_total": "freezeDaysTotal",
    "freeze_days_used": "freezeDaysUsed",
    "freeze_days_left": "freezeDaysLeft",
    "frozen_days_granted": "frozenDaysGranted",
    "included_formats": "includedFormats",
    "discount_percent": "discountPercent",
    # Особые условия клиента: абонемент без ограничения срока (owner-решение,
    # напр. Светлана Розова — «добивает часы вне рамок сроков»). Такой пул
    # никогда не истекает и не переходит в «завершён».
    "flexible": "flexible",
    # Жизненный цикл: active | frozen | completed. Стамп ставит крон/ревизор;
    # РЕАЛЬНЫЙ гейт денег — is_active(), считается вживую, а не по этому полю.
    "status": "status",
    # Недельный пакет (29.09, weekly_package.py): фикс. цена за N часов в неделю.
    "weekly_package": "weeklyPackage",
    "weekly_hours": "weeklyHours",
    "weekly_price": "weeklyPrice",
    "package_week": "packageWeek",
    # Доп. пул (владелец 01.10, шаг 4): часы капсулы (Пробный 1, Тёплый 4,
    # Регулярный 6, Профи+ 10) или «4 ч индивидуально» Группового мастера.
    # extra_kind: 'capsule' | 'individual'. Остаток + израсходовано = всего.
    "extra_hours_total": "extraHoursTotal",
    "extra_hours_remaining": "extraHoursRemaining",
    "extra_hours_used": "extraHoursUsed",
    "extra_kind": "extraKind",
}

EXTRA_CAPSULE = "capsule"
EXTRA_INDIVIDUAL = "individual"
_EPS = 1e-9


def get(sub: Optional[dict], field: str, default: Any = None) -> Any:
    """Read ``field`` (snake_case) from the pool, whichever dialect wrote it."""
    if not sub:
        return default
    for key in (field, _ALIASES.get(field, field)):
        value = sub.get(key)
        if value is not None:
            return value
    return default


def get_float(sub: Optional[dict], field: str, default: float = 0.0) -> float:
    """Read a numeric pool field as float, tolerating None/"" /bad values."""
    try:
        return float(get(sub, field, default) or default)
    except (TypeError, ValueError):
        return default


def update(sub: Optional[dict], **fields: Any) -> dict:
    """Copy ``sub`` with ``fields`` (snake_case) written in BOTH dialects."""
    new = dict(sub or {})
    for field, value in fields.items():
        new[field] = value
        new[_ALIASES.get(field, field)] = value
    return new


# ── Движение часов ───────────────────────────────────────────────────────────
# ЕДИНСТВЕННОЕ место, где меняются remaining_hours / used_hours. Раньше каждое
# из ~18 мест (бронь, крон T-24ч, отмена, перенос, вырезка, сокращение, смена
# формата/цены, подтверждение, Telegram, пополнение, продажа) писало пул руками
# — и правило «вернуть ровно туда, откуда сняли» пришлось бы чинить в каждом.
# Сторож guard_hours_pool_moves запрещает прямые записи вне этого файла.

#
# Доп. пул (extra) — часы капсулы или «4 ч индивидуально» Группового мастера.
# Порядок списания (владелец 01.10):
#   капсула           — сначала часы капсулы, потом основной пул час за час,
#                       потом деньги;
#   Групповой мастер  — индивидуальная бронь в КАБИНЕТЕ: сначала «4 ч
#                       индивидуально», потом деньги (его основной пул — только
#                       группы).
# Одна бронь может взять часть из доп. пула, часть из основного: сначала доп.
# до нуля, остаток из основного. В брони хранится hours_deducted (всего часов
# абонемента) и extra_hours_deducted (из них доп.). Возврат — РОВНО туда же.
# Если бронь ни из доп., ни из основного целиком не покрывается — она вся
# деньгами (как и раньше с основным пулом: частичного «часы + деньги» нет).

def _clamp_extra(hours: float, extra: Optional[float]) -> float:
    h = float(hours or 0)
    return max(0.0, min(float(extra or 0), h)) if h > 0 else 0.0


def extra_kind(sub: Optional[dict]) -> Optional[str]:
    kind = get(sub, "extra_kind")
    return kind if kind in (EXTRA_CAPSULE, EXTRA_INDIVIDUAL) else None


def extra_remaining(sub: Optional[dict]) -> float:
    return max(0.0, get_float(sub, "extra_hours_remaining")) if extra_kind(sub) else 0.0


def kind_for_resource(resource_type: Optional[str]) -> str:
    """Какой доп. пул «подходит» брони по типу помещения: капсула → часы
    капсулы, кабинет → «индивидуально»."""
    return EXTRA_CAPSULE if (resource_type or "") == "capsule" else EXTRA_INDIVIDUAL


def extra_applies(sub: Optional[dict], resource_type: Optional[str], format_type: Optional[str]) -> bool:
    """Может ли доп. пул абонемента платить за такую бронь.

    Часы капсулы — только капсула (любой формат). «4 ч индивидуально» — только
    кабинет и только индивидуальный формат (не группы и не капсула).
    """
    kind = extra_kind(sub)
    if kind == EXTRA_CAPSULE:
        return (resource_type or "") == "capsule"
    if kind == EXTRA_INDIVIDUAL:
        return (resource_type or "") != "capsule" and (format_type or "individual") == "individual"
    return False


def plan_split(sub: Optional[dict], hours: float, *, resource_type: Optional[str],
               format_type: Optional[str]) -> Optional[float]:
    """Покрывает ли абонемент бронь ``hours`` часов ЦЕЛИКОМ и сколько из них
    взять из доп. пула. None — не покрывает (бронь пойдёт деньгами).

    Статус (пауза/срок) НЕ проверяет — это гейт вызывающего (is_active).
    Без доп. пула — ровно прежнее правило: формат в тарифе и остаток ≥ часов
    (с запасом 0.01 на float).
    """
    h = float(hours or 0)
    x = min(extra_remaining(sub), h) if extra_applies(sub, resource_type, format_type) else 0.0
    x = round(max(0.0, x), 4)
    main_need = h - x
    if x > 0 and main_need <= _EPS:
        return x
    included = get(sub, "included_formats", ["individual"]) or ["individual"]
    if (format_type or "individual") not in included:
        return None
    if get_float(sub, "remaining_hours") >= main_need - 0.01:
        return x
    return None


def live_extra(sub: Optional[dict], hours: float, *, resource_type: Optional[str],
               format_type: Optional[str]) -> float:
    """Сколько из ``hours`` взять из доп. пула прямо сейчас (без проверки
    покрытия основного пула) — для мест, которые списывают безусловно
    (подтверждение горячей брони)."""
    if not extra_applies(sub, resource_type, format_type):
        return 0.0
    return round(min(extra_remaining(sub), float(hours or 0)), 4)


def debit_hours(sub: Optional[dict], hours: float, extra: float = 0.0) -> dict:
    """Списать ``hours`` часов абонемента, из них ``extra`` — из доп. пула.

    Основной пул: остаток −(hours−extra) (не ниже 0), израсходовано +(hours−extra).
    Доп. пул: остаток −extra (не ниже 0), израсходовано +extra.
    """
    h = float(hours or 0)
    x = _clamp_extra(h, extra)
    if x > 0 and not extra_kind(sub):
        x = 0.0  # доп. пула нет — защитно всё из основного (так быть не должно)
    m = h - x
    rem = get_float(sub, "remaining_hours")
    used = get_float(sub, "used_hours")
    fields: dict = {"remaining_hours": max(0.0, rem - m), "used_hours": used + m}
    if x > 0:
        er = get_float(sub, "extra_hours_remaining")
        eu = get_float(sub, "extra_hours_used")
        fields.update(extra_hours_remaining=round(max(0.0, er - x), 4),
                      extra_hours_used=round(eu + x, 4))
    return update(sub, **fields)


def credit_hours(sub: Optional[dict], hours: float, extra: float = 0.0,
                 kind: Optional[str] = None) -> dict:
    """Вернуть ``hours`` часов в пул, из них ``extra`` — в доп. пул.

    Основной: остаток +(hours−extra), израсходовано −(hours−extra) (не ниже 0).
    ``hours`` может быть отрицательным (ручная цена абонементной брони выше
    прежней — легаси-поведение set_booking_price).

    Доп.: остаток +extra, израсходовано −extra (не ниже 0). ``kind`` — вид
    доп. пула, из которого часы снимались ('capsule' | 'individual'). Если у
    ТЕКУЩЕГО абонемента доп. пула такого вида нет (бронь из прошлого
    абонемента, а купили тариф без него / с другим) — часы возвращаются в
    основной пул: клиент их оплатил и не теряет. Если возврат поднимает
    остаток выше «всего» (бронь из прошлого абонемента того же вида) — «всего»
    растёт, чтобы остаток + израсходовано = всего.
    """
    h = float(hours or 0)
    x = _clamp_extra(h, extra)
    cur_kind = extra_kind(sub)
    to_extra = x > 0 and cur_kind is not None and (kind is None or kind == cur_kind)
    m = h - (x if to_extra else 0.0)
    rem = get_float(sub, "remaining_hours")
    used = get_float(sub, "used_hours")
    fields: dict = {"remaining_hours": rem + m, "used_hours": max(0.0, used - m)}
    if to_extra:
        er = get_float(sub, "extra_hours_remaining") + x
        eu = max(0.0, get_float(sub, "extra_hours_used") - x)
        total = get_float(sub, "extra_hours_total")
        fields.update(extra_hours_remaining=round(er, 4), extra_hours_used=round(eu, 4))
        if er + eu > total + _EPS:
            fields["extra_hours_total"] = round(er + eu, 4)
    return update(sub, **fields)


def pool_label(hours: Optional[float], extra: Optional[float]) -> Optional[str]:
    """Ярлык брони: 'main' | 'extra' | 'mixed' (None — часов абонемента нет)."""
    h = float(hours or 0)
    if h <= 0:
        return None
    x = _clamp_extra(h, extra)
    if x <= _EPS:
        return "main"
    if x >= h - _EPS:
        return "extra"
    return "mixed"


def stamp_booking(booking: Any, hours: Optional[float], extra: Optional[float]) -> None:
    """Записать в бронь, сколько часов абонемента и из какого пула."""
    h = float(hours or 0)
    x = _clamp_extra(h, extra)
    booking.hours_pool = pool_label(h, x)
    booking.extra_hours_deducted = round(x, 4) if x > 0 else (0.0 if h > 0 else None)


def booking_extra(booking: Any) -> float:
    """Сколько часов брони списано из доп. пула (старые брони — 0)."""
    return _clamp_extra(float(getattr(booking, "hours_deducted", 0) or 0),
                        getattr(booking, "extra_hours_deducted", 0))


def extra_fields(kind: Optional[str], total: float) -> dict:
    """Поля доп. пула нового абонемента (пусто, если у тарифа его нет)."""
    if kind not in (EXTRA_CAPSULE, EXTRA_INDIVIDUAL) or float(total or 0) <= 0:
        return {}
    t = round(float(total), 4)
    return {"extra_kind": kind, "extra_hours_total": t, "extra_hours_remaining": t,
            "extra_hours_used": 0.0}


def grant_hours(sub: Optional[dict], hours: float) -> dict:
    """Пополнение пула админом: остаток и «всего» +hours (израсходовано не трогаем)."""
    h = float(hours or 0)
    rem = get_float(sub, "remaining_hours")
    total = get_float(sub, "total_hours")
    return update(sub, remaining_hours=round(rem + h, 2), total_hours=round(total + h, 2))


def grant_extra_hours(sub: Optional[dict], hours: float, kind: Optional[str] = None) -> dict:
    """Пополнение доп. пула админом: остаток и «всего» +hours. Если у абонемента
    доп. пула нет, заводим его вида ``kind`` (по умолчанию — капсула)."""
    h = float(hours or 0)
    cur = extra_kind(sub)
    if cur is None:
        return update(sub, **extra_fields(kind or EXTRA_CAPSULE, h))
    er = get_float(sub, "extra_hours_remaining")
    et = get_float(sub, "extra_hours_total")
    return update(sub, extra_hours_remaining=round(er + h, 4), extra_hours_total=round(et + h, 4))


def pool_fields(total: float, bonus: float = 0.0, used: float = 0.0) -> dict:
    """Поля нового пула (snake_case; запишет update): всего, бонус, остаток, израсходовано."""
    total, bonus, used = float(total), float(bonus), float(used)
    return {
        "total_hours": total,
        "bonus_hours": bonus,
        "remaining_hours": round(max(0.0, total + bonus - used), 2),
        "used_hours": used,
    }


def sync(sub: Optional[dict]) -> dict:
    """Mirror every known field into both dialects — repairs legacy one-sided pools."""
    new = dict(sub or {})
    for snake, camel in _ALIASES.items():
        if snake in new and camel not in new:
            new[camel] = new[snake]
        elif camel in new and snake not in new:
            new[snake] = new[camel]
    return new


# ── Жизненный цикл абонемента ────────────────────────────────────────────────
# Единый источник правды: истёк / на паузе / активен. И движок цен, и статус-
# стамп спрашивают отсюда, чтобы правило не разъехалось по файлам (ровно так
# рождались прошлые денежные баги).

def _parse_dt(value: Any) -> Optional[datetime]:
    """ISO-строка (в т.ч. с Z) → naive datetime. None на мусоре — не роняем цену."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).replace(tzinfo=None)
    except (ValueError, TypeError):
        return None


def hours_return_allowed(sub: Optional[dict], booking_date: Any) -> bool:
    """Можно ли вернуть часы брони обратно в пул.

    Для недельного пакета — только если бронь из ТЕКУЩЕЙ недели пакета: пул
    каждую неделю выдаётся заново, и часы отменённой брони прошлой недели иначе
    попали бы в пул новой недели (лишние часы сверх оплаченных). Неиспользованные
    часы недели сгорают — это суть пакета. Для обычных абонементов — всегда да.
    """
    if not get(sub, "weekly_package", False):
        return True
    pw = get(sub, "package_week")
    if not pw or booking_date is None:
        return True
    d = booking_date.date() if isinstance(booking_date, datetime) else booking_date
    try:
        from datetime import timedelta as _td
        return (d - _td(days=d.weekday())).isoformat() == str(pw)
    except Exception:
        return True


def is_flexible(sub: Optional[dict]) -> bool:
    """Особые условия: пул без ограничения срока (owner-решение по клиенту)."""
    return bool(get(sub, "flexible", False))


def is_expired(sub: Optional[dict], now: datetime) -> bool:
    """Срок действия закончился (с учётом пауз и особых условий).

    - flexible → никогда не истекает (Светлана: часы вне рамок сроков).
    - на паузе → не истёк (часы заблокированы, но клиент своё время не теряет).
      Срок продлевается на длительность паузы в момент разморозки, поэтому
      здесь достаточно сравнить now с expiry_date.
    - нет expiry_date → легаси-пул без срока, не истекает.
    """
    if not sub or is_flexible(sub):
        return False
    if get(sub, "is_frozen", False):
        return False
    expiry = _parse_dt(get(sub, "expiry_date"))
    if expiry is None:
        return False
    return now > expiry


def is_active(sub: Optional[dict], now: datetime) -> bool:
    """Может ли абонемент СЕЙЧАС покрыть бронь.

    Существует, не на паузе, не истёк. Остаток часов проверяется отдельно
    в _apply_subscription — тут только про статус пула, не про баланс часов.
    """
    if not sub:
        return False
    if get(sub, "is_frozen", False):
        return False
    if is_expired(sub, now):
        return False
    return True


def lifecycle_status(sub: Optional[dict], now: datetime) -> str:
    """active | frozen | completed | none — для отображения и стампа."""
    if not sub:
        return "none"
    if get(sub, "is_frozen", False):
        return "frozen"
    if is_expired(sub, now):
        return "completed"
    return "active"
