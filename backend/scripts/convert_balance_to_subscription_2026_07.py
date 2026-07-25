"""Перевод «балансовых» броней на действующий абонемент (owner 2026-07-25).

⚠️ ОПАСНО ДЛЯ КЛИЕНТОВ С РУЧНОЙ СВЕРКОЙ ЧАСОВ. НЕ ЗАПУСКАТЬ ВСЛЕПУЮ.
На 2026-07-25 единственный клиент с активным абонементом — Валерия
Костенецкая, а её used_hours (26) выставлен РУЧНОЙ сверкой Егора по факту и
уже включает часы этих балансовых броней. Перевод спишет ЕЩЁ 15 часов —
двойной счёт, остаток уйдёт в минус. Деньги при этом не двигаются (брони
были «утёкшие»: цена 0, ничего не списывалось, возврат = 0). Поэтому по
Валерии скрипт НЕ запускался — ярлык 'balance' там косметика, данные верны.
Запускать этот скрипт можно только для клиентов, чей used_hours НЕ правился
руками (иначе сверить руками ту же математику до запуска).

Кейс: у клиента ЕСТЬ активный абонемент, но часть броней провели с баланса
(создали до фикса утечки 15.07, либо админ вручную). Переводим их на
списание с абонемента: деньги назад на баланс, часы с абонемента.

Берём ТОЛЬКО клиентов с ДЕЙСТВУЮЩИМ (активным) абонементом и только те
брони, что абонемент реально покрывает (движок даёт applied_rule=SUBSCRIPTION:
хватает часов, формат подходит, срок не вышел). Завершённые/истёкшие
абонементы не трогаем.

  venv/bin/python3 scripts/convert_balance_to_subscription_2026_07.py --dry-run
  venv/bin/python3 scripts/convert_balance_to_subscription_2026_07.py

Идемпотентно: уже переведённые (payment_method='subscription') пропускаются.
"""
from __future__ import annotations

import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlmodel import Session, select  # noqa: E402

from app.db.session import engine  # noqa: E402
from app.models.user import User  # noqa: E402
from app.models.booking import Booking  # noqa: E402
from app.services import subscription_pool  # noqa: E402
from app.api.v1.bookings.routes import _convert_booking_to_subscription  # noqa: E402


def run(dry_run: bool) -> int:
    tag = "[холостой] " if dry_run else ""
    now = datetime.utcnow()
    converted = 0
    refunded_total = 0.0
    hours_total = 0.0

    with Session(engine) as session:
        users = session.exec(select(User)).all()
        subs = [u for u in users if subscription_pool.is_active(u.subscription, now)]
        print(f"{tag}клиентов с активным абонементом: {len(subs)}")

        for u in subs:
            bks = session.exec(
                select(Booking).where(
                    Booking.status == "confirmed",
                    Booking.payment_method == "balance",
                ).where(
                    (Booking.user_uuid == u.id) | (Booking.user_id == u.email)
                )
            ).all()
            for b in bks:
                # savepoint: пробуем перевести; если абонемент не покрывает —
                # откатываем только эту бронь и идём дальше.
                sp = session.begin_nested()
                try:
                    r = _convert_booking_to_subscription(session, b, None)
                    if dry_run:
                        sp.rollback()
                    else:
                        sp.commit()
                    converted += 1
                    refunded_total += r["refunded_to_balance"]
                    hours_total += r["hours_deducted"]
                    print(f"{tag}  {r['client'][:24]:24} {b.date.date()} "
                          f"→ возврат {r['refunded_to_balance']:.0f} ₾, "
                          f"часов {r['hours_deducted']:.1f}, остаток {r['remaining_hours_after']:.1f}")
                except ValueError:
                    sp.rollback()  # абонемент не покрывает — пропускаем молча
                except Exception as e:  # noqa: BLE001
                    sp.rollback()
                    print(f"{tag}  ⚠ {u.name}: {b.id} — {e}")

        if not dry_run:
            session.commit()

    print(f"\n{tag}ИТОГО: переведено броней {converted}, "
          f"возвращено на балансы {refunded_total:.2f} ₾, "
          f"списано часов {hours_total:.1f}")
    return 0


if __name__ == "__main__":
    sys.exit(run("--dry-run" in sys.argv))
