"""СТОРОЖ: «вырезать часть брони» — в этой и всех следующих бронях серии (чат админов 24.11).

Повод: Валентина — клиентка отказалась от одного часа из постоянной брони 3 ч;
админка умела резать только одну бронь, пришлось делить и удалять час в
каждой неделе до конца года.

Что держит:
  1  Серия ×4 по 12:00–15:00 (деньги, ещё не списаны): «эту и следующие» без
     последнего часа → все 4 стали 12:00–14:00, цена пересчитана, баланс не
     тронут, лента сходится.
  2  Из середины (13:00–14:00) начиная со 2-й брони: 1-я не тронута; у 2–4
     остались 12–13 (в старой серии) и 14–15 — эти правые половинки ОДНОЙ новой
     серией (иначе «отменить эту и следующие» их бы не задел).
  3  Неделя, где бронь в другое время или другой длины, пропускается с понятной
     причиной; бронь не из серии — отказ.
  4  Сайт: окно «Отменить часть брони» спрашивает «только эту / эту и все
     следующие» и зовёт /trim-series; в шахматке админа есть «Вырезать часть».

    python3 backend/tests/guard_series_trim_2026_11.py
"""
import os
import pathlib
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, ".."))
os.environ.setdefault("ENVIRONMENT", "development")
ROOT = pathlib.Path(HERE).resolve().parents[1]


def _mh():
    import guard_money_holes_2026_10 as mh
    return mh


def _series3h(mh, s, admin, u, *, days, occurrences=4):
    from fastapi import BackgroundTasks
    from sqlmodel import select
    from app.api.v1.bookings import routes
    out = routes.create_recurring_booking(
        background_tasks=BackgroundTasks(), session=s, current_user=admin,
        data=routes.RecurringBookingRequest(
            resource_id="room_1", location_id="unbox_uni", start_time="12:00", duration=180,
            format="individual", payment_method="balance",
            first_date=mh.H._day(days).strftime("%Y-%m-%d"), occurrences=occurrences,
            target_user_id=str(u.id)))
    s.commit()
    return out["recurring_group_id"], s.exec(
        select(mh.Booking).where(mh.Booking.recurring_group_id == out["recurring_group_id"])
        .order_by(mh.Booking.date)).all()


def _trim_series(mh, s, actor, b, frm, to):
    from fastapi import BackgroundTasks
    from app.api.v1.bookings import routes
    out = mh.H._call(routes.trim_booking_series, booking_id=str(b.id), background_tasks=BackgroundTasks(),
                     data=routes.TrimRequest(remove_from=frm, remove_to=to), session=s, current_user=actor)
    s.commit()
    return out


def test_series_trim_edge_and_middle():
    mh = _mh()

    @mh._scenario
    def run():
        from sqlmodel import select
        s = mh._db()
        admin = mh._admin(s)

        # 1 — последний час во всей серии
        u = mh._client(s, None, balance=300.0)
        gid, rows = _series3h(mh, s, admin, u, days=3)
        assert len(rows) == 4 and all(r.payment_status == "pending" for r in rows), [r.payment_status for r in rows]
        full = float(rows[0].final_price)
        out = _trim_series(mh, s, admin, rows[0], "14:00", "15:00")
        assert out.get("trimmed") == 4 and not out.get("skipped"), out
        s.expire_all()
        rows = s.exec(select(mh.Booking).where(mh.Booking.recurring_group_id == gid).order_by(mh.Booking.date)).all()
        assert [(r.start_time, r.duration) for r in rows] == [("12:00", 120)] * 4, [(r.start_time, r.duration) for r in rows]
        assert all(0 < float(r.final_price) < full for r in rows), [r.final_price for r in rows]
        assert mh._bal(s, u) == 300.0, "1: будущие брони ещё не оплачены — баланс не трогаем"
        mh._ledger_ok(s, u, 300.0)
        assert out.get("new_group_id") is None

        # 2 — час из середины, начиная со 2-й брони
        v = mh._client(s, None, balance=300.0)
        gid2, rows2 = _series3h(mh, s, admin, v, days=40)
        out2 = _trim_series(mh, s, admin, rows2[1], "13:00", "14:00")
        assert out2.get("trimmed") == 3 and not out2.get("skipped"), out2
        new_gid = out2.get("new_group_id")
        assert new_gid and new_gid != gid2, out2
        s.expire_all()
        old = s.exec(select(mh.Booking).where(mh.Booking.recurring_group_id == gid2).order_by(mh.Booking.date)).all()
        assert [(r.start_time, r.duration) for r in old] == [("12:00", 180)] + [("12:00", 60)] * 3, \
            [(r.start_time, r.duration) for r in old]
        new = s.exec(select(mh.Booking).where(mh.Booking.recurring_group_id == new_gid).order_by(mh.Booking.date)).all()
        assert [(r.start_time, r.duration) for r in new] == [("14:00", 60)] * 3, [(r.start_time, r.duration) for r in new]
        assert [r.date for r in new] == [r.date for r in old[1:]]
        assert mh._bal(s, v) == 300.0
        mh._ledger_ok(s, v, 300.0)

        # 3 — неделя другой длины пропускается; бронь не из серии — отказ
        w = mh._client(s, None, balance=300.0)
        gid3, rows3 = _series3h(mh, s, admin, w, days=80, occurrences=3)
        odd = s.get(mh.Booking, rows3[2].id)
        odd.duration = 120
        s.add(odd)
        s.commit()
        out3 = _trim_series(mh, s, admin, rows3[0], "12:00", "13:00")
        assert out3.get("trimmed") == 2 and len(out3.get("skipped") or []) == 1, out3
        assert "в эту неделю бронь другая" in out3["skipped"][0]["reason"], out3["skipped"]
        single = mh._book(s, admin, w, days=120, start="12:00", minutes=180, method="balance")
        bad = _trim_series(mh, s, admin, single, "12:00", "13:00")
        assert isinstance(bad, dict) and bad.get("http") == 400, bad

    run()


def test_front_offers_series_scope():
    api = (ROOT / "src/api/bookings.ts").read_text(encoding="utf-8")
    assert "/trim-series" in api, "4: нет вызова /trim-series"
    modal = (ROOT / "src/components/TrimBookingModal.tsx").read_text(encoding="utf-8")
    assert "recurringGroupId" in modal and "Эту и все следующие" in modal and "trimBookingSeries" in modal, \
        "4: окно вырезки не спрашивает про серию"
    for rel in ("src/components/crm/CrmChessboardView.tsx", "src/pages/MyBookingsPage.tsx",
                "src/pages/mobile/BookingDetailSheet.tsx", "src/components/admin/AdminChessboardView.tsx"):
        c = (ROOT / rel).read_text(encoding="utf-8")
        assert "<TrimBookingModal" in c and "recurringGroupId:" in c, f"4: {rel} не передаёт серию в окно вырезки"
    chess = (ROOT / "src/components/admin/AdminChessboardView.tsx").read_text(encoding="utf-8")
    assert "Вырезать часть" in chess, "4: в шахматке админа нет «Вырезать часть»"


if __name__ == "__main__":
    for name, fn in sorted(dict(globals()).items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("  ✓", name)
    print("СТОРОЖ series_trim: OK")
