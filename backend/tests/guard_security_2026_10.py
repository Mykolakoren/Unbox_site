"""СТОРОЖ: дыры из аудита безопасности 23.10 (Trail of Bits / sharp-edges).

1. Админ вписывал владельцу свой Telegram и входил через Telegram под владельцем.
2. Загрузка «фото» принимала .html под видом image/png — чужой скрипт на нашем домене.
3. Бот по ссылке «нажмите Start» сливал НАСТОЯЩИЙ аккаунт жертвы в аккаунт владельца ссылки.
4. calendar_id принимался любой — календарь коллеги или кабинета.
5. Старший админ менял email владельцу, склеивал его аккаунт, забирал чужую CRM.
6. Часы абонемента и кредитный лимит менялись общим PATCH без права и без следа.
7. Архивный аккаунт продолжал работать по старому входу.

    python3 backend/tests/guard_security_2026_10.py
"""
import os
import sys
from uuid import uuid4

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("ENVIRONMENT", "development")

import guard_hours_pool_moves as H  # noqa: E402
from fastapi import HTTPException  # noqa: E402


def _raises(code, fn, *a, **kw):
    try:
        fn(*a, **kw)
    except HTTPException as e:
        assert e.status_code == code, f"ждали {code}, получили {e.status_code}: {e.detail}"
        return e
    raise AssertionError(f"ждали отказ {code}, а прошло")


def _patch(s, actor, target, **fields):
    from app.api.v1.users import admin
    from app.models.user import UserUpdateAdmin
    return admin.update_user(user_id=str(target.id), session=s,
                             user_in=UserUpdateAdmin(**fields), current_user=actor)


def test_admin_cannot_take_owner_telegram():
    s = H._db()
    owner = H._user(s, role="owner", name="Владелец")
    senior = H._user(s, role="senior_admin", name="Старший")
    admin = H._user(s, role="admin", name="Админ")
    client = H._user(s, role="user", name="Клиент")
    _raises(403, _patch, s, admin, owner, telegram_id="111")
    _raises(403, _patch, s, senior, owner, telegram_id="111")
    _raises(403, _patch, s, admin, admin, telegram_id="111")   # себе — тоже нет
    _raises(403, _patch, s, admin, H._user(s, role="admin", name="Коллега"), name="X")
    _patch(s, admin, client, telegram_id="222")
    _raises(409, _patch, s, owner, H._user(s, role="user", name="Другой"), telegram_id="222")
    _patch(s, admin, admin, name="Админ Новый")  # безопасное поле себе — можно
    _patch(s, owner, senior, telegram_id="333")


def test_admin_expiry_edit_keeps_fresh_hours():
    """Правка срока шлёт весь абонемент из карточки: устаревшие часы и прочие
    поля не должны затереть свежие, а админ не должен получить 403."""
    from datetime import datetime
    from app.models.user import User
    s = H._db()
    s_admin = H._user(s, role="admin", name="Админ")
    s_admin.permissions = ["subscriptions.manage"]; s.add(s_admin); s.commit()
    client = H._user(s, role="user", name="Клиент", sub=H._sub())
    stale = dict(client.subscription)
    fresh = dict(client.subscription); fresh["remaining_hours"] = 3; fresh["remainingHours"] = 3
    client.subscription = fresh; s.add(client); s.commit()
    stale["expiryDate"] = "2027-01-31T00:00:00"; stale["flexible"] = True
    _patch(s, s_admin, client, subscription=stale)
    s.expire_all(); sub = s.get(User, client.id).subscription
    from app.services import subscription_pool as sp
    assert sp.get_float(sub, "remaining_hours") == 3, "устаревшие часы из карточки затёрли свежие"
    assert str(sp.get(sub, "expiry_date")).startswith("2027-01-31")
    assert not sub.get("flexible"), "обычный админ через профиль меняет только срок"


def test_tags_on_colleague_allowed_but_crm_data_owner_only():
    s = H._db()
    a1 = H._user(s, role="admin", name="Админ1")
    a2 = H._user(s, role="admin", name="Админ2")
    _patch(s, a1, a2, tags=["vip"])              # служебная пометка коллеге — можно
    _raises(403, _patch, s, a1, a2, name="X")   # а профиль — нет
    spec = H._user(s, role="specialist", name="Психолог")
    _raises(403, _patch, s, a1, spec, crm_data={"calendar_id": "cab@group.calendar.google.com"})


def test_merge_specialist_crm_owner_only():
    from app.api.v1.users import admin
    s = H._db()
    senior = H._user(s, role="senior_admin", name="Старший")
    spec = H._user(s, role="specialist", name="Психолог")
    other = H._user(s, role="user", name="Подставной")
    _raises(403, admin.merge_users, session=s,
            payload=admin._MergeUsersRequest(source=str(spec.id), target=str(other.id)), current_user=senior)


def test_archived_cannot_log_in_anywhere():
    from datetime import datetime
    from app.api.v1 import auth
    s = H._db()
    live = H._user(s, role="user", name="Живой"); live.telegram_id = "42"
    old = H._user(s, role="user", name="Старый"); old.telegram_id = "42"; old.archived_at = datetime.now()
    s.add(live); s.add(old); s.commit()
    u, err = auth._pick_telegram_user(s, "42")
    assert err is None and u.id == live.id, "архивный дубль не должен мешать живому войти"
    live.archived_at = datetime.now(); s.add(live); s.commit()
    u, err = auth._pick_telegram_user(s, "42")
    assert u is None and err[0] == 403
    src = open(os.path.join(os.path.dirname(__file__), "..", "app", "api", "v1", "auth.py"), encoding="utf-8").read()
    g = src[src.index("def google_login("):src.index("@router.post(\"/telegram\"")]
    assert "archived_at" in g and "email_verified" in g
    cb = src[src.index("def telegram_login_callback("):]
    assert "auth_date" in cb[:3000], "GET-вход через Telegram без проверки свежести"


def test_hours_and_credit_limit_need_rights_and_leave_trace():
    from sqlmodel import select
    from app.models.timeline import TimelineEvent
    s = H._db()
    admin = H._user(s, role="admin", name="Админ")
    senior = H._user(s, role="senior_admin", name="Старший")
    senior.permissions = ["subscriptions.manage", "finance.set_credit_limit"]
    s.add(senior); s.commit()
    client = H._user(s, role="user", name="Клиент", sub=H._sub())
    sub = dict(client.subscription); sub["remaining_hours"] = 99
    _patch(s, admin, client, subscription=sub)   # часы через профиль не меняются
    s.refresh(client)
    assert client.subscription.get("remaining_hours") != 99
    _patch(s, admin, client, credit_limit=float(client.credit_limit or 0))  # без изменения — не мешаем
    _patch(s, senior, client, subscription=sub, credit_limit=150)
    s.refresh(client)
    assert client.subscription.get("remaining_hours") != 99, "часы — только «Пополнить часы»"
    ev = s.exec(select(TimelineEvent).where(TimelineEvent.event_type == "admin_profile_change")).all()
    assert ev and "кредитный лимит" in ev[-1].description


def test_archived_user_token_rejected():
    from datetime import datetime, timedelta
    from app.api import deps
    from app.core import security
    s = H._db()
    u = H._user(s, role="user", name="Архивный")
    tok = security.create_access_token(u.id, expires_delta=timedelta(minutes=5))
    assert deps.get_current_user(s, tok).id == u.id
    u.archived_at = datetime.now(); s.add(u); s.commit()
    _raises(401, deps.get_current_user, s, tok)


def test_user_read_hides_telegram_link_token():
    from app.models.user import User, UserRead
    u = User(email="a@x.ge", name="A", telegram_link_token="SECRET", hashed_password="x")
    dumped = UserRead.model_validate(u).model_dump() if hasattr(UserRead, "model_validate") else UserRead.from_orm(u).dict()
    assert "telegram_link_token" not in dumped and "SECRET" not in str(dumped)


def _start(s, chat_id, owner_of_link):
    from datetime import datetime, timedelta
    from app.api.v1 import telegram as tg
    tok = uuid4().hex
    owner_of_link.telegram_link_token = tok
    owner_of_link.telegram_link_token_expires_at = datetime.utcnow() + timedelta(minutes=10)
    s.add(owner_of_link); s.commit()
    sent, alerts = [], []
    o_send, o_alert = tg._send, tg.telegram_service.send_admin_alert
    tg._send = lambda chat, text, **kw: sent.append(text)
    tg.telegram_service.send_admin_alert = lambda text, **kw: alerts.append(text)
    try:
        tg._handle_start(s, chat_id, f"/start {tok}", None)
    finally:
        tg._send, tg.telegram_service.send_admin_alert = o_send, o_alert
    return sent, alerts


def test_bot_start_does_not_swallow_real_account():
    from app.models.user import User
    s = H._db()
    attacker = H._user(s, role="user", balance=0.0, name="Чужой")
    victim = H._user(s, role="user", balance=300.0, name="Жертва")
    victim.telegram_id = "555"; s.add(victim); s.commit()
    vid = victim.id
    sent, alerts = _start(s, 555, attacker)
    s.expire_all()
    assert s.get(User, vid) is not None, "настоящий аккаунт удалён слиянием"
    assert float(s.get(User, vid).balance) == 300.0
    assert s.get(User, vid).telegram_id == "555"
    assert (s.get(User, attacker.id).telegram_id or "") != "555"
    assert alerts and "уже привязан" in sent[-1]

    # Призрак с деньгами тоже не сливаем сам
    ghost = User(email="777@telegram.unbox", name="tg", role="user", hashed_password="", balance=40.0,
                 telegram_id="777")
    s.add(ghost); s.commit(); gid = ghost.id
    _start(s, 777, attacker)
    s.expire_all()
    assert s.get(User, gid) is not None and float(s.get(User, attacker.id).balance or 0) == 0.0

    # Пустой призрак — сливаем, как раньше
    empty = User(email="888@telegram.unbox", name="tg", role="user", hashed_password="", balance=0.0,
                 telegram_id="888")
    s.add(empty); s.commit(); eid = empty.id
    me = H._user(s, role="user", balance=0.0, name="Я")
    _start(s, 888, me)
    s.expire_all()
    assert s.get(User, eid) is None and s.get(User, me.id).telegram_id == "888"


def test_upload_type_from_content():
    from app.api.v1.upload import _sniff_image_ext as f
    assert f(b"\xff\xd8\xff\xe0....") == ".jpg"
    assert f(b"\x89PNG\r\n\x1a\n....") == ".png"
    assert f(b"RIFF\x00\x00\x00\x00WEBPVP8 ") == ".webp"
    assert f(b"GIF89a....") == ".gif"
    for bad in (b"<html><script>", b"<svg onload=alert(1)>", b"%PDF-1.4", b""):
        assert f(bad) is None
    src = open(os.path.join(os.path.dirname(__file__), "..", "app", "api", "v1", "upload.py"), encoding="utf-8").read()
    assert 'os.path.splitext(file.filename or "")[1]' not in src, "расширение снова берётся из имени файла"


def test_peer_accounts_protected_from_senior():
    from app.api.v1.users import admin
    s = H._db()
    owner = H._user(s, role="owner", name="Владелец")
    senior = H._user(s, role="senior_admin", name="Старший")
    senior2 = H._user(s, role="senior_admin", name="Старший2")
    client = H._user(s, role="user", name="Клиент")
    _raises(403, admin.change_user_email, user_id=str(owner.id), session=s,
            payload=admin._ChangeEmailRequest(new_email="evil@x.ge"), current_user=senior)
    _raises(403, admin.merge_users, session=s,
            payload=admin._MergeUsersRequest(source=str(owner.id), target=str(client.id)), current_user=senior)
    _raises(403, admin.merge_users, session=s,
            payload=admin._MergeUsersRequest(source=str(client.id), target=str(senior2.id)), current_user=senior)
    _raises(403, admin.restore_orphaned_crm, session=s,
            payload=admin._RestoreCrmRequest(source_specialist_id=str(uuid4()), target_user_id=str(senior.id)),
            current_user=senior)
    spec = H._user(s, role="specialist", name="Психолог")
    _raises(409, admin.restore_orphaned_crm, session=s,
            payload=admin._RestoreCrmRequest(source_specialist_id=str(spec.id), target_user_id=str(owner.id)),
            current_user=owner)
    _raises(403, admin.update_permissions, user_id=str(senior2.id), permissions=[], session=s, current_user=senior)
    # на клиента — работает
    admin.change_user_email(user_id=str(client.id), session=s,
                            payload=admin._ChangeEmailRequest(new_email=f"ok-{uuid4().hex[:5]}@x.ge"),
                            current_user=senior)


def test_owner_email_reserved():
    from app.api.v1.users import admin
    from app.core.config import settings
    s = H._db()
    senior = H._user(s, role="senior_admin", name="Старший")
    client = H._user(s, role="user", name="Клиент")
    old = settings.OWNER_EMAILS
    settings.OWNER_EMAILS = "boss@x.ge"
    try:
        _raises(403, admin.change_user_email, user_id=str(client.id), session=s,
                payload=admin._ChangeEmailRequest(new_email="Boss@x.ge"), current_user=senior)
    finally:
        settings.OWNER_EMAILS = old


def test_crm_calendar_id_rules():
    from app.api.v1.crm import dashboard
    from app.core.config import settings
    s = H._db()
    a = H._user(s, role="specialist", name="Анна")
    b = H._user(s, role="specialist", name="Борис")
    chk = dashboard._check_calendar_id_allowed
    chk(s, a, a.email)                                  # свой личный — да
    _raises(400, chk, s, a, b.email)                    # чужая почта — нет
    shared = f"{uuid4().hex}@group.calendar.google.com"
    chk(s, a, shared)
    b.crm_data = {"calendar_id": shared}; s.add(b); s.commit()
    _raises(409, chk, s, a, shared)                     # уже у коллеги
    old = settings.CALENDAR_ID_CABINET_1
    settings.CALENDAR_ID_CABINET_1 = "cab1@group.calendar.google.com"
    try:
        _raises(400, chk, s, a, "CAB1@group.calendar.google.com")
    finally:
        settings.CALENDAR_ID_CABINET_1 = old


if __name__ == "__main__":
    fails = 0
    for n, f in sorted(globals().items()):
        if n.startswith("test_") and callable(f):
            try:
                f(); print(f"  ✓ {n}")
            except Exception as e:  # noqa: BLE001
                fails += 1
                import traceback
                print(f"  ✗ {n}: {type(e).__name__}: {str(e)[:300]}")
                traceback.print_exc(limit=3)
    sys.exit(1 if fails else 0)
