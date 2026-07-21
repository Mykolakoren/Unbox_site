"""Приведение Psy-CRM к словам владельца (21.07.2026).

Владелец сверил живьём. Система уже совпадает с реальностью по Акульчику
(долг 2300 USD), Максиму и Нурлане (175 ₾), Петрову, Анне 16 и Кристине
Аваковой (долгов нет). Расходятся два места:

1. ИГОРЬ ЮРЧЕНКО — система показывает долг 200 ₾, владелец: всё оплачено.
   У него висит платёж 200 ₾ от 13.06 без привязки, и ровно на 200 ₾
   неоплаченная сессия от 30.05. Это она и есть — привязываем, долг уходит.

2. АЙГУЛЬ — долг 70 USD, владелец: оплачено. Платёж 70 USD от 05.06 без
   привязки и сессия того же дня ровно на 70 USD. Привязываем.

Ещё в двух местах долга нет, но и денег не записано — сессия закрыта, а
платёжной строки под ней не существует. Владелец подтвердил, что клиенты
рассчитались, значит деньги были, просто не внесены. Дописываем их, иначе
доход занижен:

3. АННА 16 — сессия 13.05.2026, 150 ₾.
4. КРИСТИНА АВАКОВА — сессия 15.05.2026, 100 ₾.

    venv/bin/python3 scripts/fix_crm_payments_2026_07.py --dry-run
    venv/bin/python3 scripts/fix_crm_payments_2026_07.py

Идемпотентно: повторный запуск ничего не найдёт.
"""
from __future__ import annotations

import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlmodel import Session, select  # noqa: E402

from app.db.session import engine  # noqa: E402
from app.models.therapist_client import TherapistClient  # noqa: E402
from app.models.therapy_session import TherapySession  # noqa: E402
from app.models.therapist_payment import TherapistPayment  # noqa: E402

# (клиент, дата платежа, дата сессии, сумма) — привязать существующий платёж.
ATTACH = [
    ("Айгуль", "2026-06-05", "2026-06-05", 70.0),
]

# (клиент, дата сессии, сумма) — платёж под сессией УЖЕ есть, снята только
# галочка «оплачено». Игорь: под сессией 30.05 висит платёж от 02.06, но
# сессия числится в долгу. Владелец подтвердил: долга нет. Просто ставим
# галочку — привязывать сюда его 14-й платёж от 13.06 НЕЛЬЗЯ (на сессию
# допустим ровно один платёж, и он занят).
MARK_PAID = [
    ("Игорь Юрченко", "2026-05-30", 200.0),
]

# (клиент, дата сессии, сумма) — дописать недостающий платёж.
ADD = [
    ("Анна 16",          "2026-05-13", 150.0),
    ("Кристина Авакова", "2026-05-15", 100.0),
]


def _client(session: Session, name: str) -> TherapistClient | None:
    return session.exec(select(TherapistClient).where(TherapistClient.name == name)).first()


def _session_on(session: Session, client, day: str, amount: float):
    """Сессия клиента за указанный день с указанной ценой."""
    a = datetime.fromisoformat(day)
    b = datetime.fromisoformat(day + "T23:59:59")
    for s in session.exec(
        select(TherapySession)
        .where(TherapySession.client_id == client.id)
        .where(TherapySession.date >= a)
        .where(TherapySession.date <= b)
    ).all():
        price = s.price if s.price is not None else (client.base_price or 0)
        if abs(float(price) - amount) < 0.01:
            return s
    return None


def run(dry_run: bool) -> int:
    tag = "[холостой] " if dry_run else ""
    with Session(engine) as session:
        print(f"{tag}1–2) ПРИВЯЗКА существующих платежей")
        for name, pay_day, sess_day, amount in ATTACH:
            c = _client(session, name)
            if c is None:
                print(f"{tag}  ⚠ клиент не найден: {name}")
                continue
            pay = session.exec(
                select(TherapistPayment)
                .where(TherapistPayment.client_id == c.id)
                .where(TherapistPayment.session_id.is_(None))  # type: ignore[union-attr]
                .where(TherapistPayment.amount == amount)
                .where(TherapistPayment.date >= datetime.fromisoformat(pay_day))
                .where(TherapistPayment.date <= datetime.fromisoformat(pay_day + "T23:59:59"))
            ).first()
            ts = _session_on(session, c, sess_day, amount)
            if pay is None or ts is None:
                print(f"{tag}  ⚠ {name}: платёж={'есть' if pay else 'НЕТ'}, "
                      f"сессия={'есть' if ts else 'НЕТ'} → пропускаю")
                continue
            print(f"{tag}  {name}: платёж {amount:g} {pay.currency} от {pay_day} "
                  f"→ сессия {sess_day} (была {'оплачена' if ts.is_paid else 'В ДОЛГУ'})")
            if not dry_run:
                pay.session_id = ts.id
                ts.is_paid = True
                ts.currency = ts.currency or c.currency
                ts.account = ts.account or pay.account
                ts.updated_at = datetime.now()
                session.add(pay)
                session.add(ts)

        print(f"\n{tag}2b) СТАВИМ галочку «оплачено» там, где платёж уже есть")
        for name, sess_day, amount in MARK_PAID:
            c = _client(session, name)
            if c is None:
                print(f"{tag}  ⚠ клиент не найден: {name}")
                continue
            ts = _session_on(session, c, sess_day, amount)
            if ts is None:
                print(f"{tag}  ⚠ {name}: сессия {sess_day} не найдена → пропускаю")
                continue
            under = session.exec(
                select(TherapistPayment).where(TherapistPayment.session_id == ts.id)
            ).first()
            if under is None:
                print(f"{tag}  ⚠ {name}: под сессией {sess_day} платежа НЕТ → не трогаю")
                continue
            if ts.is_paid:
                print(f"{tag}  {name}: сессия {sess_day} уже оплачена → пропускаю")
                continue
            print(f"{tag}  {name}: сессия {sess_day} — платёж от "
                  f"{under.date.date()} на месте, ставлю «оплачено»")
            if not dry_run:
                ts.is_paid = True
                ts.updated_at = datetime.now()
                session.add(ts)

        print(f"\n{tag}3–4) ДОПИСЫВАЕМ недостающие платежи")
        for name, sess_day, amount in ADD:
            c = _client(session, name)
            if c is None:
                print(f"{tag}  ⚠ клиент не найден: {name}")
                continue
            ts = _session_on(session, c, sess_day, amount)
            if ts is None:
                print(f"{tag}  ⚠ {name}: сессия {sess_day} на {amount:g} не найдена → пропускаю")
                continue
            already = session.exec(
                select(TherapistPayment).where(TherapistPayment.session_id == ts.id)
            ).first()
            if already is not None:
                print(f"{tag}  {name}: платёж уже есть → пропускаю")
                continue
            print(f"{tag}  {name}: дописываю {amount:g} {c.currency or 'GEL'} "
                  f"за сессию {sess_day} (сессия уже помечена оплаченной)")
            if not dry_run:
                session.add(TherapistPayment(
                    client_id=c.id,
                    specialist_id=c.specialist_id,
                    amount=amount,
                    currency=c.currency or "GEL",
                    account=c.default_account or "Cash",
                    date=ts.date,
                    session_id=ts.id,
                ))

        if not dry_run:
            session.commit()
    return 0


if __name__ == "__main__":
    sys.exit(run("--dry-run" in sys.argv))
