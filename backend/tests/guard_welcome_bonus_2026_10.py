"""СТОРОЖ: приветственный час — только новому клиенту (решение владельца 12.10).

Кейс Кристины Ропель: админ завёл ей три аккаунта для групп (ropel1-3@unbox.center)
кнопкой «Новый клиент» — она звала публичную регистрацию, и каждому выдался
приветственный час. Бонус идёт первым (29.09), и 08.10 три встречи оплатились
подарочными часами вместо денег (60 ₾).

Правило: сам зарегистрировавшийся клиент — час, как раньше; аккаунт, заведённый
админом, — только с галочкой «новый клиент» (?welcome_bonus=true);
технический адрес @unbox.center — никогда.

    python3 backend/tests/guard_welcome_bonus_2026_10.py
"""
import os
import sys
from uuid import uuid4

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("ENVIRONMENT", "development")

import guard_hours_pool_moves as H  # noqa: E402

_REPO = os.path.join(os.path.dirname(__file__), "..", "..")


def _src(rel):
    return open(os.path.join(_REPO, rel), encoding="utf-8").read()


def _register(s, email, caller=None, welcome_bonus=None):
    from sqlmodel import select
    from app.api.v1 import auth
    from app.models.bonus import Bonus
    from app.models.user import UserCreate
    u = auth.register_new_user(session=s, user_in=UserCreate(email=email, name="Новый", password="x" * 10),
                               caller=caller, welcome_bonus=welcome_bonus)
    return len(s.exec(select(Bonus).where(Bonus.user_id == str(u.id), Bonus.type == "free_hour")).all())


def test_welcome_hour_rules():
    import app.models.bonus  # noqa: F401 — таблица в схеме
    s = H._db()
    admin = H._user(s, role="admin", balance=0.0, name="Админ")
    assert _register(s, f"self-{uuid4().hex[:6]}@x.ge") == 1, "сам зарегистрировался — час положен"
    assert _register(s, f"adm-{uuid4().hex[:6]}@x.ge", caller=admin) == 0, "админ завёл без галочки — часа нет"
    assert _register(s, f"adm2-{uuid4().hex[:6]}@x.ge", caller=admin, welcome_bonus=True) == 1
    assert _register(s, f"ropel-{uuid4().hex[:6]}@unbox.center") == 0, "технический адрес — никогда"
    assert _register(s, f"ropel2-{uuid4().hex[:6]}@Unbox.Center", caller=admin, welcome_bonus=True) == 0
    client = H._user(s, role="user", balance=0.0, name="Клиент")
    assert _register(s, f"other-{uuid4().hex[:6]}@x.ge", caller=client, welcome_bonus=False) == 1, \
        "не-админ не может отключить час другим"


def test_admin_form_sends_choice():
    u = _src("src/pages/admin/Users.tsx")
    assert "{ params: { welcome_bonus: welcomeHour && !techEmail } }" in u
    assert "useState(false);" in u[u.index("const [welcomeHour"):u.index("const [welcomeHour") + 60], \
        "галочка «новый клиент» по умолчанию должна быть выключена"
    a = _src("backend/app/api/v1/auth.py")
    body = a[a.index("def _create_welcome_bonus("):a.index("def _create_welcome_bonus(") + 900]
    assert "if is_tech_email(user.email):" in body, "проверка технического адреса — в самом помощнике (все пути)"


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
