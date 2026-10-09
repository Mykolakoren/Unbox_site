"""СТОРОЖ: Psy-CRM — сессия сама привязывается к своей аренде в то же время
(этап 3 «одного календаря», владелец 09.10) и подсказка «Совпадения по
времени» сравнивает по Тбилиси.

Сессия хранит время по Гринвичу, бронь — по Тбилиси. Было: прямое сравнение,
пары со сдвигом на 4 часа (прод 09.10: 3 ложные вместо 41 настоящей).

    python3 backend/tests/guard_crm_autolink_2026_10.py
"""
import os, pathlib, sys
from datetime import datetime, timedelta

ROOT = pathlib.Path(__file__).parent.parent.parent
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "backend" / "tests"))
os.environ.setdefault("ENVIRONMENT", "development")


def _setup():
    import guard_hours_pool_moves as H
    from app.models.booking import Booking
    from app.models.therapist_client import TherapistClient
    s = H._db()
    spec = H._user(s, role="specialist", name="Спец")
    day = (datetime.utcnow() + timedelta(days=2)).replace(hour=0, minute=0, second=0, microsecond=0)
    cli = TherapistClient(specialist_id=str(spec.id), name="Анна", alias_code="4821")
    cli2 = TherapistClient(specialist_id=str(spec.id), name="Олег", alias_code="1190")
    s.add(cli); s.add(cli2); s.commit()

    def bk(hhmm, client_id=None, status="confirmed", owner=spec):
        b = Booking(resource_id="room_1", location_id="unbox_uni", date=day, start_time=hhmm, duration=60,
                    status=status, final_price=20.0, payment_method="balance", payment_status="pending",
                    user_id=owner.email, user_uuid=owner.id, crm_client_id=client_id)
        s.add(b); s.commit(); s.refresh(b)
        return b

    def ses(hh, mm=0, client=cli):
        from app.models.therapy_session import TherapySession
        # Тбилиси hh:mm = UTC hh-4
        t = TherapySession(client_id=client.id, specialist_id=str(spec.id),
                           date=day + timedelta(hours=hh - 4, minutes=mm), duration_minutes=50)
        s.add(t); s.commit(); s.refresh(t)
        return t
    return s, H, spec, cli, cli2, bk, ses


def test_autolink_unique_by_tbilisi_time():
    from app.services.crm_autolink import auto_link, find_pairs
    from app.models.therapy_session import TherapySession
    s, H, spec, cli, cli2, bk, ses = _setup()
    b14 = bk("14:00")
    t14 = ses(14)                                   # совпало по Тбилиси → свяжется
    ses(10)                                         # 10:00 Тб = 06:00 UTC; аренды в 10:00 нет
    bk("06:00")                                     # «старое» сравнение спутало бы с 06:00 UTC
    b16a, b16b = bk("16:00"), bk("16:00")           # две аренды на время — спорно
    t16 = ses(16)
    b18 = bk("18:00", client_id=cli2.id)            # у аренды другой клиент — спорно
    t18 = ses(18)
    bk("12:00", status="cancelled"); t12 = ses(12)  # отменённая аренда не годится
    n = auto_link(s, spec); s.commit()
    assert n == 1, n
    assert s.get(TherapySession, t14.id).booking_id == str(b14.id) and s.get(TherapySession, t14.id).is_booked
    for t in (t16, t18, t12):
        assert s.get(TherapySession, t.id).booking_id is None
    left = {(str(p["session"].id), str(p["booking"].id)) for p in find_pairs(s, spec)}
    assert left == {(t16.id, str(b16a.id)), (t16.id, str(b16b.id)), (t18.id, str(b18.id))}, left
    assert auto_link(s, spec) == 0, "повтор ничего не меняет"


def test_wired_everywhere():
    sess = (ROOT / "backend/app/api/v1/crm/sessions.py").read_text(encoding="utf-8")
    sug = sess[sess.index("def list_merge_suggestions("):sess.index('@router.post("/merge-suggestions/accept")')]
    assert "find_pairs(" in sug and 'strftime("%H:%M")' not in sug, "подсказка снова сравнивает UTC с Тбилиси"
    ac = sess[sess.index("def auto_complete_sessions("):sess.index('@router.post("/sessions", ')]
    assert "auto_link(session, current_user)" in ac
    sync = (ROOT / "backend/app/api/v1/crm/sync.py").read_text(encoding="utf-8")
    assert "auto_linked = auto_link(session, current_user)" in sync and '"auto_linked": auto_linked' in sync
    d = (ROOT / "src/pages/crm/CrmDashboard.tsx").read_text(encoding="utf-8")
    assert "к вашей аренде кабинета — совпало время" in d


if __name__ == "__main__":
    fails = 0
    for n, f in sorted(globals().items()):
        if n.startswith("test_") and callable(f):
            try:
                f(); print(f"  ✓ {n}")
            except AssertionError as e:
                fails += 1; print(f"  ✗ {n}: {e}")
    print("OK" if not fails else f"УПАЛО: {fails}")
    sys.exit(1 if fails else 0)
