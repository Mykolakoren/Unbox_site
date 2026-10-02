#!/usr/bin/env python3
"""Чистка «скопированного» счёта у неоплаченных сессий Psy-CRM (01.10.2026).

Проблема: сессии, созданные из брони кабинета, при создании копировали
client.default_account в TherapySession.account. После смены счёта клиента
(Cash -> TBC) такая неоплаченная сессия оставалась на старом счёте, и «Отметить
оплату» отправляла платёж не туда (кейс «Андрей и Надежда»). Код починен —
новые сессии создаются с account = NULL. Этот скрипт чистит уже созданные.

Что делает: у НЕОПЛАЧЕННЫХ сессий (is_paid = false), у которых account совпадает со
счётом клиента по умолчанию БЕЗ УЧЁТА РЕГИСТРА (это копия при создании), ставит
account = NULL. Тогда при оплате берётся актуальный счёт клиента.

Что НЕ трогает:
  - оплаченные сессии (счёт там — история);
  - неоплаченные с ДРУГИМ счётом (выбран человеком явно);
  - неоплаченные сессии, у которых уже есть платёж (частичная оплата) —
    только в отчёте;
  - клиентов, у которых счёт по умолчанию пустой.
Остальные поля и updated_at не меняются.

По умолчанию (--dry-run) только печатает цифры и список. --apply: JSON-бэкап
(id, client_id, account) в /root/backups/crm_clear_copied_account_<ts>.json,
затем одна транзакция. Откат: вернуть account из бэкапа по id.

Запуск на сервере:
  cd /var/www/unbox/backend && PYTHONPATH=. venv/bin/python3 scripts/crm_clear_copied_account_2026_10.py
  cd /var/www/unbox/backend && PYTHONPATH=. venv/bin/python3 scripts/crm_clear_copied_account_2026_10.py --apply
"""
import argparse
import json
import os
import sys
from collections import Counter
from datetime import datetime

sys.path.insert(0, os.environ.get("UNBOX_BACKEND", "/var/www/unbox/backend"))

from sqlalchemy import text  # noqa: E402

BACKUP_DIR = "/root/backups"

SQL_ROWS = """
SELECT s.id, s.client_id, s.specialist_id, s.date, s.status, s.is_paid, s.account,
       c.name AS client_name, c.default_account,
       (SELECT count(*) FROM therapist_payments p WHERE p.session_id = s.id) AS pay_cnt
FROM therapy_sessions s
JOIN therapist_clients c ON c.id = s.client_id
WHERE s.is_paid = false
ORDER BY c.name, s.date
"""


def norm(v):
    return (v or "").strip().lower()


def classify(rows):
    """Разложить неоплаченные сессии по корзинам."""
    buckets = {"copy": [], "copy_partial": [], "other": [], "none": [], "client_empty": []}
    for r in rows:
        acc, dflt = (r["account"] or "").strip(), (r["default_account"] or "").strip()
        if not acc:
            buckets["none"].append(r)
        elif not dflt:
            buckets["client_empty"].append(r)
        elif norm(acc) == norm(dflt):
            (buckets["copy_partial"] if r["pay_cnt"] else buckets["copy"]).append(r)
        else:
            buckets["other"].append(r)
    return buckets


def report(rows, b):
    print(f"Неоплаченных сессий всего: {len(rows)}")
    print(f"  счёт = счёт клиента по умолчанию (без учёта регистра): {len(b['copy']) + len(b['copy_partial'])}"
          f"  (из них с частичным платежом, не трогаем: {len(b['copy_partial'])})")
    print(f"  счёт ОТЛИЧАЕТСЯ от счёта клиента (выбран явно, не трогаем): {len(b['other'])}")
    print(f"  счёт не задан (уже NULL): {len(b['none'])}")
    print(f"  счёт задан, а у клиента счёта по умолчанию нет (не трогаем): {len(b['client_empty'])}")
    print()
    print("К обнулению:", len(b["copy"]))
    by_client = Counter((r["client_name"], r["account"], r["default_account"]) for r in b["copy"])
    for (name, acc, dflt), n in sorted(by_client.items(), key=lambda x: (-x[1], x[0][0] or "")):
        print(f"  {name!r}: {n} сесс., account={acc!r}, у клиента по умолчанию={dflt!r}")
    print("  по статусам:", dict(Counter(r["status"] for r in b["copy"])))
    print("  по написанию счёта:", dict(Counter(r["account"] for r in b["copy"])))
    if b["other"]:
        print("\nОтличающиеся (для справки, не трогаем):")
        grp = Counter((r["client_name"], r["account"], r["default_account"]) for r in b["other"])
        for (name, acc, dflt), n in sorted(grp.items(), key=lambda x: -x[1]):
            print(f"  {name!r}: {n} сесс., account={acc!r}, по умолчанию={dflt!r}")
    if b["copy_partial"]:
        print("\nС частичным платежом (не трогаем):")
        for r in b["copy_partial"]:
            print(f"  {r['client_name']!r} {r['date']} id={r['id']} account={r['account']!r}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="выполнить (по умолчанию — только план)")
    ap.add_argument("--dry-run", action="store_true", help="только план (так и по умолчанию)")
    args = ap.parse_args()
    apply = args.apply and not args.dry_run

    from app.db.session import engine  # noqa: E402

    with engine.connect() as conn:
        if not apply and conn.dialect.name == "postgresql":
            conn.execute(text("SET TRANSACTION READ ONLY"))
        rows = [dict(r._mapping) for r in conn.execute(text(SQL_ROWS))]
        conn.rollback()
    b = classify(rows)
    report(rows, b)

    if not apply:
        print("\nDRY-RUN: ничего не изменено. Для выполнения: --apply")
        return
    if not b["copy"]:
        print("Нечего чистить.")
        return

    os.makedirs(BACKUP_DIR, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = os.path.join(BACKUP_DIR, f"crm_clear_copied_account_{stamp}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(
            [{"id": r["id"], "client_id": r["client_id"], "account": r["account"]} for r in b["copy"]],
            f, ensure_ascii=False, indent=1,
        )
    print(f"Бэкап: {path}")

    ids = [r["id"] for r in b["copy"]]
    with engine.begin() as conn:
        # Условия перепроверяются прямо в UPDATE: если сессию успели оплатить
        # или сменить ей счёт — она не затронется.
        res = conn.execute(
            text(
                "UPDATE therapy_sessions SET account = NULL "
                "WHERE id = ANY(:ids) AND is_paid = false AND account IS NOT NULL "
                "AND lower(btrim(account)) = (SELECT lower(btrim(c.default_account)) "
                "FROM therapist_clients c WHERE c.id = therapy_sessions.client_id)"
            ),
            {"ids": ids},
        )
        print(f"Обнулён счёт у сессий: {res.rowcount} из {len(ids)}")


if __name__ == "__main__":
    main()
