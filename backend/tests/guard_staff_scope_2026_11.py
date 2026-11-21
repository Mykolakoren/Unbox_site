"""СТОРОЖ: кто из администраторов что может менять (переезд, 21.11.2026).

Решение владельца: в UNBOX 99 администратор один — Валентина. Елизавета и Егор
до 30.11 работают в старых центрах, но в UNBOX 99 чужие брони не трогают;
с 01.12 у них «только просмотр». Кабинет 1 в UNBOX 99 закреплён за владельцем:
виден всем, бронь — только на людей из списка. У Егора при этом своя серия
броней до конца 2027 — своё он должен вести сам. Что не должно сломаться:
  A  закреплённый кабинет: бронь на чужого не проходит, на своего — проходит;
  B  администратор не из списка филиала не меняет чужие брони, блокировки и
     карточки кабинетов этого филиала, а свои брони ставит; старые центры — как раньше;
  C  «только просмотр»: до даты — как обычно; с даты — чужое и админские
     разделы закрыты, своё (брони, профиль, Psy-CRM) открыто;
  D  владелец, клиенты и специалисты турникет не замечают;
  E  список «что можно в режиме просмотра» записан явно — новая изменяющая
     ручка по умолчанию закрыта, пока её сюда не внесли осознанно;
  F  турникет стоит на входе всего API и не съедает тело запроса;
  G  опечатка в дате «только просмотр» не снимает ограничение молча;
  H  находки ревизии 21.11 закрыты: id брони без дефисов, старые брони без
     user_uuid, новый кабинет в чужом филиале, служебные поля не задаются
     через формы, лист ожидания и кнопки бота, аналитика;
  I  турникет читает тело и без заголовка «это JSON»;
  J  свои брони в режиме «только просмотр» — без админских послаблений; id брони
     узнаётся в любой записи; чужую запись листа ожидания снять нельзя.

Без сети и боевой базы: SQLite в памяти.

    python3 backend/tests/guard_staff_scope_2026_11.py
"""
import os
import sys
from datetime import date, datetime
from uuid import UUID, uuid4

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("ENVIRONMENT", "development")

VALYA = UUID("00000000-0000-0000-0000-00000000000a")
LIZA = UUID("00000000-0000-0000-0000-00000000000b")
EGOR = UUID("00000000-0000-0000-0000-00000000000c")
OWNER = UUID("00000000-0000-0000-0000-00000000000d")
CLIENT = UUID("00000000-0000-0000-0000-00000000000e")
SPEC = UUID("00000000-0000-0000-0000-00000000000f")

BEFORE, AFTER = date(2026, 11, 25), date(2026, 12, 1)


def _engine():
    from sqlalchemy.pool import StaticPool
    from sqlmodel import SQLModel, create_engine
    import app.models  # noqa: F401 — регистрирует все таблицы
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(eng)
    return eng


def _fill(s):
    from app.models.booking import Booking
    from app.models.location import Location
    from app.models.resource import Resource
    from app.models.user import User
    s.add(Location(id="unbox_uni", name="Unbox Uni", address="—"))
    s.add(Location(id="unbox_99", name="UNBOX 99", address="—", staff_ids=[str(VALYA)]))
    s.add(Resource(id="uni_5", name="Кабинет 5", type="cabinet", location_id="unbox_uni",
                   hourly_rate=20, capacity=4, area=10))
    s.add(Resource(id="n99_1", name="Кабинет 1", type="cabinet", location_id="unbox_99",
                   hourly_rate=20, capacity=4, area=10, allowed_user_ids=[str(OWNER)]))
    s.add(Resource(id="n99_2", name="Кабинет 2", type="cabinet", location_id="unbox_99",
                   hourly_rate=20, capacity=4, area=10))
    for uid, name, role, vo in (
        (VALYA, "Валентина", "admin", None), (LIZA, "Елизавета", "admin", "2026-12-01"),
        (EGOR, "Егор", "senior_admin", "2026-12-01"), (OWNER, "Николай", "owner", "2026-12-01"),
        (CLIENT, "Клиент", "user", None), (SPEC, "Специалист", "specialist", "2026-12-01"),
    ):
        s.add(User(id=uid, email=f"{name}@x.ge", name=name, role=role, hashed_password="x", view_only_from=vo))
    ids = {}
    for key, owner, room, grp in (
        ("egor_own", EGOR, "uni_5", "series-egor"), ("client_uni", CLIENT, "uni_5", None),
        ("client_99", CLIENT, "n99_2", "series-client"), ("liza_99", LIZA, "n99_2", None),
    ):
        b = Booking(id=uuid4(), resource_id=room, location_id="x", date=datetime(2026, 12, 3),
                    start_time="10:00", duration=60, status="confirmed", final_price=20,
                    payment_method="balance", format="individual",
                    user_id=str(owner), user_uuid=owner, recurring_group_id=grp)
        s.add(b)
        ids[key] = str(b.id)
    s.commit()
    return ids


def _world():
    from sqlmodel import Session
    s = Session(_engine())
    return s, _fill(s)


def _why(s, who, method, path, body=None, today=BEFORE):
    from app.models.user import User
    from app.services.staff_scope import write_refusal
    return write_refusal(s, s.get(User, who), method, path, body, today=today)


def test_a_pinned_room_only_for_listed_people():
    from app.services.booking import check_availability
    s, _ = _world()
    day = datetime(2026, 12, 3)
    ok, why = check_availability(s, "n99_1", day, "10:00", 60, requester_user_uuid=CLIENT)
    assert not ok and "закреплён" in why and "Кабинет 1" in why, why
    assert not check_availability(s, "n99_1", day, "10:00", 60)[0], "без хозяина брони — отказ"
    assert not check_availability(s, "n99_1", day, "10:00", 60, requester_user_uuid=VALYA)[0], \
        "администратор не может поставить в закреплённый кабинет бронь на себя"
    assert check_availability(s, "n99_1", day, "10:00", 60, requester_user_uuid=OWNER)[0]
    assert check_availability(s, "n99_1", day, "10:00", 60, skip_room_access=True)[0]
    assert check_availability(s, "n99_2", day, "12:00", 60, requester_user_uuid=CLIENT)[0], \
        "обычный кабинет остаётся для всех"


def test_b_branch_is_run_by_its_admins():
    s, ids = _world()
    foreign = {"resource_id": "n99_2", "target_user_id": str(CLIENT)}
    why = _why(s, LIZA, "POST", "/bookings/", foreign)
    assert why and "UNBOX 99" in why and "Валентина" in why, why
    assert _why(s, EGOR, "POST", "/bookings/recurring", foreign)
    assert _why(s, LIZA, "POST", "/bookings/multi-slot",
                {"target_user_id": str(CLIENT), "slots": [{"resource_id": "uni_5"}, {"resource_id": "n99_2"}]})
    # своя бронь в новом центре — как у любого клиента
    assert _why(s, LIZA, "POST", "/bookings/", {"resource_id": "n99_2"}) is None
    assert _why(s, LIZA, "POST", "/bookings/", {"resource_id": "n99_2", "target_user_id": str(LIZA)}) is None
    assert _why(s, LIZA, "DELETE", f"/bookings/{ids['liza_99']}") is None
    # админское действие даже над своей бронью — работа администратора центра
    assert _why(s, LIZA, "PATCH", f"/bookings/{ids['liza_99']}/price", {"price": 0})
    # чужая бронь в новом центре: отмена, перенос, серия
    assert _why(s, LIZA, "DELETE", f"/bookings/{ids['client_99']}")
    assert _why(s, EGOR, "PATCH", f"/bookings/{ids['client_99']}/reschedule", {"new_date": "2026-12-04"})
    assert _why(s, LIZA, "DELETE", "/bookings/recurring/series-client")
    assert _why(s, LIZA, "POST", f"/billing/bookings/{ids['client_99']}/waive", {})
    # перенос чужой брони ИЗ старого центра В новый — тоже работа Валентины
    assert _why(s, LIZA, "PATCH", f"/bookings/{ids['client_uni']}/reschedule", {"new_resource_id": "n99_2"})
    # старый центр — как раньше
    assert _why(s, LIZA, "POST", "/bookings/", {"resource_id": "uni_5", "target_user_id": str(CLIENT)}) is None
    assert _why(s, LIZA, "DELETE", f"/bookings/{ids['client_uni']}") is None
    assert _why(s, LIZA, "POST", "/maintenance-blocks/", {"resource_id": "uni_5"}) is None
    # блокировки и карточки кабинетов нового центра
    assert _why(s, LIZA, "POST", "/maintenance-blocks/", {"resource_id": "n99_2"})
    assert _why(s, LIZA, "PUT", "/resources/n99_2", {"hourly_rate": 1})
    assert _why(s, EGOR, "PUT", "/locations/unbox_99", {"name": "x"})
    # Валентина и владелец — можно всё
    for who in (VALYA, OWNER):
        assert _why(s, who, "POST", "/bookings/", foreign) is None
        assert _why(s, who, "DELETE", f"/bookings/{ids['client_99']}") is None
        assert _why(s, who, "PUT", "/resources/n99_2", {"hourly_rate": 20}) is None


def test_c_view_only_from_date():
    s, ids = _world()
    admin_work = [
        ("POST", "/cashbox/transactions", {"amount": 5}),
        ("POST", f"/users/{CLIENT}/subscription/sell", {}),
        ("POST", f"/users/{CLIENT}/balance-correction", {}),
        ("PATCH", f"/users/{CLIENT}", {"name": "x"}),
        ("PATCH", f"/users/{CLIENT}/permissions", {}),
        ("POST", "/bonuses/", {}),
        ("POST", "/maintenance-blocks/", {"resource_id": "uni_5"}),
        ("PUT", "/resources/uni_5", {}),
        ("POST", "/admin/tasks/", {}),
        ("POST", f"/crm/access-requests/{CLIENT}/approve", {}),
        ("POST", "/bookings/", {"resource_id": "uni_5", "target_user_id": str(CLIENT)}),
        ("DELETE", f"/bookings/{ids['client_uni']}", None),
        ("POST", f"/bookings/{ids['client_uni']}/approve", None),
        ("PATCH", f"/bookings/{ids['egor_own']}/price", {"price": 0}),
        ("POST", f"/billing/bookings/{ids['egor_own']}/waive", {}),
    ]
    own = [
        ("POST", "/bookings/", {"resource_id": "uni_5"}),
        ("POST", "/bookings/recurring", {"resource_id": "n99_2"}),
        ("DELETE", f"/bookings/{ids['egor_own']}", None),
        ("PATCH", f"/bookings/{ids['egor_own']}/reschedule", {"new_resource_id": "n99_2"}),
        ("POST", "/bookings/recurring/series-egor/extend", {}),
        ("DELETE", "/bookings/recurring/series-egor", None),
        ("PATCH", "/users/me", {"phone": "1"}),
        ("POST", "/auth/change-password", {}),
        ("POST", "/notifications/read-all", None),
        ("POST", "/crm/sessions", {}),
        ("PATCH", "/crm/clients/abc", {}),
        ("POST", "/bookings/check-availability", None),
        ("POST", "/pricing/quote", {}),
    ]
    from app.services.staff_scope import VIEW_ONLY_TEXT
    for method, path, body in admin_work:
        if "price" in path or "waive" in path:
            continue  # до даты это решает правило филиала, не «просмотр»
        assert _why(s, EGOR, method, path, body, today=BEFORE) is None, f"до 01.12 Егор работает как обычно: {path}"
    for method, path, body in admin_work:
        assert _why(s, EGOR, method, path, body, today=AFTER) == VIEW_ONLY_TEXT, f"с 01.12 закрыто: {method} {path}"
    for method, path, body in own:
        assert _why(s, EGOR, method, path, body, today=AFTER) is None, f"своё должно остаться: {method} {path}"
    # чтение — всегда
    assert _why(s, EGOR, "GET", "/cashbox/transactions", today=AFTER) is None


def test_d_owner_clients_specialists_untouched():
    s, ids = _world()
    for who in (OWNER, CLIENT, SPEC):
        for method, path, body in (
            ("POST", "/cashbox/transactions", {}), ("POST", "/bookings/", {"resource_id": "n99_2"}),
            ("DELETE", f"/bookings/{ids['client_99']}", None), ("PUT", "/resources/n99_2", {}),
        ):
            assert _why(s, who, method, path, body, today=AFTER) is None, (who, path)
    from app.services.staff_scope import write_refusal
    assert write_refusal(s, None, "POST", "/cashbox/transactions", {}) is None, "без входа решают сами ручки"


# E. Всё, что администратор «только просмотр» может менять кроме своих броней.
VIEW_ONLY_MAY_WRITE = {
    "POST /auth/change-password", "POST /auth/google", "POST /auth/login", "POST /auth/refresh",
    "POST /auth/register", "POST /auth/telegram",
    "POST /crm/apply", "POST /crm/clients", "POST /crm/clients/merge", "DELETE /crm/clients/{client_id}",
    "PATCH /crm/clients/{client_id}", "POST /crm/clients/{client_id}/mark-all-paid",
    "POST /crm/clients/{client_id}/sync-history", "POST /crm/merge-suggestions/accept", "POST /crm/notes",
    "DELETE /crm/notes/{note_id}", "PUT /crm/payment-accounts", "POST /crm/payments",
    "DELETE /crm/payments/{payment_id}", "PATCH /crm/payments/{payment_id}", "POST /crm/sessions",
    "POST /crm/sessions/auto-complete", "DELETE /crm/sessions/{session_id}", "PATCH /crm/sessions/{session_id}",
    "POST /crm/sessions/{session_id}/detach-cabinet", "POST /crm/sessions/{session_id}/quick-pay",
    "POST /crm/sessions/{session_id}/unmark-paid", "PATCH /crm/settings", "POST /crm/sync/auto",
    "POST /crm/sync/backfill-alias-codes", "POST /crm/sync/calendar",
    "POST /notifications/read-all", "POST /notifications/{notification_id}/read",
    "POST /pricing/quote", "POST /bookings/check-availability", "POST /bookings/recurring/quote",
    "PATCH /specialists/me", "POST /specialists/apply", "POST /specialists/{specialist_id}/appointments",
    "POST /telegram/link-token", "POST /upload/", "PATCH /users/me", "POST /users/me/vacation",
    "POST /waitlist/",   # снять запись из листа ожидания можно только свою — тест J
}


def test_e_view_only_whitelist_is_explicit():
    from app.core.config import settings
    from app.main import app
    from app.models.user import User
    from app.services.staff_scope import write_refusal
    s, _ = _world()
    egor = s.get(User, EGOR)
    allowed = set()
    for r in app.routes:
        path = getattr(r, "path", "")
        if not path.startswith(settings.API_V1_STR):
            continue
        short = path[len(settings.API_V1_STR):]
        for method in (getattr(r, "methods", None) or ()):
            if method in ("GET", "HEAD", "OPTIONS"):
                continue
            if short.startswith("/bookings/") and short not in (
                    "/bookings/check-availability", "/bookings/recurring/quote"):
                continue  # брони проверяются по хозяину — тест C
            if short.startswith("/billing/bookings/"):
                continue
            # {…} в адресе — заведомо чужой/несуществующий объект
            if write_refusal(s, egor, method, short, {}, today=AFTER) is None:
                allowed.add(f"{method} {short}")
    extra, missing = allowed - VIEW_ONLY_MAY_WRITE, VIEW_ONLY_MAY_WRITE - allowed
    assert not extra, f"режим «только просмотр» пускает лишнее: {sorted(extra)}"
    assert not missing, f"режим «только просмотр» закрыл своё: {sorted(missing)}"


def test_f_gate_is_on_whole_api_and_keeps_body():
    src = open(os.path.join(os.path.dirname(__file__), "..", "app", "main.py"), encoding="utf-8").read()
    assert "dependencies=[_Depends(enforce_staff_scope)]" in src, "турникет должен стоять на всём API"

    from fastapi.testclient import TestClient
    from sqlmodel import Session
    from app.core import security
    from app.db.session import get_session
    from app.main import app
    from app.models.user import User
    from app.services.staff_scope import VIEW_ONLY_TEXT
    eng = _engine()
    with Session(eng) as s:
        _fill(s)
        liza = s.get(User, LIZA)
        liza.view_only_from = "2020-01-01"  # уже наступило
        s.add(liza)
        s.commit()

    def _sess():
        with Session(eng) as s:
            yield s
    app.dependency_overrides[get_session] = _sess
    try:
        c = TestClient(app)  # без with: запуск приложения (боевая база) не нужен
        liza_h = {"Authorization": f"Bearer {security.create_access_token(LIZA)}"}
        valya_h = {"Authorization": f"Bearer {security.create_access_token(VALYA)}"}
        r = c.post("/api/v1/cashbox/categories", json={"name": "x"}, headers=liza_h)
        assert r.status_code == 403 and r.json()["detail"] == VIEW_ONLY_TEXT, (r.status_code, r.text)
        r = c.post("/api/v1/bookings/", json={"resource_id": "uni_5", "target_user_id": str(CLIENT)}, headers=liza_h)
        assert r.status_code == 403 and r.json()["detail"] == VIEW_ONLY_TEXT, (r.status_code, r.text)
        # тело запроса после турникета доходит до ручки целым
        slot = [{"resource_id": "n99_2", "date": "2026-12-04", "start_time": "10:00", "duration": 60}]
        r = c.post("/api/v1/bookings/check-availability", json=slot, headers=valya_h)
        assert r.status_code == 200 and r.json() == [{"available": True, "conflict": None}], r.text
        # ручка получила то же тело, что читал турникет (объект, а не список)
        r = c.post("/api/v1/bookings/recurring/quote", json={"resource_id": "n99_2"}, headers=valya_h)
        assert r.status_code == 422 and "start_time" in r.text, (r.status_code, r.text[:200])
        # закреплённый кабинет: клиенту «занято», администратору предпросмотр открыт
        pinned = [{"resource_id": "n99_1", "date": "2026-12-04", "start_time": "10:00", "duration": 60}]
        client_h = {"Authorization": f"Bearer {security.create_access_token(CLIENT)}"}
        r = c.post("/api/v1/bookings/check-availability", json=pinned, headers=client_h)
        assert r.json()[0]["available"] is False and "закреплён" in r.json()[0]["conflict"], r.text
        assert c.post("/api/v1/bookings/check-availability", json=pinned).json()[0]["available"] is False
        assert c.post("/api/v1/bookings/check-availability", json=pinned, headers=valya_h).json()[0]["available"]
    finally:
        app.dependency_overrides.pop(get_session, None)


def test_g_junk_date_is_not_view_only():
    from app.models.user import User
    from app.services.staff_scope import is_view_only
    # Опечатка в дате не снимает ограничение молча (ревизия 21.11): считаем, что оно действует.
    for junk in ("скоро", "01.12.2026", "2026-12-1x"):
        assert is_view_only(User(email="a", name="a", role="admin", hashed_password="x", view_only_from=junk)), junk
    assert not is_view_only(User(email="a", name="a", role="admin", hashed_password="x"))
    assert is_view_only(User(email="a", name="a", role="admin", hashed_password="x", view_only_from="2026-12-01"), AFTER)
    assert not is_view_only(User(email="a", name="a", role="admin", hashed_password="x", view_only_from="2026-12-01"), BEFORE)
    assert not is_view_only(User(email="a", name="a", role="owner", hashed_password="x", view_only_from="2020-01-01"))
    assert not is_view_only(User(email="a", name="a", role="specialist", hashed_password="x", view_only_from="2020-01-01"))


def test_h_review_findings_stay_closed():
    """Находки ревизии 21.11: обходы турникета и соседние пути."""
    import json
    from app.models.booking import Booking
    from app.models.location import LocationCreate, LocationRead, LocationUpdate
    from app.models.resource import ResourceCreate, ResourceUpdate
    from app.models.user import UserCreate, UserUpdate, UserUpdateAdmin
    s, ids = _world()
    # id брони без дефисов сервер тоже принимает — турникет обязан его узнать
    assert _why(s, LIZA, "DELETE", "/bookings/" + ids["client_99"].replace("-", ""))
    assert _why(s, EGOR, "DELETE", "/bookings/" + ids["client_uni"].replace("-", ""), today=AFTER)
    # старая бронь без user_uuid (хозяин записан почтой) остаётся своей
    old = Booking(id=uuid4(), resource_id="uni_5", location_id="x", date=datetime(2026, 12, 5), start_time="10:00",
                  duration=60, status="confirmed", final_price=20, payment_method="balance", format="individual",
                  user_id="Егор@x.ge", user_uuid=None)
    s.add(old); s.commit()
    assert _why(s, EGOR, "DELETE", f"/bookings/{old.id}", today=AFTER) is None
    assert _why(s, LIZA, "DELETE", f"/bookings/{old.id}", today=AFTER)
    # новый кабинет в филиале, который ведёт другой администратор
    assert _why(s, EGOR, "POST", "/resources/", {"location_id": "unbox_99", "id": "x"})
    assert _why(s, EGOR, "POST", "/resources/", {"location_id": "unbox_uni", "id": "x"}) is None
    # служебные поля нельзя задать через формы создания и правки, наружу список админов не уходит
    for model, field in ((LocationCreate, "staff_ids"), (LocationUpdate, "staff_ids"), (LocationRead, "staff_ids"),
                         (ResourceCreate, "allowed_user_ids"), (ResourceUpdate, "allowed_user_ids"),
                         (UserCreate, "view_only_from"), (UserUpdate, "view_only_from"),
                         (UserUpdateAdmin, "view_only_from")):
        assert field not in model.model_fields, f"{model.__name__} не должен принимать/отдавать {field}"
    # лист ожидания не зовёт в закреплённый кабинет
    from app.services.waitlist_notify import notify_waitlist_for_freed_slot as _notify
    freed = Booking(id=uuid4(), resource_id="n99_1", location_id="unbox_99", date=datetime(2026, 12, 5),
                    start_time="10:00", duration=60, status="cancelled", final_price=0, payment_method="balance",
                    format="individual", user_id=str(OWNER), user_uuid=OWNER)
    src = open(os.path.join(os.path.dirname(__file__), "..", "app", "services", "waitlist_notify.py"), encoding="utf-8").read()
    assert "freed_resource.allowed_user_ids" in src and src.index("freed_resource.allowed_user_ids") < src.index("sibling_resources")
    assert _notify(s, freed) == 0
    # кнопки бота (срочные брони, отказ, подарочный час) спрашивают тот же турникет
    tg = open(os.path.join(os.path.dirname(__file__), "..", "app", "api", "v1", "telegram.py"), encoding="utf-8").read()
    assert tg.count("write_refusal(session, actor,") >= 3, "кнопки бота должны проверять ограничения администратора"
    # причина отказа в create_booking узнаётся по началу текста — тексты должны совпадать
    bk = open(os.path.join(os.path.dirname(__file__), "..", "app", "services", "booking.py"), encoding="utf-8").read()
    rt = open(os.path.join(os.path.dirname(__file__), "..", "app", "api", "v1", "bookings", "routes.py"), encoding="utf-8").read()
    assert 'f"Слот занят (' in bk and 'f"У вас уже есть бронь' in bk
    assert 'reason.startswith(("Слот занят", "У вас уже есть"))' in rt
    # аналитика не считает закреплённый кабинет сдаваемым
    an = open(os.path.join(os.path.dirname(__file__), "..", "app", "api", "v1", "analytics.py"), encoding="utf-8").read()
    assert "pinned_rooms" in an and "r.id not in pinned_rooms" in an


def test_i_gate_reads_body_without_json_header():
    """Запрос без заголовка «это JSON» сервер всё равно разбирает — турникет тоже."""
    import json
    from fastapi.testclient import TestClient
    from sqlmodel import Session
    from app.core import security
    from app.db.session import get_session
    from app.main import app
    eng = _engine()
    with Session(eng) as s:
        _fill(s)

    def _sess():
        with Session(eng) as s:
            yield s
    app.dependency_overrides[get_session] = _sess
    try:
        c = TestClient(app)
        liza_h = {"Authorization": f"Bearer {security.create_access_token(LIZA)}"}
        body = json.dumps({"resource_id": "n99_2", "target_user_id": str(CLIENT)})
        for ctype in (None, "text/plain", "application/vnd.api+json"):
            h = dict(liza_h, **({"Content-Type": ctype} if ctype else {}))
            r = c.post("/api/v1/bookings/", content=body, headers=h)
            assert r.status_code == 403 and "UNBOX 99" in r.json()["detail"], (ctype, r.status_code, r.text[:200])
        # список администраторов филиала наружу не уходит, а закреплённый кабинет экрану виден
        locs = c.get("/api/v1/locations/").json()
        assert locs and all("staff_ids" not in x for x in locs), locs
        rooms = {x["id"]: x for x in c.get("/api/v1/resources/").json()}
        assert rooms["n99_1"]["allowed_user_ids"] == [str(OWNER)] and not rooms["n99_2"].get("allowed_user_ids")
    finally:
        app.dependency_overrides.pop(get_session, None)


def test_j_view_only_own_bookings_without_admin_perks():
    """Свои брони в режиме «только просмотр» — без админских послаблений (ревизия 21.11):
    поздняя отмена с полным возвратом, бронь задним числом и «срочная без подтверждения»
    идут через действующего администратора. И id брони в любой записи узнаётся."""
    from app.models.booking import Booking
    from app.models.waitlist import Waitlist
    from app.services.staff_scope import LATE_TEXT, VIEW_ONLY_TEXT
    s, ids = _world()
    soon = Booking(id=uuid4(), resource_id="uni_5", location_id="x", date=datetime(2026, 12, 1), start_time="18:00",
                   duration=60, status="confirmed", final_price=20, payment_method="balance", format="individual",
                   user_id=str(EGOR), user_uuid=EGOR, recurring_group_id="series-soon")
    past = Booking(id=uuid4(), resource_id="uni_5", location_id="x", date=datetime(2026, 11, 28), start_time="10:00",
                   duration=60, status="confirmed", final_price=20, payment_method="balance", format="individual",
                   user_id=str(EGOR), user_uuid=EGOR, recurring_group_id="series-egor")
    mine_wait = Waitlist(resource_id="uni_5", date=datetime(2026, 12, 5), start_time="10:00", end_time="11:00",
                         user_id=str(EGOR), user_uuid=EGOR)
    other_wait = Waitlist(resource_id="uni_5", date=datetime(2026, 12, 5), start_time="10:00", end_time="11:00",
                          user_id=str(CLIENT), user_uuid=CLIENT)
    for row in (soon, past, mine_wait, other_wait):
        s.add(row)
    s.commit()
    # 01.12 12:00 (today=AFTER): бронь в 18:00 того же дня и прошедшая — только через админа
    for path in (f"/bookings/{soon.id}", f"/bookings/{past.id}"):
        assert _why(s, EGOR, "DELETE", path, today=AFTER) == LATE_TEXT, path
    assert _why(s, EGOR, "PATCH", f"/bookings/{soon.id}/reschedule", {"new_date": "2026-12-09"}, today=AFTER) == LATE_TEXT
    assert _why(s, EGOR, "PATCH", f"/bookings/{soon.id}/shorten", {}, today=AFTER) == LATE_TEXT
    assert _why(s, EGOR, "DELETE", "/bookings/recurring/series-soon", today=AFTER) == LATE_TEXT
    assert _why(s, EGOR, "PATCH", f"/bookings/{soon.id}/link-client", {}, today=AFTER) is None
    # серия с прошедшей встречей, но без встреч на ближайшие сутки — своя, можно
    assert _why(s, EGOR, "DELETE", "/bookings/recurring/series-egor", today=AFTER) is None
    # новая своя бронь: на сегодня вечером — через админа; через неделю — сам
    assert _why(s, EGOR, "POST", "/bookings/", {"resource_id": "uni_5", "date": "2026-12-01", "start_time": "19:00"}, today=AFTER) == LATE_TEXT
    assert _why(s, EGOR, "POST", "/bookings/", {"resource_id": "uni_5", "date": "2026-11-30T20:00:00.000Z", "start_time": "19:00"}, today=AFTER) == LATE_TEXT
    assert _why(s, EGOR, "POST", "/bookings/", {"resource_id": "uni_5", "date": "2026-11-29", "start_time": "10:00"}, today=AFTER) == LATE_TEXT
    assert _why(s, EGOR, "POST", "/bookings/multi-slot", {"slots": [
        {"resource_id": "uni_5", "date": "2026-12-09", "start_time": "10:00"},
        {"resource_id": "uni_5", "date": "2026-12-01", "start_time": "20:00"}]}, today=AFTER) == LATE_TEXT
    assert _why(s, EGOR, "POST", "/bookings/", {"resource_id": "uni_5", "date": "2026-12-09", "start_time": "10:00"}, today=AFTER) is None
    assert _why(s, EGOR, "POST", "/bookings/recurring", {"resource_id": "uni_5", "first_date": "2026-12-09", "start_time": "10:00"}, today=AFTER) is None
    # до 01.12 и у обычного администратора — как раньше
    assert _why(s, EGOR, "DELETE", f"/bookings/{past.id}", today=BEFORE) is None
    assert _why(s, VALYA, "POST", "/bookings/", {"resource_id": "uni_5", "date": "2026-12-01", "start_time": "19:00"}, today=AFTER) is None
    # действия «только админ» над своей бронью
    for act in ("add-extras", "remove-extra", "to-subscription", "price", "bonus-hour"):
        assert _why(s, EGOR, "PATCH", f"/bookings/{ids['egor_own']}/{act}", {}, today=AFTER) == VIEW_ONLY_TEXT, act
    # id брони в любой записи, которую принимает сервер
    cid = ids["client_99"]
    for form in (cid.replace("-", ""), "{" + cid + "}", "urn:uuid:" + cid, cid.upper()):
        assert _why(s, LIZA, "DELETE", f"/bookings/{form}"), form
        assert _why(s, LIZA, "PATCH", f"/bookings/{form}/reschedule", {}), form
        assert _why(s, LIZA, "POST", f"/billing/bookings/{form}/waive", {}), form
    assert _why(s, LIZA, "DELETE", "/bookings/не-id") is None, "мусор вместо id — ручка сама ответит 404"
    # лист ожидания: снять можно только свою запись
    assert _why(s, EGOR, "DELETE", f"/waitlist/{mine_wait.id}", today=AFTER) is None
    assert _why(s, EGOR, "DELETE", f"/waitlist/{other_wait.id}", today=AFTER) == VIEW_ONLY_TEXT
    # почта в target_user_id сверяется точно, как в ручке
    assert _why(s, EGOR, "POST", "/bookings/", {"resource_id": "uni_5", "target_user_id": "егор@x.ge"}, today=AFTER) == VIEW_ONLY_TEXT
    assert _why(s, EGOR, "POST", "/bookings/", {"resource_id": "uni_5", "target_user_id": "Егор@x.ge"}, today=AFTER) is None


if __name__ == "__main__":
    failures = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"  ✓ {name}")
            except Exception as exc:  # noqa: BLE001
                failures += 1
                print(f"  ✗ {name}: {exc!r}")
    print("СТОРОЖ: OK" if not failures else f"СТОРОЖ УПАЛ ({failures})")
    sys.exit(1 if failures else 0)
