"""Доп. пул часов уже купленным абонементам — «как будто работало с покупки» (01.10).

Решение владельца 01.10:
  * капсула: сначала часы капсулы (Пробный 1, Тёплый 4, Регулярный 6, Профи+ 10 ч),
    потом общий пул час за час, потом деньги; у «Группового мастера» — «4 ч
    индивидуально» только на кабинеты;
  * уже купленные абонементы — как будто так работало с покупки: начислить доп.
    пул по тарифу и ВЕРНУТЬ в общий пул часы, потраченные на капсулу в ТЕКУЩЕМ
    абонементе, за счёт капсульных часов, но не больше их числа.

Что делает скрипт (действующие и замороженные; истёкшие, недельные пакеты и
тарифы вне каталога не трогает):
  1. extra_kind / extra_hours_total / extra_hours_remaining / extra_hours_used — по тарифу;
  2. часы, списанные с общего пула на брони КАПСУЛ в текущем абонементе
     (оплаченные, не отменённые), считаются «капсульными»: x = min(они, часы
     капсулы тарифа, израсходовано в общем пуле);
  3. x переезжает: общий пул +x (остаток) и −x (израсходовано), доп. пул
     израсходовано +x. Деньги и баланс НЕ трогаются;
  4. у этих броней проставляется extra_hours_deducted / hours_pool — чтобы
     будущая отмена вернула часы в доп. пул, а не в общий.
Начало «текущего абонемента» — последняя покупка в ленте баланса (subscription_purchase);
если её нет — срок действия минус длительность тарифа минус дни паузы.

  cd /var/www/unbox/backend && PYTHONPATH=. venv/bin/python3 scripts/tariffs_extra_pool_2026_10.py --dry-run
  cd /var/www/unbox/backend && PYTHONPATH=. venv/bin/python3 scripts/tariffs_extra_pool_2026_10.py --apply
  (+ --exclude=почта1,почта2 — не трогать этих клиентов)

По умолчанию — dry-run (читает в транзакции READ ONLY, ничего не пишет).
--apply: сначала JSON-бэкап в /root/backups (абонементы и затронутые брони,
этого достаточно для отката), затем запись под блокировкой строки каждого
клиента. Идемпотентно: у абонемента с доп. пулом повторный запуск ничего не делает.
ВАЖНО: --apply — только ПОСЛЕ выкладки миграции колонок брони (hours_pool,
extra_hours_deducted); dry-run работает и до неё.
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import text  # noqa: E402
from sqlmodel import Session  # noqa: E402

from app.db.session import engine  # noqa: E402
from app.services import subscription_pool  # noqa: E402

# Доп. пул по тарифу — копия subscription_sale.PLANS (сторож guard_tariffs_extra
# сверяет). Свой словарь, чтобы dry-run шёл на прод-коде до выкладки шага 2в.
EXTRA_BY_PLAN: dict[str, tuple[str, float]] = {
    "TRIAL": ("capsule", 1.0),
    "WARM_START": ("capsule", 4.0),
    "REGULAR_PRACTITIONER": ("capsule", 6.0),
    "PRO_PLUS": ("capsule", 10.0),
    "GROUP_MASTER": ("individual", 4.0),
}
# длительность и цена — для оценки в ₾ и запасной даты покупки (там же в PLANS)
PLAN_INFO: dict[str, dict] = {
    "TRIAL": dict(hours=4, bonus=0, price=70, days=14, name="Пробный"),
    "WARM_START": dict(hours=10, bonus=0, price=180, days=30, name="Тёплый старт"),
    "REGULAR_PRACTITIONER": dict(hours=20, bonus=0, price=350, days=30, name="Регулярный практик"),
    "PRO_PLUS": dict(hours=40, bonus=2, price=650, days=45, name="Профи+"),
    "GROUP_MASTER": dict(hours=20, bonus=0, price=450, days=45, name="Групповой мастер"),
}
BACKUP_DIR = "/root/backups"
_EPS = 0.005


def _f(v) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def purchase_start(session: Session, user_id: str, sub: dict, info: dict) -> tuple[datetime, str]:
    """Когда куплен ТЕКУЩИЙ абонемент: последняя покупка в ленте баланса, иначе
    срок − длительность тарифа − дни паузы (пауза удлиняет срок)."""
    expiry = subscription_pool._parse_dt(subscription_pool.get(sub, "expiry_date"))
    row = session.execute(text(
        "SELECT created_at FROM balance_ledger WHERE user_id = :u AND reason = 'subscription_purchase' "
        "ORDER BY created_at DESC LIMIT 1"), {"u": str(user_id)}).first()
    if row and row[0]:
        d = row[0]
        # покупка из ленты годится, если укладывается в срок этого тарифа с запасом на паузы
        if expiry is None or (expiry - d) <= timedelta(days=info["days"] + 60):
            return d, "лента баланса"
    if expiry is None:
        return datetime.utcnow() - timedelta(days=info["days"]), "нет срока — условно"
    paused = _f(subscription_pool.get(sub, "freeze_days_used"))
    return expiry - timedelta(days=info["days"] + paused), "срок − длительность тарифа"


def capsule_bookings(session: Session, user_id: str, since: datetime) -> list[dict]:
    """Оплаченные абонементные брони капсул в текущем абонементе (часы реально
    списаны и не возвращены), по порядку списания."""
    rows = session.execute(text("""
        SELECT b.id::text AS id, b.date::date::text AS d, b.start_time, b.duration,
               b.hours_deducted AS hours, coalesce(b.charged_at, b.created_at) AS charged
        FROM booking b JOIN resource r ON r.id = b.resource_id
        WHERE b.user_uuid = :u AND r.type = 'capsule'
          AND b.payment_method = 'subscription' AND b.status = 'confirmed'
          AND coalesce(b.payment_status, 'paid') = 'paid'
          AND coalesce(b.hours_deducted, 0) > 0
          AND coalesce(b.charged_at, b.created_at) >= :since
        ORDER BY coalesce(b.charged_at, b.created_at), b.date, b.start_time"""),
        {"u": str(user_id), "since": since}).mappings().all()
    return [dict(r) for r in rows]


def plan_for(session: Session, user_id: str, email: str, sub: dict | None, now: datetime) -> dict | None:
    """Описание изменений для одного абонемента или None / {'skip': причина}."""
    if not sub:
        return None
    plan_id = subscription_pool.get(sub, "plan_id")
    if subscription_pool.get(sub, "weekly_package", False):
        return {"email": email, "plan": plan_id or "—", "skip": "недельный пакет — доп. пула нет"}
    if plan_id not in EXTRA_BY_PLAN:
        return {"email": email, "plan": plan_id or "—", "skip": "тариф вне каталога — доп. пула нет"}
    if subscription_pool.is_expired(sub, now):
        return {"email": email, "plan": plan_id, "skip": "срок истёк — не трогаем"}
    if subscription_pool.get(sub, "extra_kind"):
        return {"email": email, "plan": plan_id, "skip": "доп. пул уже начислен"}

    kind, extra_total = EXTRA_BY_PLAN[plan_id]
    info = PLAN_INFO[plan_id]
    start, start_src = purchase_start(session, user_id, sub, info)
    bookings = capsule_bookings(session, user_id, start) if kind == "capsule" else []
    spent_caps = round(sum(_f(b["hours"]) for b in bookings), 4)
    main_used = _f(subscription_pool.get(sub, "used_hours"))
    x = round(max(0.0, min(spent_caps, extra_total, main_used)), 4)

    # раскладка x по броням в порядке списания (последняя может быть «смешанной»)
    left = x
    alloc = []
    for b in bookings:
        take = round(min(_f(b["hours"]), left), 4)
        left = round(left - take, 4)
        if take > 0:
            alloc.append({"id": b["id"], "date": b["d"], "start": b["start_time"], "hours": _f(b["hours"]),
                          "extra": take})
        if left <= _EPS:
            break

    rem = _f(subscription_pool.get(sub, "remaining_hours"))
    price_per_hour = info["price"] / (info["hours"] + info["bonus"]) if (info["hours"] + info["bonus"]) else 0
    return {
        "email": email, "user_id": str(user_id), "plan": plan_id, "plan_name": info["name"], "kind": kind,
        "extra_total": extra_total, "start": start, "start_src": start_src,
        "capsule_bookings": len(bookings), "capsule_hours": spent_caps,
        "return_to_main": x, "alloc": alloc,
        "main_before": rem, "main_after": round(rem + x, 4), "used_before": main_used,
        "extra_remaining_after": round(extra_total - x, 4),
        "worth_gel": round(x * price_per_hour, 2),
        "frozen": bool(subscription_pool.get(sub, "is_frozen", False)),
        "flexible": bool(subscription_pool.get(sub, "flexible", False)),
        "extra_worth_gel": round(extra_total * (10 if kind == "capsule" else 20), 2),
        "expiry": subscription_pool.get(sub, "expiry_date"),
    }


def collect(session: Session, now: datetime) -> list[dict]:
    out = []
    for uid, email, sub in session.execute(text(
            'SELECT id::text, email, subscription FROM "user" WHERE subscription IS NOT NULL ORDER BY email')).all():
        if isinstance(sub, str):
            sub = json.loads(sub)
        if not isinstance(sub, dict) or not sub:
            continue
        p = plan_for(session, uid, email or uid, sub, now)
        if p:
            out.append(p)
    return out


def print_report(rows: list[dict], apply: bool) -> None:
    tag = "" if apply else "[dry-run] "
    todo = [r for r in rows if "skip" not in r]
    skipped = [r for r in rows if "skip" in r]
    print(f"{tag}Доп. пул часов — абонементы к обновлению: {len(todo)}")
    print("=" * 100)
    tot_extra = tot_ret = tot_gel = tot_xgel = 0.0
    for r in todo:
        lab = "часы капсулы" if r["kind"] == "capsule" else "«4 ч индивидуально»"
        flags = ("  НА ПАУЗЕ" if r["frozen"] else "") + ("  ОСОБЫЕ УСЛОВИЯ (без срока)" if r["flexible"] else "")
        print(f"\n{r['email']}   [{r['plan_name']}]{flags}   действует до {str(r['expiry'])[:10]}")
        print(f"  начислить доп. пул:  +{r['extra_total']:g} ч ({lab}), по цене помещения ≈ {r['extra_worth_gel']:g} ₾")
        print(f"  куплен (оценка):     {r['start']:%d.%m.%Y %H:%M}  [{r['start_src']}]")
        print(f"  брони капсул в текущем абонементе: {r['capsule_bookings']} шт., {r['capsule_hours']:g} ч")
        print(f"  вернуть в общий пул: {r['return_to_main']:g} ч  (≈ {r['worth_gel']:g} ₾ по цене часа тарифа)")
        print(f"  общий пул:           {r['main_before']:g} → {r['main_after']:g} ч;  доп. пул после: "
              f"{r['extra_remaining_after']:g} из {r['extra_total']:g} ч")
        for a in r["alloc"]:
            print(f"      бронь {a['date']} {a['start']}  {a['hours']:g} ч → из доп. пула {a['extra']:g} ч")
        tot_extra += r["extra_total"]
        tot_ret += r["return_to_main"]
        tot_gel += r["worth_gel"]
        tot_xgel += r["extra_worth_gel"]
    print("\n" + "=" * 100)
    print(f"ИТОГО: абонементов {len(todo)}; начислить доп. часов {tot_extra:g} (≈ {tot_xgel:g} ₾ по цене помещения); "
          f"вернуть в общие пулы {tot_ret:g} ч (≈ {tot_gel:g} ₾ по цене часа тарифа). Денег и баланса не касается.")
    if skipped:
        print("\nНе трогаем:")
        for r in skipped:
            print(f"  {r['email']:40s} {str(r['plan']):22s} {r['skip']}")
    if not apply:
        print("\nНичего не записано. Чтобы применить — запустить с --apply (после согласия владельца).")


def backup(rows: list[dict], session: Session) -> str:
    os.makedirs(BACKUP_DIR, exist_ok=True)
    path = os.path.join(BACKUP_DIR, f"tariffs_extra_pool_2026_10_{datetime.utcnow():%Y%m%d_%H%M%S}.json")
    data = []
    for r in rows:
        if "skip" in r:
            continue
        sub = session.execute(text('SELECT subscription FROM "user" WHERE id::text = :u'), {"u": r["user_id"]}).scalar()
        if isinstance(sub, str):
            sub = json.loads(sub)
        bk = session.execute(text(
            "SELECT id::text AS id, hours_deducted, to_jsonb(booking)->>'hours_pool' AS hours_pool, "
            "to_jsonb(booking)->>'extra_hours_deducted' AS extra_hours_deducted FROM booking "
            "WHERE id::text = ANY(:ids)"), {"ids": [a["id"] for a in r["alloc"]]}).mappings().all()
        data.append({"user_id": r["user_id"], "email": r["email"], "subscription_before": sub,
                     "bookings_before": [dict(x) for x in bk]})
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1, default=str)
    return path


def apply_one(session: Session, r: dict, now: datetime) -> bool:
    """Применить под блокировкой строки; пересчитать на свежих данных."""
    session.execute(text('SELECT id FROM "user" WHERE id::text = :u FOR UPDATE'), {"u": r["user_id"]})
    sub = session.execute(text('SELECT subscription FROM "user" WHERE id::text = :u'), {"u": r["user_id"]}).scalar()
    if isinstance(sub, str):
        sub = json.loads(sub)
    fresh = plan_for(session, r["user_id"], r["email"], sub, now)
    if not fresh or "skip" in fresh:
        return False
    kind, total, x = fresh["kind"], fresh["extra_total"], fresh["return_to_main"]
    new = subscription_pool.update(sub, **subscription_pool.extra_fields(kind, total))
    if x > 0:
        new = subscription_pool.debit_hours(new, x, extra=x)   # доп. пул: израсходовано +x
        new = subscription_pool.credit_hours(new, x)           # общий пул: остаток +x, израсходовано −x
    hist = session.execute(text('SELECT comment_history FROM "user" WHERE id::text = :u'), {"u": r["user_id"]}).scalar()
    if isinstance(hist, str):
        hist = json.loads(hist)
    hist = list(hist or [])
    hist.append({
        "date": now.isoformat(), "adminName": "Система", "type": "subscription_extra_pool",
        "text": (f"Доп. пул по тарифу: +{total:g} ч ({'часы капсулы' if kind == 'capsule' else '4 ч индивидуально'})"
                 + (f"; возвращено в общий пул {x:g} ч, потраченных на капсулу" if x > 0 else "")),
        "meta": {"extra_total": total, "returned_to_main": x},
    })
    session.execute(text('UPDATE "user" SET subscription = CAST(:s AS json), comment_history = CAST(:h AS json) '
                         'WHERE id::text = :u'),
                    {"s": json.dumps(new, ensure_ascii=False), "h": json.dumps(hist, ensure_ascii=False),
                     "u": r["user_id"]})
    for a in fresh["alloc"]:
        label = "extra" if a["extra"] >= a["hours"] - _EPS else "mixed"
        session.execute(text("UPDATE booking SET hours_pool = :p, extra_hours_deducted = :x WHERE id::text = :b"),
                        {"p": label, "x": a["extra"], "b": a["id"]})
    return True


def _excluded() -> set[str]:
    """--exclude=a@x,b@y — клиенты, которых не трогаем (решение владельца 01.10:
    Света Розова на паузе — часы капсулы начислим, когда пауза закончится)."""
    out: set[str] = set()
    for a in sys.argv[1:]:
        if a.startswith("--exclude="):
            out |= {e.strip().lower() for e in a.split("=", 1)[1].split(",") if e.strip()}
    return out


def run(apply: bool) -> int:
    now = datetime.utcnow()
    with Session(engine) as session:
        if not apply:
            # физически не может ничего записать
            session.execute(text("SET TRANSACTION READ ONLY"))
        rows = collect(session, now)
        skip_emails = _excluded()
        if skip_emails:
            dropped = [r for r in rows if str(r.get("email", "")).lower() in skip_emails]
            rows = [r for r in rows if r not in dropped]
            print("Исключены по --exclude: " + (", ".join(str(r.get("email")) for r in dropped) or "никого не нашлось"))
        print_report(rows, apply)
        if not apply:
            session.rollback()
            return 0
        todo = [r for r in rows if "skip" not in r]
        if not todo:
            print("Нечего применять.")
            return 0
        path = backup(rows, session)
        print(f"\nБэкап: {path}")
        done = 0
        for r in todo:
            if apply_one(session, r, now):
                done += 1
        session.commit()
        print(f"Применено: {done} из {len(todo)}")
    return 0


if __name__ == "__main__":
    sys.exit(run("--apply" in sys.argv and "--dry-run" not in sys.argv))
