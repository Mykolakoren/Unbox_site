from sqlmodel import Session, select
from app.models.user import User, UserCreate
from app.models.resource import Resource
from app.core.config import settings
from app.core.security import get_password_hash
from app.db.session import engine
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Static Resources Data (Mirrors frontend/src/utils/data.ts)
INITIAL_RESOURCES = [
    # Unbox One (Палиашвили 4, Батуми)
    {
        "id": "unbox_one_room_1",
        "name": "Кабинет 1",
        "type": "cabinet",
        "hourly_rate": 20,
        "capacity": 4,
        "location_id": "unbox_one",
        "area": 9,
        "min_booking_hours": 1,
        "formats": ["individual"],
        "description": "Уютный кабинет с песочной терапией для индивидуальной, детской и семейной работы.",
        "services": ["sandbox", "soundproof", "climate_control", "wifi"]
    },
    {
        "id": "unbox_one_room_2",
        "name": "Кабинет 2",
        "type": "cabinet",
        "hourly_rate": 20,
        "capacity": 4,
        "location_id": "unbox_one",
        "area": 12,
        "min_booking_hours": 1,
        "formats": ["individual"],
        "description": "Кабинет в нейтральных тонах для индивидуальной терапии и семейных консультаций.",
        "services": ["natural_light", "soundproof", "couch", "climate_control", "wifi"]
    },
    # Unbox Uni (Тбел Абусеридзе 38, Батуми)
    {
        "id": "unbox_uni_room_5",
        "name": "Кабинет 5",
        "type": "cabinet",
        "hourly_rate": 20,
        "capacity": 4,
        "location_id": "unbox_uni",
        "area": 10,
        "min_booking_hours": 1,
        "formats": ["individual"],
        "description": "Светлый кабинет для индивидуальной, детской и семейной терапии.",
        "services": ["natural_light", "couch", "climate_control", "wifi"]
    },
    {
        "id": "unbox_uni_room_6",
        "name": "Кабинет 6",
        "type": "cabinet",
        "hourly_rate": 20,
        "capacity": 4,
        "location_id": "unbox_uni",
        "area": 16,
        "min_booking_hours": 1,
        "formats": ["individual"],
        "description": "Просторный кабинет с песочной терапией для индивидуальной работы и работы с детьми.",
        "services": ["sandbox", "natural_light", "couch", "climate_control", "wifi"]
    },
    {
        "id": "unbox_uni_room_7",
        "name": "Кабинет 7",
        "type": "cabinet",
        "hourly_rate": 30,
        "capacity": 20,
        "location_id": "unbox_uni",
        "area": 25,
        "min_booking_hours": 1,
        "formats": ["individual", "group", "intervision"],
        "description": "Большой групповой кабинет для тренингов, лекций, супервизий и мероприятий.",
        "services": ["flipchart", "projector", "whiteboard", "climate_control", "wifi", "natural_light"]
    },
    {
        "id": "unbox_uni_room_8",
        "name": "Кабинет 8",
        "type": "cabinet",
        "hourly_rate": 30,
        "capacity": 20,
        "location_id": "unbox_uni",
        "area": 20,
        "min_booking_hours": 1,
        "formats": ["individual", "group", "intervision"],
        "description": "Просторный групповой кабинет для групповой терапии, воркшопов и обучения.",
        "services": ["flipchart", "whiteboard", "climate_control", "wifi"]
    },
    {
        "id": "unbox_uni_room_9",
        "name": "Кабинет 9",
        "type": "cabinet",
        "hourly_rate": 20,
        "capacity": 10,
        "location_id": "unbox_uni",
        "area": 16,
        "min_booking_hours": 1,
        "formats": ["individual", "group", "intervision"],
        "description": "Уютный кабинет для индивидуальной и групповой работы.",
        "services": ["private_entrance", "couch", "climate_control", "wifi"]
    },
    {
        "id": "unbox_uni_capsule_1",
        "name": "Капсула 1",
        "type": "capsule",
        "hourly_rate": 10,
        "capacity": 1,
        "location_id": "unbox_uni",
        "area": 2,
        "min_booking_hours": 1,
        "formats": ["individual"],
        "description": "Индивидуальная капсула для онлайн-сессий и сосредоточенной работы.",
        "services": ["soundproof", "wifi", "climate_control"]
    },
    {
        "id": "unbox_uni_capsule_2",
        "name": "Капсула 2",
        "type": "capsule",
        "hourly_rate": 10,
        "capacity": 1,
        "location_id": "unbox_uni",
        "area": 2,
        "min_booking_hours": 1,
        "formats": ["individual"],
        "description": "Индивидуальная капсула для онлайн-сессий и сосредоточенной работы.",
        "services": ["soundproof", "wifi", "climate_control"]
    }
]

def init_resources(session: Session):
    existing = session.exec(select(Resource)).first()
    if not existing:
        logger.info("Initializing resources...")
        for res_data in INITIAL_RESOURCES:
            resource = Resource(**res_data)
            session.add(resource)
        session.commit()
        logger.info("Resources initialized.")
    else:
        logger.info("Resources already exist.")

def migrate_add_columns():
    """Add new columns to existing tables (safe to run multiple times)."""
    from sqlalchemy import text

    dialect = engine.dialect.name
    # Postgres requires quoted "user" (reserved keyword); SQLite does not
    user_table = '"user"' if dialect == 'postgresql' else 'user'

    # user table migrations
    user_columns = [
        ("manual_status",         "VARCHAR"),
        ("responsible_admin_id",  "VARCHAR"),
        ("attracted_by_admin_id", "VARCHAR"),
        # JSON column — Postgres JSONB, SQLite TEXT; default empty array
        ("additional_contacts",   "JSONB DEFAULT '[]'::jsonb" if dialect == 'postgresql' else "TEXT DEFAULT '[]'"),
        # Telegram deep-link binding: one-time token + expiry
        ("telegram_link_token",            "VARCHAR"),
        ("telegram_link_token_expires_at", "TIMESTAMP"),
    ]

    for col_name, col_type in user_columns:
        # Each column gets its own connection so a failure doesn't poison the session
        with engine.connect() as conn:
            try:
                if dialect == 'postgresql':
                    # IF NOT EXISTS avoids aborting the transaction in Postgres
                    stmt = f'ALTER TABLE {user_table} ADD COLUMN IF NOT EXISTS {col_name} {col_type}'
                else:
                    stmt = f'ALTER TABLE {user_table} ADD COLUMN {col_name} {col_type}'
                conn.execute(text(stmt))
                conn.commit()
            except Exception:
                conn.rollback()  # reset transaction state before next iteration

    # shift_reports: branch — NULL=global close; non-null=branch-scoped close.
    # Used to filter last_shift baseline per branch (Excel #13 fix).
    with engine.connect() as conn:
        try:
            if dialect == 'postgresql':
                conn.execute(text("ALTER TABLE shift_reports ADD COLUMN IF NOT EXISTS branch VARCHAR"))
            else:
                conn.execute(text("ALTER TABLE shift_reports ADD COLUMN branch VARCHAR"))
            conn.commit()
        except Exception:
            conn.rollback()

    # Backfill shift_reports.branch from the legacy "[Branch] ..." prefix in
    # notes, but only for rows where branch is still NULL.
    # Regex: '[' + one or more non-']' chars + ']'  at the start of notes.
    with engine.connect() as conn:
        try:
            if dialect == 'postgresql':
                conn.execute(text(
                    "UPDATE shift_reports "
                    "SET branch = substring(notes FROM '^\\[([^\\]]+)\\]') "
                    "WHERE branch IS NULL AND notes ~ '^\\[[^\\]]+\\]'"
                ))
            else:
                # SQLite: regex not standard, skip backfill — dev DB is tiny.
                pass
            conn.commit()
        except Exception:
            conn.rollback()

    # cashbox_transactions: credited_user_id — marks transactions that topped up
    # a client's balance, so we can reverse the credit on delete/edit.
    with engine.connect() as conn:
        try:
            if dialect == 'postgresql':
                conn.execute(text("ALTER TABLE cashbox_transactions ADD COLUMN IF NOT EXISTS credited_user_id VARCHAR"))
            else:
                conn.execute(text("ALTER TABLE cashbox_transactions ADD COLUMN credited_user_id VARCHAR"))
            conn.commit()
        except Exception:
            conn.rollback()

    # resource table: services column (JSONB in Postgres, TEXT in SQLite)
    with engine.connect() as conn:
        try:
            if dialect == 'postgresql':
                # Add as JSONB if not exists
                conn.execute(text("ALTER TABLE resource ADD COLUMN IF NOT EXISTS services JSONB DEFAULT '[]'::jsonb"))
                conn.commit()
            else:
                conn.execute(text("ALTER TABLE resource ADD COLUMN services TEXT DEFAULT '[]'"))
                conn.commit()
        except Exception:
            conn.rollback()

    # app_settings: updated_by_user_id was added after the table shipped in
    # an earlier experiment. SQLModel.create_all() only creates missing
    # tables, not missing columns, so this ALTER catches legacy DBs.
    with engine.connect() as conn:
        try:
            if dialect == 'postgresql':
                conn.execute(text("ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS updated_by_user_id VARCHAR"))
            else:
                conn.execute(text("ALTER TABLE app_settings ADD COLUMN updated_by_user_id VARCHAR"))
            conn.commit()
        except Exception:
            conn.rollback()

    # therapy_sessions.recurring_group_id — added so the CRM delete UI can
    # offer "this one" vs "this and all future" the way Google Calendar does.
    # Backwards-compatible: NULL on every row created before the chessboard
    # gained the recurring controls. Indexed because the delete-future flow
    # queries by group_id + date >= cutoff.
    with engine.connect() as conn:
        try:
            if dialect == 'postgresql':
                conn.execute(text("ALTER TABLE therapy_sessions ADD COLUMN IF NOT EXISTS recurring_group_id VARCHAR"))
                conn.execute(text("CREATE INDEX IF NOT EXISTS ix_therapy_sessions_recurring_group_id ON therapy_sessions (recurring_group_id)"))
            else:
                conn.execute(text("ALTER TABLE therapy_sessions ADD COLUMN recurring_group_id VARCHAR"))
            conn.commit()
        except Exception:
            conn.rollback()

    # ── Hot-path indexes (2026-07-13 audit) ───────────────────────────────
    # `booking` carried indexes only on user_id / created_at / payment_status /
    # reminder_sent_at / created_by_id, while ~69 queries filter on date,
    # resource_id and status: the chessboard, every availability check, the
    # analytics sweep and the Telegram digests all ran seq scans. Same story for
    # timelineevent.timestamp, which is ORDER BY DESC'd on the fastest-growing
    # table in the schema (a row per booking/cancel/charge, never pruned).
    #
    # These live here, not as index=True on the models: SQLModel.create_all only
    # creates indexes when it creates the table, so a plain field flag would
    # never reach an existing production table.
    if dialect == 'postgresql':
        _INDEXES = [
            # (resource, date) — the chessboard and check_availability both ask
            # "what is booked in this room on this day", so one composite index
            # serves them and the plain resource_id lookups alike.
            "CREATE INDEX IF NOT EXISTS ix_booking_resource_date ON booking (resource_id, date)",
            # Date-window scans that span rooms: analytics, digests, cron sweeps.
            "CREATE INDEX IF NOT EXISTS ix_booking_date ON booking (date)",
            # find_due_pending() and every "active bookings" listing filter on
            # status first; partial-free plain index keeps it simple.
            "CREATE INDEX IF NOT EXISTS ix_booking_status_date ON booking (status, date)",
            "CREATE INDEX IF NOT EXISTS ix_booking_location_date ON booking (location_id, date)",
            # Audit feed: ORDER BY timestamp DESC LIMIT 50 over the whole table.
            "CREATE INDEX IF NOT EXISTS ix_timelineevent_timestamp ON timelineevent (timestamp DESC)",
            # Cashbox balance aggregates group by payment_method over all history.
            "CREATE INDEX IF NOT EXISTS ix_cashbox_payment_method ON cashbox_transactions (payment_method)",
            # Weekly volume credit: one row per (user, week) — the anti-double-credit
            # journal the model docstring always claimed to be. Until now it was
            # enforced only by a SELECT-before-INSERT, which two parallel runs
            # (cron + the admin button, or two tabs) both pass.
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_weekly_rebate_user_week "
            "ON weekly_rebates (user_id, week_start)",
            # One payment per CRM session. quick-pay now takes a row lock, but the
            # DB is the only thing that can't be raced: a partial unique index
            # (session_id IS NOT NULL) still allows the many ad-hoc payments that
            # carry no session_id at all.
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_therapist_payment_session "
            "ON therapist_payments (session_id) WHERE session_id IS NOT NULL",
        ]
        with engine.connect() as conn:
            for stmt in _INDEXES:
                try:
                    conn.execute(text(stmt))
                    conn.commit()
                except Exception as e:
                    conn.rollback()
                    logger.warning("Index migration skipped (%s): %s", stmt.split()[5], e)

    # Seed the cash-reconciliation category. When a shift closes with a
    # non-zero discrepancy, end_shift writes a balancing CashboxTransaction
    # under this category so the lifetime cash sum stays aligned with the
    # last counted actual_balance — otherwise drift accumulates and every
    # subsequent shift looks like it has "phantom" discrepancies.
    # Stable ID so the backend can hard-code it without a lookup.
    from app.models.expense_category import ExpenseCategory as _EC
    with Session(engine) as ses:
        existing = ses.get(_EC, "cash_reconciliation")
        if not existing:
            ses.add(_EC(
                id="cash_reconciliation",
                name="Расхождение кассы",
                category_type="both",  # used for both income (+) and expense (−) rows
                icon="alert-triangle",
                is_active=True,
            ))
            ses.commit()

    # resource table: convert services from TEXT to JSONB if needed (Postgres only)
    if dialect == 'postgresql':
        with engine.connect() as conn:
            try:
                result = conn.execute(text(
                    "SELECT data_type FROM information_schema.columns "
                    "WHERE table_name = 'resource' AND column_name = 'services'"
                ))
                row = result.fetchone()
                if row and row[0] == 'text':
                    conn.execute(text("ALTER TABLE resource ALTER COLUMN services DROP DEFAULT"))
                    conn.execute(text("ALTER TABLE resource ALTER COLUMN services TYPE JSONB USING services::jsonb"))
                    conn.execute(text("ALTER TABLE resource ALTER COLUMN services SET DEFAULT '[]'::jsonb"))
                    conn.commit()
            except Exception:
                conn.rollback()


# ── One-time Psy-CRM data rescues ────────────────────────────────────────────
# When a user's Telegram/Google binding drifts onto a sibling account and is
# then corrected by hand, the `therapist_*` rows keep the *old* user_id as
# `specialist_id` and become invisible to the CRM. The regular /users/merge
# endpoint can't rescue them because the source UUID isn't a user anymore —
# it's a bare value in the CRM tables.
#
# Each entry here is (source_specialist_id, target_user_id, why). On every
# backend boot we check: if the source still has rows, move them. If the
# count is zero, the migration is a no-op. Fully idempotent, so leaving the
# list in the code after the fact is safe.
#
# Add a row to RESCUES when a specific user reports "my CRM is empty after
# an account mix-up", you've confirmed the orphaned specialist_id in the DB,
# and you want the fix to land on the next backend boot without a bespoke
# API call.
_CRM_RESCUES: list[tuple[str, str, str]] = [
    (
        "350d00e4-42fd-4a1c-b6ae-019f94630e41",
        "9357b575-f6a2-433f-bede-02d7e6cc13db",
        "koren.nikolas@gmail.com — Telegram bind drifted, CRM data orphaned",
    ),
]


def rescue_orphaned_crm():
    """Move orphaned therapist_* rows onto their real owner. Idempotent."""
    from sqlalchemy import text as _text

    CRM_TABLES = (
        "therapist_clients",
        "therapy_sessions",
        "therapist_payments",
        "therapist_notes",
    )

    for src_id, tgt_id, note in _CRM_RESCUES:
        # Fast exit: if the source has no rows anywhere, we already migrated.
        probe_sql = " UNION ALL ".join(
            f"SELECT COUNT(*) FROM {t} WHERE specialist_id = :sid" for t in CRM_TABLES
        )
        with engine.connect() as conn:
            try:
                rows = conn.execute(_text(probe_sql), {"sid": src_id}).fetchall()
                total = sum(int(r[0]) for r in rows)
            except Exception as e:
                logger.warning(f"[CRM rescue] probe failed for {src_id}: {e}")
                continue

        if total == 0:
            logger.debug(f"[CRM rescue] {src_id} → {tgt_id}: already migrated")
            continue

        logger.warning(
            f"[CRM rescue] Moving {total} orphaned rows from {src_id} → {tgt_id} ({note})"
        )

        moved = {}
        for table in CRM_TABLES:
            # Each UPDATE gets its own connection so a failure on one table
            # doesn't poison the others.
            with engine.connect() as conn:
                try:
                    res = conn.execute(
                        _text(
                            f"UPDATE {table} SET specialist_id = :tgt "
                            f"WHERE specialist_id = :src"
                        ),
                        {"src": src_id, "tgt": tgt_id},
                    )
                    moved[table] = int(getattr(res, "rowcount", 0) or 0)
                    conn.commit()
                except Exception as e:
                    logger.error(f"[CRM rescue] {table} update failed: {e}")
                    conn.rollback()
                    moved[table] = -1  # signal failure, don't mask

        logger.warning(f"[CRM rescue] {src_id} → {tgt_id}: moved {moved}")


def auto_backfill_gcal_alias_codes():
    """Walk each specialist's Google Calendar and rewrite matched events
    without `#code` to `Name #code`, so future syncs don't have to guess.
    Idempotent via a timestamp flag in user.crm_data; safe at every boot.
    Per-specialist try/except — one failing calendar can't block others."""
    from datetime import datetime
    from sqlmodel import select as _select
    from app.models.user import User as _User
    from app.models.therapist_client import TherapistClient as _TC

    FLAG_KEY = "gcal_alias_backfill_done_at"

    # Lazy imports: Google client pulls in heavy deps, only needed if anyone
    # actually has a calendar_id. Skip silently otherwise — a dev machine
    # without google credentials shouldn't crash on boot.
    try:
        from app.services.crm_calendar import (
            sync_from_calendar as _sync,
            patch_event_summary,
        )
    except Exception as e:
        logger.debug(f"[GCal backfill] service import failed: {e}")
        return

    with Session(engine) as sess:
        # Find everyone with a configured calendar who hasn't been backfilled.
        users = sess.exec(
            _select(_User).where(_User.role.in_(("specialist", "owner", "senior_admin")))  # type: ignore
        ).all()

        for u in users:
            crm_data = dict(u.crm_data or {})
            if crm_data.get(FLAG_KEY):
                continue
            cal_id = crm_data.get("calendar_id")
            if not cal_id:
                continue

            clients = sess.exec(
                _select(_TC).where(_TC.specialist_id == str(u.id))
            ).all()
            if not clients:
                continue

            try:
                result = _sync(
                    calendar_id=cal_id,
                    clients=clients,
                    months_back=24,
                    months_forward=3,
                )
            except Exception as e:
                logger.warning(f"[GCal backfill] {u.email}: fetch failed: {e}")
                continue  # don't mark as done — retry on next boot

            patched = 0
            failed = 0
            for entry in result.get("matched", []):
                if entry.get("has_alias_code"):
                    continue
                if entry.get("is_recurring"):
                    continue
                # Cancelled events can't be patched (Google rejects) and
                # rewriting their summary is pointless anyway.
                if entry.get("is_cancelled"):
                    continue
                if not entry.get("suggested_summary"):
                    continue
                try:
                    patch_event_summary(cal_id, entry["google_event_id"], entry["suggested_summary"])
                    patched += 1
                except Exception as e:
                    failed += 1
                    logger.debug(f"[GCal backfill] patch failed: {e}")

            logger.warning(
                f"[GCal backfill] {u.email}: patched={patched} "
                f"ambiguous={len(result.get('ambiguous', []))} "
                f"unmatched={len(result.get('unmatched', []))} "
                f"failed={failed}"
            )

            # Mark done — even if some patches failed, we don't want to hammer
            # the API on every boot. Owner can trigger the dedicated endpoint
            # manually if they need a retry.
            crm_data[FLAG_KEY] = datetime.now().isoformat()
            u.crm_data = crm_data
            sess.add(u)
            sess.commit()


def init_data():
    migrate_add_columns()
    rescue_orphaned_crm()
    auto_backfill_gcal_alias_codes()
    with Session(engine) as session:
        
        # Init User — guarded: skip the seed if the operator left the default
        # placeholder in place. This prevents a predictable owner account from
        # landing on production if .env was never configured.
        if settings.FIRST_SUPERUSER_PASSWORD in ("CHANGE_ME_ON_FIRST_DEPLOY", "admin123", ""):
            logger.warning(
                "Skipping first-superuser seed: FIRST_SUPERUSER_PASSWORD is the "
                "default placeholder. Set a real value in .env and re-run."
            )
        else:
            user = session.exec(select(User).where(User.email == settings.FIRST_SUPERUSER)).first()
            if not user:
                logger.info(f"Creating first superuser: {settings.FIRST_SUPERUSER}")
                user_in = UserCreate(
                    email=settings.FIRST_SUPERUSER,
                    password=settings.FIRST_SUPERUSER_PASSWORD,
                    name="Admin",
                    phone="+995000000000",
                    is_admin=True,
                    role="owner",
                )

                user_data = user_in.model_dump()
                del user_data["password"]
                user_data["hashed_password"] = get_password_hash(user_in.password)
                db_obj = User(**user_data)
                session.add(db_obj)
                session.commit()
                logger.info("First superuser created")
            else:
                logger.info("First superuser already exists")

        # Auto-promote configured OWNER_EMAILS at every startup.
        # Why: a real person's email (e.g. koren.nikolas@gmail.com) can lose
        # its owner role — merged into a dupe, accidentally demoted, or never
        # linked to a Google/TG OAuth identity in the first place. Listing
        # the email here means on every backend boot we re-assert the role.
        # It's idempotent and cheap.
        if settings.OWNER_EMAILS:
            owner_emails = [e.strip().lower() for e in settings.OWNER_EMAILS.split(",") if e.strip()]
            for email in owner_emails:
                existing = session.exec(select(User).where(User.email == email)).first()
                if existing:
                    if existing.role != "owner":
                        logger.warning(
                            f"[OWNER_EMAILS] Promoting {email}: {existing.role} → owner"
                        )
                        existing.role = "owner"
                        existing.is_admin = True
                        existing.archived_at = None  # un-archive if accidentally archived
                        session.add(existing)
                        session.commit()
                    else:
                        logger.debug(f"[OWNER_EMAILS] {email} already owner")
                else:
                    logger.info(
                        f"[OWNER_EMAILS] {email} not yet in DB — will be promoted on first OAuth login"
                    )

        # Init Resources
        init_resources(session)
