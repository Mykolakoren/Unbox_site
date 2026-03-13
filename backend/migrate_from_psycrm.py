"""
Миграция данных из psycrm (SQLite/Prisma) в UnboxCRM (Neon Postgres).

Маппинг:
  psycrm.Client   → therapist_clients
  psycrm.Session  → therapy_sessions
  psycrm.Payment  → therapist_payments
  psycrm.Note     → therapist_notes (пустые в psycrm, пропускаем)
  psycrm.TariffHistory → пропускаем (нет аналога)

Запуск:
  # Сухой прогон — только показывает что будет импортировано:
  python migrate_from_psycrm.py

  # Реальный импорт:
  python migrate_from_psycrm.py --execute

  # Указать другой путь к psycrm БД:
  python migrate_from_psycrm.py --execute --psycrm-db /path/to/dev.db
"""
import sys
import sqlite3
import os
from datetime import datetime, timezone

# Добавляем путь к backend чтобы импортировать app
sys.path.insert(0, os.path.dirname(__file__))

from dotenv import load_dotenv
load_dotenv()

from sqlmodel import Session, text
from app.db.session import engine

# Импорт моделей CRM чтобы create_all знал о таблицах
from app.models.therapist_client import TherapistClient
from app.models.therapy_session import TherapySession
from app.models.therapist_payment import TherapistPayment
from app.models.therapist_note import TherapistNote
from sqlmodel import SQLModel

# ─── Конфигурация ────────────────────────────────────────────────
PSYCRM_DB = os.environ.get(
    "PSYCRM_DB",
    "/Users/mykola/.gemini/antigravity/scratch/psy-crm/prisma/dev.db"
)
# Email специалиста в psycrm (фильтрует данные)
SPECIALIST_EMAIL = "koren.nikolas@gmail.com"
DRY_RUN = "--execute" not in sys.argv


def ts_to_dt(ms: int | None) -> datetime | None:
    """Конвертирует миллисекунды (Prisma) в datetime UTC."""
    if ms is None:
        return None
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).replace(tzinfo=None)


def ensure_crm_tables():
    """Создаёт CRM таблицы если не существуют."""
    print("  Создаю CRM таблицы (если не существуют)...")
    tables = [TherapistClient, TherapySession, TherapistPayment, TherapistNote]
    for model in tables:
        model.__table__.create(engine, checkfirst=True)
    print("  ✓ Таблицы готовы")


def get_specialist_id(specialist_email: str) -> str | None:
    """Находит UUID специалиста в UnboxCRM по email."""
    with Session(engine) as session:
        result = session.exec(
            text("SELECT id FROM \"user\" WHERE email = :email"),
            params={"email": specialist_email}
        ).first()
        return str(result[0]) if result else None


def migrate(psycrm_db: str, specialist_id: str, dry_run: bool):
    src = sqlite3.connect(psycrm_db)
    src.row_factory = sqlite3.Row

    # ─── Найти userId специалиста в psycrm ───────────────────────
    user_row = src.execute(
        "SELECT id FROM User WHERE email = ?", (SPECIALIST_EMAIL,)
    ).fetchone()
    if not user_row:
        print(f"  ✗ Пользователь {SPECIALIST_EMAIL} не найден в psycrm")
        return
    psy_user_id = user_row["id"]
    print(f"  psycrm userId: {psy_user_id}")

    # ─── Клиенты ─────────────────────────────────────────────────
    clients = src.execute(
        "SELECT * FROM Client WHERE userId = ?", (psy_user_id,)
    ).fetchall()
    print(f"\n  Клиентов: {len(clients)}")

    # ─── Сессии ──────────────────────────────────────────────────
    client_ids = tuple(c["id"] for c in clients)
    if client_ids:
        placeholders = ",".join("?" * len(client_ids))
        sessions = src.execute(
            f"SELECT * FROM Session WHERE clientId IN ({placeholders})", client_ids
        ).fetchall()
    else:
        sessions = []
    print(f"  Сессий: {len(sessions)}")

    # ─── Платежи ─────────────────────────────────────────────────
    if client_ids:
        payments = src.execute(
            f"SELECT * FROM Payment WHERE clientId IN ({placeholders})", client_ids
        ).fetchall()
    else:
        payments = []
    print(f"  Платежей: {len(payments)}")

    if dry_run:
        print("\n  [DRY RUN] — ничего не записано.")
        print("  Запустите с флагом --execute для реального импорта.\n")

        # Показать примеры
        print("  Примеры клиентов:")
        for c in clients[:5]:
            print(f"    {c['name']} | {c['aliasCode']} | {c['basePrice']} {c['currency']}")

        print("\n  Примеры сессий:")
        for s in sessions[:5]:
            dt = ts_to_dt(s["date"])
            print(f"    {s['clientId'][:12]}... | {dt} | {s['status']} | paid={s['isPaid']}")
        return

    # ─── Реальная запись в UnboxCRM ──────────────────────────────
    print("\n  Начинаю импорт...")
    with Session(engine) as db:

        # Клиенты
        inserted_clients = 0
        skipped_clients = 0
        for c in clients:
            existing = db.exec(
                text("SELECT id FROM therapist_clients WHERE id = :id"),
                params={"id": c["id"]}
            ).first()
            if existing:
                skipped_clients += 1
                continue
            db.exec(text("""
                INSERT INTO therapist_clients
                    (id, specialist_id, name, alias_code, phone, email,
                     base_price, currency, default_account, is_active,
                     tags, notes_text, created_at, updated_at)
                VALUES
                    (:id, :specialist_id, :name, :alias_code, :phone, :email,
                     :base_price, :currency, :default_account, :is_active,
                     :tags, :notes_text, :created_at, :updated_at)
            """), params={
                "id": c["id"],
                "specialist_id": specialist_id,
                "name": c["name"],
                "alias_code": c["aliasCode"],
                "phone": c["phone"],
                "email": None,
                "base_price": float(c["basePrice"]) if c["basePrice"] else 0.0,
                "currency": c["currency"] or "GEL",
                "default_account": c["defaultAccount"] or "Cash",
                "is_active": bool(c["isActive"]),
                "tags": "[]",  # JSON array (empty)
                "notes_text": None,
                "created_at": ts_to_dt(c["createdAt"]) or datetime.utcnow(),
                "updated_at": ts_to_dt(c["updatedAt"]) or datetime.utcnow(),
            })
            inserted_clients += 1
        db.commit()
        print(f"  ✓ Клиенты: {inserted_clients} добавлено, {skipped_clients} пропущено")

        # Сессии
        inserted_sessions = 0
        skipped_sessions = 0
        for s in sessions:
            existing = db.exec(
                text("SELECT id FROM therapy_sessions WHERE id = :id"),
                params={"id": s["id"]}
            ).first()
            if existing:
                skipped_sessions += 1
                continue
            session_date = ts_to_dt(s["date"])
            if not session_date:
                skipped_sessions += 1
                continue
            db.exec(text("""
                INSERT INTO therapy_sessions
                    (id, specialist_id, client_id, date, duration_minutes,
                     status, price, is_paid, is_booked, google_event_id,
                     booking_id, created_at, updated_at)
                VALUES
                    (:id, :specialist_id, :client_id, :date, :duration_minutes,
                     :status, :price, :is_paid, :is_booked, :google_event_id,
                     :booking_id, :created_at, :updated_at)
            """), params={
                "id": s["id"],
                "specialist_id": specialist_id,
                "client_id": s["clientId"],
                "date": session_date,
                "duration_minutes": 60,
                "status": s["status"] or "COMPLETED",
                "price": float(s["price"]) if s["price"] else None,
                "is_paid": bool(s["isPaid"]),
                "is_booked": bool(s["isBooked"]),
                "google_event_id": s["googleEventId"],
                "booking_id": None,
                "created_at": ts_to_dt(s["createdAt"]) or datetime.utcnow(),
                "updated_at": ts_to_dt(s["updatedAt"]) or datetime.utcnow(),
            })
            inserted_sessions += 1
        db.commit()
        print(f"  ✓ Сессии: {inserted_sessions} добавлено, {skipped_sessions} пропущено")

        # Платежи
        inserted_payments = 0
        skipped_payments = 0
        for p in payments:
            existing = db.exec(
                text("SELECT id FROM therapist_payments WHERE id = :id"),
                params={"id": p["id"]}
            ).first()
            if existing:
                skipped_payments += 1
                continue
            payment_date = ts_to_dt(p["date"]) or ts_to_dt(p["createdAt"]) or datetime.utcnow()
            db.exec(text("""
                INSERT INTO therapist_payments
                    (id, specialist_id, client_id, amount, currency, account,
                     date, session_id, created_at)
                VALUES
                    (:id, :specialist_id, :client_id, :amount, :currency, :account,
                     :date, :session_id, :created_at)
            """), params={
                "id": p["id"],
                "specialist_id": specialist_id,
                "client_id": p["clientId"],
                "amount": float(p["amount"]),
                "currency": p["currency"] or "GEL",
                "account": p["account"] or "Cash",
                "date": payment_date,
                "session_id": None,
                "created_at": ts_to_dt(p["createdAt"]) or datetime.utcnow(),
            })
            inserted_payments += 1
        db.commit()
        print(f"  ✓ Платежи: {inserted_payments} добавлено, {skipped_payments} пропущено")

    print("\n  ✅ Миграция завершена успешно!")


def main():
    print("=" * 55)
    print("  Миграция psycrm → UnboxCRM")
    print("=" * 55)
    print(f"  Режим: {'DRY RUN (только просмотр)' if DRY_RUN else '⚡ EXECUTE (реальная запись)'}")
    print(f"  Источник: {PSYCRM_DB}")
    print(f"  Специалист: {SPECIALIST_EMAIL}")
    print()

    # 1. Создаём таблицы CRM
    if not DRY_RUN:
        ensure_crm_tables()

    # 2. Найти specialist_id в UnboxCRM
    specialist_id = get_specialist_id(SPECIALIST_EMAIL)
    if not specialist_id:
        print(f"  ⚠️  Пользователь {SPECIALIST_EMAIL} не найден в UnboxCRM.")
        print("     Убедитесь что он зарегистрирован через Telegram Login.")
        if not DRY_RUN:
            print("     Для принудительного указания ID запустите:")
            print("     SPECIALIST_ID=<uuid> python migrate_from_psycrm.py --execute")
            sys.exit(1)
        # В dry-run показываем данные с заглушкой
        specialist_id = "<specialist-uuid-from-unboxcrm>"
    else:
        print(f"  specialist_id в UnboxCRM: {specialist_id}")

    # 3. Миграция
    migrate(PSYCRM_DB, specialist_id, dry_run=DRY_RUN)


if __name__ == "__main__":
    main()
