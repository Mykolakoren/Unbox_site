"""СТОРОЖ: скорость админки (23.10).

1. Список клиентов весил 2,8 МБ, из них 2,7 МБ — три фото, сохранённые в базе
   текстом (data:…). Теперь в ответе ссылка /api/v1/users/<id>/avatar?v=…,
   картинку браузер качает один раз. Форма, приславшая ссылку обратно, не должна
   затирать настоящее фото.
2. Одновременные «обнови брони/клиентов» склеиваются в один запрос.
3. Каркас приложения не подписан на весь стор (перерисовка всего сайта на
   каждое изменение данных).

    python3 backend/tests/guard_speed_2026_10.py
"""
import base64
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("ENVIRONMENT", "development")

import guard_hours_pool_moves as H  # noqa: E402

_REPO = os.path.join(os.path.dirname(__file__), "..", "..")
_PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
_DATA = "data:image/png;base64," + base64.b64encode(_PNG).decode()


def _src(rel):
    return open(os.path.join(_REPO, rel), encoding="utf-8").read()


def test_inline_avatar_goes_out_as_link():
    from app.models.user import User, UserRead
    u = User(email="a@x.ge", name="A", hashed_password="", avatar_url=_DATA)
    out = UserRead.model_validate(u).avatar_url
    assert out.startswith(f"/api/v1/users/{u.id}/avatar?v=") and "base64" not in out
    u2 = User(email="b@x.ge", name="B", hashed_password="", avatar_url="/uploads/x.jpg")
    assert UserRead.model_validate(u2).avatar_url == "/uploads/x.jpg"


def test_avatar_endpoint_serves_image():
    from fastapi import HTTPException
    from app.api.v1.users import profile
    s = H._db()
    u = H._user(s, role="user", name="Фото")
    u.avatar_url = _DATA; s.add(u); s.commit()
    r = profile.read_user_avatar(str(u.id), session=s)
    assert r.body == _PNG and r.media_type == "image/png"
    assert "immutable" in r.headers["cache-control"]
    u.avatar_url = "data:text/html;base64," + base64.b64encode(b"<script>").decode(); s.add(u); s.commit()
    try:
        profile.read_user_avatar(str(u.id), session=s)
        raise AssertionError("не-картинку отдавать нельзя")
    except HTTPException as e:
        assert e.status_code == 404


def test_echoed_link_does_not_erase_photo():
    from app.api.v1.users import admin, profile
    from app.models.user import UserRead, UserUpdate, UserUpdateAdmin
    s = H._db()
    me = H._user(s, role="user", name="Я")
    me.avatar_url = _DATA; s.add(me); s.commit()
    link = UserRead.model_validate(me).avatar_url
    profile.update_user_me(session=s, user_in=UserUpdate(avatar_url=link, name="Я2"), current_user=me)
    s.refresh(me)
    assert me.avatar_url == _DATA and me.name == "Я2"
    owner = H._user(s, role="owner", name="Владелец")
    admin.update_user(user_id=str(me.id), session=s, user_in=UserUpdateAdmin(avatar_url=link), current_user=owner)
    s.refresh(me)
    assert me.avatar_url == _DATA


def test_admin_avatar_upload_is_file_not_text():
    ud = _src("src/pages/admin/UserDetails.tsx")
    assert "readAsDataURL" not in ud, "фото клиента снова сохраняется текстом в профиль"


def test_fetches_coalesced_and_shell_not_subscribed_to_whole_store():
    b = _src("src/store/slices/createBookingSlice.ts")
    assert "if (allInFlight)" in b and "allAgain = true" in b
    u = _src("src/store/slices/createUserSlice.ts")
    assert "if (usersInFlight)" in u
    for f in ("src/App.tsx", "src/components/DashboardLayout.tsx", "src/pages/mobile/admin/MobileAdminLayout.tsx",
              "src/pages/mobile/MobileLayout.tsx", "src/pages/crm/CrmLayout.tsx"):
        assert "= useUserStore();" not in _src(f), f"{f}: подписка на весь стор — перерисовка всего на любое изменение"


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
