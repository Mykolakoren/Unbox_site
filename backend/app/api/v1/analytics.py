"""Owner-аналитика: по центрам/филиалам, загрузка кабинетов, активность админов.

Только для владельца (owner/senior_admin) — содержит финансовые срезы.
Всё считается за период [date_from, date_to] (по умолчанию — текущий месяц).
Помесячные снимки сохраняются в MonthlyMetrics (история).
"""
from datetime import datetime, timedelta, date as _date
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select

from app.api import deps
from app.models.user import User
from app.models.booking import Booking
from app.models.resource import Resource
from app.models.cashbox_transaction import CashboxTransaction
from app.models.monthly_metrics import MonthlyMetrics
from app.core.permissions import ADMIN_ROLES

router = APIRouter()

WORKING_HOURS_PER_DAY = 13  # 09:00–22:00 — знаменатель загрузки
CENTER_NAMES = {"unbox_one": "Unbox One", "unbox_uni": "Unbox Uni", "neo_school": "Neo School"}

# Owner-аналитика — строго персональный доступ (owner попросил «только мне»
# 2026-07-11). Не роль, а конкретный аккаунт: системный Admin и senior_admin
# не должны видеть. Чтобы дать доступ ещё кому-то — добавить email сюда.
PRIVATE_OWNER_EMAILS = {"koren.nikolas@gmail.com"}


def _require_owner(current_user: User = Depends(deps.get_current_user)) -> User:
    if (current_user.email or "").strip().lower() not in PRIVATE_OWNER_EMAILS:
        raise HTTPException(status_code=403, detail="Доступно только владельцу")
    return current_user


def _parse_range(date_from: Optional[str], date_to: Optional[str]) -> tuple[datetime, datetime, int]:
    today = datetime.utcnow().date()
    d0 = _date.fromisoformat(date_from[:10]) if date_from else today.replace(day=1)
    d1 = _date.fromisoformat(date_to[:10]) if date_to else today
    if d1 < d0:
        d0, d1 = d1, d0
    start = datetime(d0.year, d0.month, d0.day)
    end = datetime(d1.year, d1.month, d1.day) + timedelta(days=1)
    return start, end, max(1, (d1 - d0).days + 1)


def compute_owner_analytics(session: Session, start: datetime, end: datetime, days: int) -> dict:
    """Считает все разрезы за период. Переиспользуется эндпоинтом и снапшотом."""
    bookings = session.exec(
        select(Booking).where(Booking.status == "confirmed", Booking.date >= start, Booking.date < end)
    ).all()
    resources = session.exec(select(Resource)).all()
    txs = session.exec(
        select(CashboxTransaction).where(CashboxTransaction.date >= start, CashboxTransaction.date < end)
    ).all()

    rooms_by_center: dict[str, int] = {}
    room_names: dict[str, str] = {}
    room_center: dict[str, str] = {}
    for r in resources:
        room_names[r.id] = r.name
        room_center[r.id] = r.location_id
        if getattr(r, "is_active", True):
            rooms_by_center[r.location_id] = rooms_by_center.get(r.location_id, 0) + 1

    centers: dict[str, dict] = {}
    per_room: dict[str, dict] = {}
    for b in bookings:
        loc = b.location_id or room_center.get(b.resource_id) or "—"
        hrs = (b.duration or 0) / 60.0
        c = centers.setdefault(loc, {"revenue": 0.0, "bookings": 0, "hours": 0.0})
        c["revenue"] += float(b.final_price or 0); c["bookings"] += 1; c["hours"] += hrs
        rr = per_room.setdefault(b.resource_id, {"hours": 0.0, "bookings": 0, "revenue": 0.0})
        rr["hours"] += hrs; rr["bookings"] += 1; rr["revenue"] += float(b.final_price or 0)

    by_center = []
    for loc, c in centers.items():
        rooms = rooms_by_center.get(loc, 0)
        avail = rooms * WORKING_HOURS_PER_DAY * days
        by_center.append({
            "location_id": loc, "name": CENTER_NAMES.get(loc, loc),
            "revenue": round(c["revenue"], 2), "bookings": c["bookings"], "hours": round(c["hours"], 1),
            "avg_check": round(c["revenue"] / c["bookings"], 2) if c["bookings"] else 0,
            "rooms": rooms, "available_hours": avail,
            "occupancy_pct": round(c["hours"] / avail * 100, 1) if avail else 0,
        })
    by_center.sort(key=lambda x: x["revenue"], reverse=True)

    by_room = []
    for rid, rr in per_room.items():
        avail = WORKING_HOURS_PER_DAY * days
        by_room.append({
            "resource_id": rid, "name": room_names.get(rid, rid), "location_id": room_center.get(rid, "—"),
            "hours": round(rr["hours"], 1), "bookings": rr["bookings"], "revenue": round(rr["revenue"], 2),
            "occupancy_pct": round(rr["hours"] / avail * 100, 1) if avail else 0,
        })
    by_room.sort(key=lambda x: x["occupancy_pct"], reverse=True)

    admin_fin: dict[str, dict] = {}
    for t in txs:
        aid = t.admin_id or "—"
        a = admin_fin.setdefault(aid, {"name": t.admin_name or aid, "income": 0.0, "expense": 0.0, "ops": 0})
        if t.admin_name:
            a["name"] = t.admin_name
        if (t.type or "") == "income":
            a["income"] += float(t.amount or 0)
        elif (t.type or "") == "expense":
            a["expense"] += float(t.amount or 0)
        a["ops"] += 1

    users = {str(u.id): u for u in session.exec(select(User)).all()}
    admin_bookings: dict[str, dict] = {}
    tracked = 0
    for b in bookings:
        cid = b.created_by_id
        if not cid:
            continue
        u = users.get(str(cid))
        if not u or u.role not in ADMIN_ROLES:
            continue
        tracked += 1
        a = admin_bookings.setdefault(str(cid), {"name": b.created_by_name or (u.name if u else cid), "bookings": 0, "revenue": 0.0})
        a["bookings"] += 1; a["revenue"] += float(b.final_price or 0)

    by_admin = []
    for aid in set(admin_fin) | set(admin_bookings):
        fin = admin_fin.get(aid, {}); bk = admin_bookings.get(aid, {})
        by_admin.append({
            "admin_id": aid, "name": bk.get("name") or fin.get("name") or aid,
            "cash_income": round(fin.get("income", 0), 2), "cash_expense": round(fin.get("expense", 0), 2),
            "cash_ops": fin.get("ops", 0),
            "bookings_created": bk.get("bookings", 0), "bookings_revenue": round(bk.get("revenue", 0), 2),
        })
    by_admin.sort(key=lambda x: (x["cash_income"] + x["bookings_revenue"]), reverse=True)

    total_revenue = round(sum(c["revenue"] for c in centers.values()), 2)
    total_hours = round(sum(c["hours"] for c in centers.values()), 1)
    total_bookings = sum(c["bookings"] for c in centers.values())
    total_avail = sum(x["available_hours"] for x in by_center)

    return {
        "period": {"from": start.strftime("%Y-%m-%d"), "to": (end - timedelta(days=1)).strftime("%Y-%m-%d"), "days": days},
        "summary": {
            "revenue": total_revenue, "bookings": total_bookings, "hours": total_hours,
            "occupancy_pct": round(total_hours / total_avail * 100, 1) if total_avail else 0,
            "avg_check": round(total_revenue / total_bookings, 2) if total_bookings else 0,
        },
        "by_center": by_center, "by_room": by_room, "by_admin": by_admin,
        "admin_bookings_tracked": tracked,
    }


@router.get("/owner")
def owner_analytics(
    date_from: Optional[str] = Query(None, description="YYYY-MM-DD"),
    date_to: Optional[str] = Query(None, description="YYYY-MM-DD"),
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(_require_owner),
) -> Any:
    start, end, days = _parse_range(date_from, date_to)
    return compute_owner_analytics(session, start, end, days)


def _month_bounds(year: int, month: int) -> tuple[datetime, datetime, int]:
    start = datetime(year, month, 1)
    end = datetime(year + 1, 1, 1) if month == 12 else datetime(year, month + 1, 1)
    return start, end, (end - start).days


def save_monthly_snapshot(session: Session, year: int, month: int) -> MonthlyMetrics:
    """Считает и сохраняет снимок за месяц (year, month). Идемпотентно по month."""
    start, end, days = _month_bounds(year, month)
    data = compute_owner_analytics(session, start, end, days)
    key = f"{year:04d}-{month:02d}"
    row = session.exec(select(MonthlyMetrics).where(MonthlyMetrics.month == key)).first()
    if not row:
        row = MonthlyMetrics(month=key)
    s = data["summary"]
    row.revenue = s["revenue"]; row.bookings = s["bookings"]; row.hours = s["hours"]
    row.occupancy_pct = s["occupancy_pct"]; row.avg_check = s["avg_check"]
    row.data = data
    row.created_at = datetime.utcnow()
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


@router.post("/snapshot")
def trigger_snapshot(
    month: Optional[str] = Query(None, description="YYYY-MM; по умолчанию прошлый месяц"),
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(_require_owner),
) -> Any:
    if month:
        y, m = int(month[:4]), int(month[5:7])
    else:
        today = datetime.utcnow().date()
        first = today.replace(day=1)
        prev = first - timedelta(days=1)
        y, m = prev.year, prev.month
    row = save_monthly_snapshot(session, y, m)
    return {"ok": True, "month": row.month, "revenue": row.revenue, "bookings": row.bookings,
            "hours": row.hours, "occupancy_pct": row.occupancy_pct}


@router.get("/history")
def monthly_history(
    limit: int = Query(24, ge=1, le=120),
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(_require_owner),
) -> Any:
    rows = session.exec(select(MonthlyMetrics).order_by(MonthlyMetrics.month.desc()).limit(limit)).all()  # type: ignore
    return [
        {"month": r.month, "revenue": r.revenue, "bookings": r.bookings, "hours": r.hours,
         "occupancy_pct": r.occupancy_pct, "avg_check": r.avg_check, "data": r.data}
        for r in rows
    ]
