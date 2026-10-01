#!/usr/bin/env python3
"""Разовая чистка CRM владельца (koren.nikolas@gmail.com) — решения от 01.10.2026.

Что делает (по умолчанию — ТОЛЬКО печатает план, ничего не меняет):

  1. «Елена и Иван» (#6760): удалить неотменённые сессии в 18:00 по Тбилиси без
     google_event_id (ожидается 9 штук). Сессию с платежом / заметкой / бронью
     не трогаем. Отдельно — что остаётся и что сейчас в Google с 01.09 по 31.12.
  2. Склейка «Алена» (#1196) → «Алена грум» (#4740) штатной функцией
     merge_clients (crm/clients.py). Затем у пар-дублей на одно время
     оставляем сессию с google_event_id, переносим на неё бронь / серию / цену /
     оплаты / заметки, вторую удаляем (без Google и без отмены брони). После
     commit — переименовать события в Google в «Алена грум #4740»
     (patch_event_summary).
  3. «Николай Горячев» (#6354): сессия 03.10 14:00 без события → удалить
     сессию и отменить бронь кабинета (unbox_uni_room_5, 0 ₾).
  4. «Александр» (#2109): сессии 14:00 без google_event_id на 10 датах →
     удалить и отменить брони (unbox_uni_room_7, 0 ₾), но только если в Google
     нет события этого клиента в тот же день ±3 ч.

Отмена брони — по образцу DELETE /bookings/{id} (bookings/routes.py
cancel_booking): status=cancelled, cancelled_by='owner-cleanup', причина,
штатный _refund_booking_to_owner (у этих броней 0 ₾ — должен ничего не
вернуть, иначе вся транзакция откатывается), отвязка CRM-сессий; после commit —
удаление события кабинетного календаря, лист ожидания, запись в timeline.
Бронь с деньгами (цена / списание / часы / записи в balance_ledger) НЕ
отменяется — попадает в отчёт.

  --include-other-pairs : пары-дубли Алены на другие даты (нашлись июльские)
            разбирать тем же правилом; без флага они только в отчёте.
  --apply : бэкап затронутых строк в /root/backups/cleanup_owner_crm_<ts>.json,
            все изменения БД — одной транзакцией, Google — только после commit.
Повторный запуск ничего не делает (всё ищется по текущему состоянию; недоделанные
Google-шаги — удаление кабинетных событий и переименование — добиваются).

Запуск на сервере:
  cd /var/www/unbox/backend && PYTHONPATH=. venv/bin/python3 scripts/cleanup_owner_crm_2026_10.py
  cd /var/www/unbox/backend && PYTHONPATH=. venv/bin/python3 scripts/cleanup_owner_crm_2026_10.py --apply
"""
import sys
import os
import json
import argparse
from datetime import datetime, timedelta
from uuid import UUID

sys.path.insert(0, "/var/www/unbox/backend")

from sqlalchemy import text, func  # noqa: E402
from sqlmodel import Session, select  # noqa: E402

from app.db.session import engine  # noqa: E402
from app.models.user import User  # noqa: E402
from app.models.booking import Booking  # noqa: E402
from app.models.balance_ledger import BalanceLedger  # noqa: E402
from app.models.therapist_client import TherapistClient  # noqa: E402
from app.models.therapy_session import TherapySession  # noqa: E402
from app.models.therapist_payment import TherapistPayment  # noqa: E402
from app.models.therapist_note import TherapistNote  # noqa: E402
from app.api.v1.crm import get_crm_calendar_id  # noqa: E402
from app.services.crm_calendar import (  # noqa: E402
    _get_events, _parse_event_dt, _extract_alias_code, _norm_client_name,
    patch_event_summary, _get_calendar_service,
)

OWNER_EMAIL = "koren.nikolas@gmail.com"
TB = timedelta(hours=4)  # Тбилиси = UTC+4 круглый год; сессии в БД — UTC-naive
CANCELLED = ("CANCELLED_CLIENT", "CANCELLED_THERAPIST")
CLEANUP_TAG = "owner-cleanup"
CANCEL_REASON = "Разовая чистка CRM владельца 01.10.2026: сессия-дубль без события в календаре"
BACKUP_DIR = "/root/backups"

# 1. Елена и Иван
ELENA_ID = "34652f8c-919a-4c9a-b5f7-5e15bde131b7"
ELENA_ALIAS = "6760"
ELENA_EXPECTED = [  # дата (Тбилиси), 18:00
    (2026, 9, 16), (2026, 9, 30), (2026, 10, 7), (2026, 10, 14), (2026, 10, 21),
    (2026, 10, 28), (2026, 11, 4), (2026, 11, 11), (2026, 11, 18),
]
# 2. Алена → Алена грум
ALENA_SRC_ALIAS, ALENA_SRC_NAME = "1196", "Алена"
ALENA_DST_ALIAS, ALENA_DST_NAME = "4740", "Алена грум"
ALENA_SUMMARY = f"{ALENA_DST_NAME} #{ALENA_DST_ALIAS}"
ALENA_DUP_EXPECTED = [(2026, 10, 16), (2026, 10, 23), (2026, 10, 30), (2026, 11, 6), (2026, 11, 13)]  # 18:00
# 3. Николай Горячев
GOR_ALIAS = "6354"
GOR_TARGETS = [((2026, 10, 3), "14:00", "unbox_uni_room_5")]
# 4. Александр
ALEX_ALIAS = "2109"
ALEX_TARGETS = [
    ((y, m, d), "14:00", "unbox_uni_room_7")
    for (y, m, d) in [
        (2026, 11, 17), (2026, 12, 1), (2026, 12, 15), (2026, 12, 29), (2027, 1, 12),
        (2027, 1, 26), (2027, 2, 9), (2027, 2, 23), (2027, 3, 9), (2027, 3, 23),
    ]
]

HOLD = []  # (раздел, что, почему) — всё, что скрипт решил НЕ трогать
INCLUDE_OTHER_PAIRS = False  # --include-other-pairs: разбирать пары Алены и вне списка владельца


# ─── helpers ────────────────────────────────────────────────────────────────

def tb_to_utc(ymd, hhmm):
    h, m = (int(x) for x in hhmm.split(":"))
    return datetime(ymd[0], ymd[1], ymd[2], h, m) - TB


def fmt(dt_utc):
    return (dt_utc + TB).strftime("%d.%m.%Y %H:%M") if dt_utc else "—"


def hold(section, what, why):
    HOLD.append((section, what, why))
    print(f"    [НЕ ТРОГАЮ]: {why}")


def sess_line(ts):
    return (f"{fmt(ts.date)} Тб | {ts.status:<10} | gid={ts.google_event_id or '—'} | "
            f"price={ts.price} paid={ts.is_paid} booking={ts.booking_id or '—'} | id={ts.id}")


def ev_line(ev):
    st = _parse_event_dt(ev.get("start") or {})
    return f"{fmt(st)} Тб | {ev.get('status', ''):<9} | {ev.get('summary')!r} | id={ev['id']}"


def session_blockers(db, ts, client_id=None):
    """Платёж / заметка / бронь у сессии — повод НЕ удалять."""
    why = []
    pays = db.exec(select(TherapistPayment).where(TherapistPayment.session_id == ts.id)).all()
    if pays:
        why.append(f"платёж: {', '.join(f'{p.amount} {p.currency}' for p in pays)}")
    if ts.is_paid:
        why.append("помечена оплаченной (is_paid)")
    notes = db.exec(select(TherapistNote).where(TherapistNote.session_id == ts.id)).all()
    if notes:
        why.append(f"заметок (TherapistNote): {len(notes)}")
    if (ts.notes or "").strip():
        why.append("непустое поле notes у сессии")
    if ts.booking_id:
        why.append(f"привязана бронь {ts.booking_id}")
    if client_id:
        loc = ts.date + TB
        bks = db.exec(select(Booking).where(
            Booking.crm_client_id == client_id, Booking.status != "cancelled",
            func.date(Booking.date) == loc.date(), Booking.start_time == loc.strftime("%H:%M"),
        )).all()
        if bks:
            why.append(f"на это время есть бронь клиента: {', '.join(str(b.id) for b in bks)}")
    return why


def booking_money(db, b):
    """Есть ли у брони деньги/часы. Пустой список = денег нет."""
    why = []
    if (b.final_price or 0) > 0:
        why.append(f"final_price={b.final_price}")
    if (b.charge_amount or 0) > 0:
        why.append(f"charge_amount={b.charge_amount}")
    if (b.hours_deducted or 0) > 0:
        why.append(f"hours_deducted={b.hours_deducted} ({b.payment_method})")
    led = db.exec(select(BalanceLedger).where(BalanceLedger.ref_id == str(b.id))).all()
    s = round(sum(float(x.delta or 0) for x in led), 2)
    if s != 0:
        why.append(f"в balance_ledger по брони {s} ₾ ({len(led)} записей)")
    return why


def booking_line(b):
    return (f"бронь {b.id}: {b.resource_id} {b.date.strftime('%d.%m.%Y')} {b.start_time} "
            f"{b.duration}мин | status={b.status} | final_price={b.final_price} "
            f"charge_amount={b.charge_amount} payment_status={b.payment_status} "
            f"method={b.payment_method} hours={b.hours_deducted} | кабинетное событие={b.gcal_event_id or '—'}")


def get_booking(db, bid, lock=False):
    try:
        u = UUID(str(bid))
    except ValueError:
        return None
    q = select(Booking).where(Booking.id == u)
    if lock:
        q = q.with_for_update()
    return db.exec(q).first()


def client_by_alias(db, uid, alias, name=None):
    q = select(TherapistClient).where(TherapistClient.specialist_id == uid, TherapistClient.alias_code == alias)
    rows = db.exec(q).all()
    if name:
        rows = [c for c in rows if c.name.strip() == name]
    if len(rows) > 1:
        raise SystemExit(f"Неоднозначно: {len(rows)} клиентов с #{alias}")
    return rows[0] if rows else None


# ─── план ───────────────────────────────────────────────────────────────────

def plan_elena(db, uid, cal_id, events_all):
    print("\n" + "=" * 100)
    print("1. «Елена и Иван» (#6760) — удалить сессии 18:00 без события в календаре")
    print("=" * 100)
    plan = {"delete": []}
    c = db.get(TherapistClient, ELENA_ID)
    if not c or c.specialist_id != uid:
        print("  клиент не найден у владельца — пропускаю")
        return plan
    print(f"  клиент: {c.name!r} #{c.alias_code} id={c.id}")
    expected = {tb_to_utc(d, "18:00") for d in ELENA_EXPECTED}
    rows = db.exec(select(TherapySession).where(
        TherapySession.client_id == c.id, TherapySession.specialist_id == uid,
        TherapySession.google_event_id.is_(None),  # type: ignore
        TherapySession.status.not_in(CANCELLED),  # type: ignore
    ).order_by(TherapySession.date)).all()
    cand = [ts for ts in rows if (ts.date + TB).strftime("%H:%M") == "18:00"]
    print(f"  кандидатов (18:00, без gid, не отменены): {len(cand)}")
    for ts in cand:
        print("   • " + sess_line(ts))
        if ts.date not in expected:
            why = session_blockers(db, ts, c.id)
            hold("1. Елена и Иван", sess_line(ts),
                 "дата не из списка владельца" + (f"; к тому же: {'; '.join(why)}" if why else ""))
            continue
        why = session_blockers(db, ts, c.id)
        if why:
            hold("1. Елена и Иван", sess_line(ts), "; ".join(why))
            continue
        print("    → УДАЛИТЬ сессию (Google не трогаем — события у неё нет)")
        plan["delete"].append(ts.id)
    found = {ts.date for ts in cand}
    for d in sorted(expected - found):
        print(f"   • {fmt(d)} — в списке владельца, но такой сессии уже нет (удалена ранее?)")
    print(f"  ИТОГО к удалению: {len(plan['delete'])} (владелец ожидал 9)")

    # Что остаётся
    start = datetime(2026, 9, 1) - TB
    rest = db.exec(select(TherapySession).where(
        TherapySession.client_id == c.id, TherapySession.specialist_id == uid,
        TherapySession.date >= start,
    ).order_by(TherapySession.date)).all()
    rest = [ts for ts in rest if ts.id not in plan["delete"]]
    print(f"\n  Останется сессий этого клиента с 01.09: {len(rest)}")
    for ts in rest:
        print("   · " + sess_line(ts))

    # Google 01.09–31.12
    lo, hi = datetime(2026, 9, 1) - TB, datetime(2027, 1, 1) - TB
    evs = []
    for ev in events_all:
        st = _parse_event_dt(ev.get("start") or {})
        if not st or not (lo <= st < hi):
            continue
        sm = ev.get("summary") or ""
        if _extract_alias_code(sm) == ELENA_ALIAS or _norm_client_name(sm) == _norm_client_name(c.name):
            evs.append((st, ev))
    print(f"\n  Google-календарь по этому клиенту 01.09–31.12: {len(evs)} событий")
    for st, ev in evs:
        print("   ◦ " + ev_line(ev))
    live = [(st, ev) for st, ev in evs if ev.get("status") != "cancelled"]
    gids_live = {ev["id"] for _, ev in live}
    by_gid = {ts.google_event_id: ts for ts in rest if ts.google_event_id}

    s1940 = [ts for ts in rest if (ts.date + TB).strftime("%H:%M") == "19:40"]
    print(f"\n  Сессий на 19:40 в CRM: {len(s1940)}"
          + ("" if s1940 else " — нечего снимать автосинку"))
    for ts in s1940:
        print("   · " + sess_line(ts))
    ev1900 = [(st, ev) for st, ev in live if (st + TB).strftime("%H:%M") == "19:00" and (st + TB).date() > datetime(2026, 10, 7).date()]
    print(f"  Живых событий 19:00 после 07.10 (до 31.12): {len(ev1900)} — "
          + ", ".join((st + TB).strftime("%d.%m") for st, _ in ev1900))
    ev0710 = [(st, ev) for st, ev in live if (st + TB).strftime("%d.%m %H:%M") == "07.10 19:00"]
    if ev0710:
        print(f"  Событие 07.10 19:00 в Google есть: {ev0710[0][1]['id']}")
    no_sess = [(st, ev) for st, ev in live if ev["id"] not in by_gid]
    if no_sess:
        print("  Живые события БЕЗ сессии в CRM (автосинк их создаст, если в окне синка):")
        for st, ev in no_sess:
            other = db.exec(select(TherapySession).where(TherapySession.google_event_id == ev["id"])).first()
            extra = f" — но gid уже занят сессией {other.id} клиента {other.client_id}" if other else ""
            print("   ◦ " + ev_line(ev) + extra)
    dead = [ts for ts in rest if ts.google_event_id and ts.google_event_id not in gids_live
            and lo <= ts.date < hi]
    if dead:
        print("  Сессии, чьё событие удалено/отменено в Google (автосинк снимет, если в его окне):")
        for ts in dead:
            print("   · " + sess_line(ts))
    return plan


def plan_alena(db, uid, cal_id, events_all, owner):
    print("\n" + "=" * 100)
    print("2. Склейка «Алена» (#1196) → «Алена грум» (#4740)")
    print("=" * 100)
    plan = {"merge": None, "pairs": [], "rename_master": [], "rename_instances": []}
    dst = client_by_alias(db, uid, ALENA_DST_ALIAS, ALENA_DST_NAME)
    if not dst:
        print("  «Алена грум» #4740 не найдена — раздел пропущен")
        HOLD.append(("2. Алена", "клиент-цель", "«Алена грум» #4740 не найдена"))
        return plan
    src = client_by_alias(db, uid, ALENA_SRC_ALIAS, ALENA_SRC_NAME)
    print(f"  цель:     {dst.name!r} #{dst.alias_code} id={dst.id} merged={dst.merged_alias_codes} base_price={dst.base_price}")
    if src:
        n_s = db.exec(select(func.count()).select_from(TherapySession).where(TherapySession.client_id == src.id)).one()
        pays = db.exec(select(TherapistPayment).where(TherapistPayment.client_id == src.id)).all()
        n_n = db.exec(select(func.count()).select_from(TherapistNote).where(TherapistNote.client_id == src.id)).one()
        n_b = db.exec(select(func.count()).select_from(Booking).where(Booking.crm_client_id == src.id)).one()
        print(f"  источник: {src.name!r} #{src.alias_code} id={src.id}: сессий {n_s}, платежей {len(pays)}, "
              f"заметок {n_n}, броней с crm_client_id {n_b}")
        zero = [p for p in pays if not p.amount or float(p.amount) <= 0]
        print(f"  → СКЛЕИТЬ штатной merge_clients: сессии/платежи/заметки → цель, "
              f"merged_alias_codes += {sorted(set((dst.merged_alias_codes or []) + [dst.alias_code, src.alias_code]))}, "
              f"карточку «{src.name}» удалить"
              + (f"; 0-₾ платежей будет удалено функцией: {len(zero)}" if zero else ""))
        if n_b:
            print(f"    ! у {n_b} броней crm_client_id указывает на источник — merge_clients их не переносит (так устроена функция)")
        plan["merge"] = {"target_id": dst.id, "source_id": src.id}
        client_ids = [dst.id, src.id]
    else:
        print("  источник «Алена» #1196 уже не существует — склейка уже сделана")
        client_ids = [dst.id]

    rows = db.exec(select(TherapySession).where(
        TherapySession.client_id.in_(client_ids), TherapySession.specialist_id == uid,  # type: ignore
        TherapySession.status.not_in(CANCELLED),  # type: ignore
    ).order_by(TherapySession.date)).all()
    groups = {}
    for ts in rows:
        groups.setdefault(ts.date, []).append(ts)
    dup_groups = {d: g for d, g in groups.items() if len(g) > 1}
    expected = {tb_to_utc(d, "18:00") for d in ALENA_DUP_EXPECTED}
    print(f"\n  Пар-дублей (одно время, после склейки — один клиент): {len(dup_groups)}")
    for d, g in sorted(dup_groups.items()):
        print(f"   • {fmt(d)}:")
        for ts in g:
            print(f"       - [{'Алена' if src and ts.client_id == src.id else 'Алена грум'}] " + sess_line(ts))
        with_gid = [t for t in g if t.google_event_id]
        no_gid = [t for t in g if not t.google_event_id]
        if len(g) != 2 or len(with_gid) != 1 or len(no_gid) != 1:
            hold("2. Алена", f"{fmt(d)} ({len(g)} сессий)", "не ровно пара «с событием + без события»")
            continue
        keep, dup = with_gid[0], no_gid[0]
        if keep.booking_id and dup.booking_id and keep.booking_id != dup.booking_id:
            hold("2. Алена", f"{fmt(d)}", "брони у обеих сессий — не понятно, какую оставить")
            continue
        if d not in expected and not INCLUDE_OTHER_PAIRS:
            debt = ""
            if keep.status == "COMPLETED" and keep.price is None and not keep.is_paid and (dst.base_price or 0) > 0:
                debt = (f" ВНИМАНИЕ: после склейки сессия {keep.id} (без цены, не оплачена) возьмёт "
                        f"базовую цену «{dst.name}» {dst.base_price} ₾ и покажется долгом.")
            hold("2. Алена", f"пара {fmt(d)} (оставить {keep.id}, удалить {dup.id})",
                 "даты нет в списке владельца (16.10–13.11) — нужен его ответ; "
                 "тем же правилом её разберёт запуск с --include-other-pairs." + debt)
            continue
        if d not in expected:
            print("       ! этой даты не было в списке владельца, но пара однозначная (--include-other-pairs)")
        moves = []
        if not keep.booking_id and dup.booking_id:
            moves.append(f"booking_id={dup.booking_id} (is_booked=True)")
        if not keep.recurring_group_id and dup.recurring_group_id:
            moves.append(f"recurring_group_id={dup.recurring_group_id}")
        if keep.price is None and dup.price is not None:
            moves.append(f"price={dup.price}")
        if keep.currency is None and dup.currency:
            moves.append(f"currency={dup.currency}")
        if keep.account is None and dup.account:
            moves.append(f"account={dup.account}")
        if dup.is_paid and not keep.is_paid:
            moves.append("is_paid=True")
        pays = db.exec(select(TherapistPayment).where(TherapistPayment.session_id == dup.id)).all()
        notes = db.exec(select(TherapistNote).where(TherapistNote.session_id == dup.id)).all()
        if pays:
            moves.append(f"платежи: {len(pays)}")
        if notes:
            moves.append(f"заметки: {len(notes)}")
        if (dup.notes or "").strip():
            moves.append("текст notes сессии")
        bk = get_booking(db, dup.booking_id) if dup.booking_id else None
        print(f"       → ОСТАВИТЬ {keep.id} (с событием), перенести на неё: {', '.join(moves) or 'нечего'}")
        if bk:
            print(f"         {booking_line(bk)} — бронь НЕ отменяется, только перевешивается")
        print(f"       → УДАЛИТЬ {dup.id} через ORM (без Google, без отмены брони)")
        plan["pairs"].append({"keep": keep.id, "dup": dup.id})
    for d in sorted(expected - set(dup_groups)):
        print(f"   • {fmt(d)} — ожидаемой пары нет (уже разобрана?)")

    # Переименование в Google
    print(f"\n  Переименование событий в Google в «{ALENA_SUMMARY}» (после commit):")
    linked = {ts.google_event_id: ts for ts in rows if ts.google_event_id}
    all_gids_owner = {}
    masters = {}
    instances = []
    src_norm = _norm_client_name(ALENA_SRC_NAME)
    for ev in events_all:
        if ev.get("status") == "cancelled":
            continue
        sm = ev.get("summary") or ""
        hit = (ev["id"] in linked or _extract_alias_code(sm) in (ALENA_SRC_ALIAS, ALENA_DST_ALIAS)
               or _norm_client_name(sm) in (src_norm, _norm_client_name(ALENA_DST_NAME)))
        if not hit:
            continue
        instances.append(ev)
        if ev.get("recurringEventId"):
            masters.setdefault(ev["recurringEventId"], []).append(ev)
    # Мастер серии можно переименовывать, только если ВСЕ его сессии в CRM — этого клиента
    svc = _get_calendar_service()
    for mid, evs in masters.items():
        foreign = db.exec(select(TherapySession).where(
            TherapySession.google_event_id.startswith(f"{mid}_", autoescape=True),  # type: ignore
            TherapySession.client_id.not_in(client_ids),  # type: ignore
        )).all()
        try:
            m = svc.events().get(calendarId=cal_id, eventId=mid).execute()
        except Exception as e:  # noqa: BLE001
            print(f"   ! мастер {mid} не прочитан: {e!r}")
            continue
        print(f"   серия {mid}: мастер {m.get('summary')!r}, повтор {m.get('recurrence', [])[-1:]}, "
              f"начало {(m.get('start') or {}).get('dateTime')}, экземпляров в окне: {len(evs)}")
        # Экземпляр серии, привязанный к ДРУГОМУ клиенту, мешает переименовать
        # мастер, только если у него название как у мастера (тогда оно
        # переименуется вместе с серией). Экземпляр-исключение со своим
        # названием смену названия мастера не наследует.
        risky = []
        for ts in foreign:
            try:
                fe = svc.events().get(calendarId=cal_id, eventId=ts.google_event_id).execute()
                fsum = fe.get("summary") or ""
            except Exception as e:  # noqa: BLE001
                fsum = f"<не прочитано: {e!r}>"
            fc = db.get(TherapistClient, ts.client_id)
            same = fsum == (m.get("summary") or "")
            print(f"     · экземпляр другого клиента: {fmt(ts.date)} «{fc.name if fc else ts.client_id}» — "
                  f"в Google {fsum!r}" + (" (= мастеру!)" if same else " (своё название — не затронется)"))
            if same:
                risky.append(ts)
        if risky:
            hold("2. Алена", f"серия {mid}",
                 f"{len(risky)} экземпляров другого клиента названы как мастер — мастер не трогаю, только экземпляры в окне")
            continue
        if (m.get("summary") or "") != ALENA_SUMMARY:
            print(f"     → patch_event_summary(мастер) {m.get('summary')!r} → {ALENA_SUMMARY!r} (переименует всю серию)")
            plan["rename_master"].append(mid)
        else:
            print("     мастер уже назван правильно")
    need = [ev for ev in instances if (ev.get("summary") or "") != ALENA_SUMMARY]
    print(f"   событий-экземпляров в окне с неверным названием: {len(need)} "
          "(после правки мастера каждое перепроверяется; что осталось — правится по одному)")
    for ev in need:
        print("     ◦ " + ev_line(ev))
    plan["rename_instances"] = [ev["id"] for ev in need]
    return plan


def plan_cancel(db, uid, cal_id, section, alias, targets, events_all, extra_aliases_from_client=True):
    plan = {"items": []}
    c = client_by_alias(db, uid, alias)
    if not c:
        print(f"  клиент #{alias} не найден — пропускаю")
        return plan
    print(f"  клиент: {c.name!r} #{c.alias_code} id={c.id} merged={c.merged_alias_codes}")
    codes = {alias} | set(c.merged_alias_codes or [])
    first = _norm_client_name(c.name).split(" ")[0]
    for ymd, hhmm, resource in targets:
        dt = tb_to_utc(ymd, hhmm)
        label = f"{fmt(dt)} Тб"
        print(f"\n   • {label}")
        rows = db.exec(select(TherapySession).where(
            TherapySession.client_id == c.id, TherapySession.specialist_id == uid,
            TherapySession.date == dt, TherapySession.google_event_id.is_(None),  # type: ignore
            TherapySession.status.not_in(CANCELLED),  # type: ignore
        )).all()
        if not rows:
            print("     сессии без события на это время нет (уже удалена?) — ничего не делаю")
            continue
        if len(rows) > 1:
            hold(section, label, f"{len(rows)} сессий без события на это время — не понятно, какую")
            continue
        ts = rows[0]
        print("     " + sess_line(ts))
        # Google: есть ли событие клиента в тот же день ±3 ч
        near = []
        for ev in events_all:
            if ev.get("status") == "cancelled":
                continue
            st = _parse_event_dt(ev.get("start") or {})
            if not st or abs((st - dt).total_seconds()) > 3 * 3600:
                continue
            sm = ev.get("summary") or ""
            if _extract_alias_code(sm) in codes or first in _norm_client_name(sm):
                near.append(ev)
        if near:
            for ev in near:
                print("     Google: " + ev_line(ev))
            hold(section, sess_line(ts), "в Google есть событие клиента в пределах ±3 ч")
            continue
        print("     Google: событий клиента в пределах ±3 ч нет — OK")
        why = [w for w in session_blockers(db, ts) if not w.startswith("привязана бронь")]
        if why:
            hold(section, sess_line(ts), "; ".join(why))
            continue
        b = get_booking(db, ts.booking_id) if ts.booking_id else None
        if ts.booking_id and not b:
            print(f"     бронь {ts.booking_id} не найдена в БД — удаляю только сессию")
        if b:
            print("     " + booking_line(b))
            loc = dt + TB
            problems = []
            if b.resource_id != resource:
                problems.append(f"кабинет {b.resource_id}, ожидался {resource}")
            if b.date.date() != loc.date() or b.start_time != hhmm:
                problems.append(f"время брони {b.date.date()} {b.start_time} ≠ {loc.date()} {hhmm}")
            if problems:
                hold(section, booking_line(b), "; ".join(problems))
                continue
            money = booking_money(db, b)
            if money:
                hold(section, booking_line(b), "у брони есть деньги/часы: " + "; ".join(money))
                continue
            if b.status != "confirmed":
                print(f"     бронь уже {b.status} — отменять нечего")
                b = None
            else:
                if b.payment_status is None:
                    print("     (payment_status пустой — для старых строк это «оплачено»; но сумм 0 и в ledger пусто → денег нет)")
                print(f"     → ОТМЕНИТЬ бронь: status=cancelled, cancelled_by='{CLEANUP_TAG}', возврат 0 ₾"
                      + (f"; после commit удалить кабинетное событие {b.gcal_event_id}" if b.gcal_event_id else ""))
        print("     → УДАЛИТЬ сессию")
        plan["items"].append({"session": ts.id, "booking": str(b.id) if b else None})
    return plan


def pending_cabinet_events(db):
    """Брони, уже отменённые этой чисткой, у которых не удалилось событие кабинета."""
    return db.exec(select(Booking).where(
        Booking.cancelled_by == CLEANUP_TAG, Booking.status == "cancelled",
        Booking.gcal_event_id.is_not(None),  # type: ignore
    )).all()


# ─── бэкап ──────────────────────────────────────────────────────────────────

def backup(db, uid, client_ids, booking_ids):
    os.makedirs(BACKUP_DIR, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    path = os.path.join(BACKUP_DIR, f"cleanup_owner_crm_{ts}.json")
    conn = db.connection()
    bt = Booking.__tablename__

    def rows(sql, **kw):
        return [dict(r._mapping) for r in conn.execute(text(sql), kw).fetchall()]

    sess_ids = [r["id"] for r in rows("SELECT id FROM therapy_sessions WHERE client_id = ANY(:c)", c=client_ids)]
    sess_bids = [r["booking_id"] for r in rows(
        "SELECT booking_id FROM therapy_sessions WHERE client_id = ANY(:c) AND booking_id IS NOT NULL", c=client_ids)]
    all_bids = sorted(set(str(b) for b in booking_ids) | set(sess_bids))
    data = {
        "created_at": datetime.now().isoformat(),
        "specialist_id": uid,
        "note": "Сырые строки БД (заметки — в зашифрованном виде, как лежат в таблице)",
        "therapist_clients": rows("SELECT * FROM therapist_clients WHERE id = ANY(:c)", c=client_ids),
        "therapy_sessions": rows("SELECT * FROM therapy_sessions WHERE client_id = ANY(:c)", c=client_ids),
        "therapist_payments": rows(
            "SELECT * FROM therapist_payments WHERE client_id = ANY(:c) OR session_id = ANY(:s)", c=client_ids, s=sess_ids),
        "therapist_notes": rows(
            "SELECT * FROM therapist_notes WHERE client_id = ANY(:c) OR session_id = ANY(:s)", c=client_ids, s=sess_ids),
        bt: rows(f'SELECT * FROM "{bt}" WHERE CAST(id AS TEXT) = ANY(:b)', b=all_bids),
    }
    with open(path, "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=1, default=str)
    os.chmod(path, 0o600)
    print(f"\nБэкап: {path} ({', '.join(f'{k}={len(v)}' for k, v in data.items() if isinstance(v, list))})")
    return path


# ─── применение ─────────────────────────────────────────────────────────────

def cancel_booking_in_tx(db, b, owner_b, keep_session_id=None):
    """Повтор побочных эффектов cancel_booking ДО commit (без Google)."""
    from app.api.v1.bookings.routes import _refund_booking_to_owner
    money = booking_money(db, b)
    if money or b.status != "confirmed":
        raise RuntimeError(f"бронь {b.id} изменилась между планом и применением: {money} {b.status}")
    meta = {}
    if owner_b:
        meta = _refund_booking_to_owner(db, b, owner_b, refund_percent=1.0)
        if (meta.get("refunded_amount") or 0) or (meta.get("refunded_hours") or 0) or (meta.get("refunded_peak_gel") or 0):
            raise RuntimeError(f"штатный возврат по брони {b.id} хотел двинуть деньги: {meta} — откат")
    b.status = "cancelled"
    b.cancelled_by = CLEANUP_TAG
    b.cancellation_reason = CANCEL_REASON
    b.updated_at = datetime.now()
    db.add(b)
    for ts in db.exec(select(TherapySession).where(TherapySession.booking_id == str(b.id))).all():
        if ts.id == keep_session_id:
            continue
        ts.booking_id = None
        ts.is_booked = False
        ts.updated_at = datetime.now()
        db.add(ts)
    return meta


def delete_cabinet_event(db, b):
    """После commit: удалить событие кабинетного календаря; gcal_event_id обнуляем
    только при успехе (или если события уже нет) — повторный запуск добьёт."""
    from app.services.google_calendar import gcal_service
    from googleapiclient.errors import HttpError
    cal = gcal_service.get_calendar_id(b.resource_id)
    if not gcal_service.service or not cal:
        print(f"   ! бронь {b.id}: нет доступа к кабинетному календарю — событие {b.gcal_event_id} осталось")
        return
    try:
        gcal_service.service.events().delete(calendarId=cal, eventId=b.gcal_event_id).execute()
        print(f"   OK удалено кабинетное событие {b.gcal_event_id} ({b.resource_id})")
    except HttpError as e:
        if e.resp.status in (404, 410):
            print(f"   OK кабинетного события {b.gcal_event_id} уже нет")
        else:
            print(f"   ! не удалось удалить кабинетное событие {b.gcal_event_id}: {e!r} — повторите запуск")
            return
    b.gcal_event_id = None
    db.add(b)
    db.commit()


def apply_all(db, owner, uid, cal_id, p1, p2, p34):
    from app.api.v1.crm.sync import _delete_session_safely
    from app.api.v1.crm.clients import merge_clients, MergeClientsRequest
    from app.api.v1.bookings.routes import _resolve_booking_owner

    client_ids = [ELENA_ID]
    for cid in (p2.get("merge") or {}).values():
        client_ids.append(cid)
    dst = client_by_alias(db, uid, ALENA_DST_ALIAS, ALENA_DST_NAME)
    if dst:
        client_ids.append(dst.id)
    for a in (GOR_ALIAS, ALEX_ALIAS):
        c = client_by_alias(db, uid, a)
        if c:
            client_ids.append(c.id)
    booking_ids = [it["booking"] for p in p34 for it in p["items"] if it["booking"]]
    backup(db, uid, sorted(set(client_ids)), booking_ids)

    cancelled = []
    # 1. Елена и Иван
    for sid in p1["delete"]:
        ts = db.get(TherapySession, sid)
        if ts:
            _delete_session_safely(db, ts)
    print(f"[1] удалено сессий: {len(p1['delete'])}")

    # 2. Склейка — штатная merge_clients. Она сама делает commit в конце;
    #    подменяем commit на flush, чтобы всё осталось одной транзакцией.
    if p2.get("merge"):
        db.commit = db.flush  # type: ignore[method-assign]
        try:
            res = merge_clients(
                data=MergeClientsRequest(target_id=p2["merge"]["target_id"], source_ids=[p2["merge"]["source_id"]]),
                session=db, current_user=owner,
            )
        finally:
            del db.commit
        print(f"[2] merge_clients: {res}")
    for pr in p2["pairs"]:
        keep = db.get(TherapySession, pr["keep"])
        dup = db.get(TherapySession, pr["dup"])
        if not keep or not dup:
            continue
        if not keep.booking_id and dup.booking_id:
            keep.booking_id = dup.booking_id
            keep.is_booked = True
        if not keep.recurring_group_id and dup.recurring_group_id:
            keep.recurring_group_id = dup.recurring_group_id
        if keep.price is None and dup.price is not None:
            keep.price = dup.price
        if keep.currency is None and dup.currency:
            keep.currency = dup.currency
        if keep.account is None and dup.account:
            keep.account = dup.account
        if dup.is_paid and not keep.is_paid:
            keep.is_paid = True
        for p in db.exec(select(TherapistPayment).where(TherapistPayment.session_id == dup.id)).all():
            p.session_id = keep.id
            db.add(p)
        for n in db.exec(select(TherapistNote).where(TherapistNote.session_id == dup.id)).all():
            n.session_id = keep.id
            db.add(n)
        if (dup.notes or "").strip():
            keep.notes = dup.notes if not (keep.notes or "").strip() else f"{keep.notes}\n\n{dup.notes}"
        keep.updated_at = datetime.now()
        db.add(keep)
        db.flush()
        _delete_session_safely(db, dup)
    print(f"[2] разобрано пар: {len(p2['pairs'])}")

    # 3–4. Удалить сессии + отменить брони
    for p in p34:
        for it in p["items"]:
            ts = db.get(TherapySession, it["session"])
            if it["booking"]:
                b = get_booking(db, it["booking"], lock=True)
                owner_b = _resolve_booking_owner(db, b)
                cancel_booking_in_tx(db, b, owner_b)
                cancelled.append(b.id)
            if ts:
                _delete_session_safely(db, ts)
    print(f"[3-4] удалено сессий: {sum(len(p['items']) for p in p34)}, отменено броней: {len(cancelled)}")

    db.commit()
    print("COMMIT — OK")

    # ── после commit: Google и уведомления ──
    from app.services.waitlist_notify import notify_waitlist_for_freed_slot
    from app.services.timeline import timeline_service
    for bid in cancelled:
        b = get_booking(db, bid)
        try:
            n = notify_waitlist_for_freed_slot(db, b)
            print(f"   лист ожидания по брони {bid}: уведомлено {n}")
        except Exception as e:  # noqa: BLE001
            print(f"   ! лист ожидания по брони {bid}: {e!r}")
        try:
            timeline_service.log_event(
                session=db, actor_id=owner.id, actor_role=owner.role, target_id=str(bid),
                target_type="booking", event_type="booking_cancelled",
                description="Бронь отменена разовой чисткой CRM владельца (owner-cleanup, 01.10.2026). Возврат 0 ₾.",
                metadata={"cancelled_by": CLEANUP_TAG, "refund_percent": 1.0, "refunded_amount": 0},
            )
        except Exception as e:  # noqa: BLE001
            print(f"   ! timeline по брони {bid}: {e!r}")
    post_commit_google(db, cal_id, p2)


def post_commit_google(db, cal_id, p2):
    for b in pending_cabinet_events(db):
        delete_cabinet_event(db, b)
    for mid in p2["rename_master"]:
        try:
            patch_event_summary(cal_id, mid, ALENA_SUMMARY)
            print(f"   OK серия {mid} переименована в {ALENA_SUMMARY!r}")
        except Exception as e:  # noqa: BLE001
            print(f"   ! серия {mid}: {e!r}")
    if p2["rename_instances"]:
        svc = _get_calendar_service()
        fixed = 0
        for eid in p2["rename_instances"]:
            try:
                ev = svc.events().get(calendarId=cal_id, eventId=eid).execute()
                if (ev.get("summary") or "") != ALENA_SUMMARY:
                    patch_event_summary(cal_id, eid, ALENA_SUMMARY)
                    fixed += 1
            except Exception as e:  # noqa: BLE001
                print(f"   ! событие {eid}: {e!r}")
        print(f"   экземпляров переименовано по одному: {fixed} (остальные подтянулись от мастера)")


# ─── main ───────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="выполнить (по умолчанию — только план)")
    ap.add_argument("--include-other-pairs", action="store_true",
                    help="разобрать тем же правилом пары-дубли Алены вне списка владельца (16.10–13.11)")
    args = ap.parse_args()
    global INCLUDE_OTHER_PAIRS
    INCLUDE_OTHER_PAIRS = args.include_other_pairs
    mode = "APPLY" if args.apply else "DRY-RUN (ничего не меняется)"
    print(f"Чистка CRM владельца 01.10 — режим: {mode} — {datetime.now():%Y-%m-%d %H:%M:%S}")

    with Session(engine) as db:
        owner = db.exec(select(User).where(User.email == OWNER_EMAIL)).first()
        if not owner:
            raise SystemExit("владелец не найден")
        uid = str(owner.id)
        cal_id = get_crm_calendar_id(owner)
        print(f"владелец {uid} role={owner.role} календарь={cal_id} "
              f"gcal_source_of_truth={(owner.crm_data or {}).get('gcal_source_of_truth')}")
        if not cal_id:
            raise SystemExit("у владельца не подключён календарь")
        events_all = _get_events(cal_id, datetime(2026, 8, 1), datetime(2027, 6, 1), show_deleted=True)
        print(f"событий в Google (01.08.2026–01.06.2027, включая удалённые): {len(events_all)}")

        p1 = plan_elena(db, uid, cal_id, events_all)
        p2 = plan_alena(db, uid, cal_id, events_all, owner)
        print("\n" + "=" * 100)
        print("3. «Николай Горячев» (#6354) — сессия 03.10 14:00 без события + бронь Каб.5")
        print("=" * 100)
        p3 = plan_cancel(db, uid, cal_id, "3. Горячев", GOR_ALIAS, GOR_TARGETS, events_all)
        print("\n" + "=" * 100)
        print("4. «Александр» (#2109) — сессии 14:00 без события + брони Каб.7")
        print("=" * 100)
        p4 = plan_cancel(db, uid, cal_id, "4. Александр", ALEX_ALIAS, ALEX_TARGETS, events_all)

        pend = pending_cabinet_events(db)
        if pend:
            print(f"\nНедоделано с прошлого запуска: кабинетных событий к удалению {len(pend)}")
            for b in pend:
                print("   " + booking_line(b))

        print("\n" + "=" * 100)
        print("СВОДКА ПЛАНА")
        print(f"  1. Елена и Иван: удалить сессий {len(p1['delete'])}")
        print(f"  2. Алена: склейка {'да' if p2.get('merge') else 'нет (уже)'}; пар-дублей {len(p2['pairs'])}; "
              f"переименовать серий {len(p2['rename_master'])}, экземпляров на проверку {len(p2['rename_instances'])}")
        print(f"  3. Горячев: сессий {len(p3['items'])}, броней {sum(1 for i in p3['items'] if i['booking'])}")
        print(f"  4. Александр: сессий {len(p4['items'])}, броней {sum(1 for i in p4['items'] if i['booking'])}")
        print(f"  НЕ ТРОГАЮ: {len(HOLD)}")
        for sec, what, why in HOLD:
            print(f"   - [{sec}] {what}\n       причина: {why}")

        nothing = not (p1["delete"] or p2.get("merge") or p2["pairs"] or p2["rename_master"]
                       or p2["rename_instances"] or p3["items"] or p4["items"] or pend)
        if not args.apply:
            print("\nDRY-RUN: изменений нет. Для выполнения: --apply")
            db.rollback()
            return
        if nothing:
            print("\nДелать нечего — всё уже применено.")
            return
        apply_all(db, owner, uid, cal_id, p1, p2, [p3, p4])
        print("\nГОТОВО.")


if __name__ == "__main__":
    main()
