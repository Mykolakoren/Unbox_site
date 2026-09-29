"""СТОРОЖ волны 0, пакет I — профиль, знак валюты, срок приветственного бонуса.

Аудит 29.09 (G3-01, G3-04 + X3-01, X3-02). Каждая проверка ловит конкретную
поломку, которую уже чинили, — чтобы она не вернулась незаметно.

Без сети и без боевой базы (чтение исходников + лёгкие заглушки):

    python3 backend/tests/guard_wave0_I.py
"""
import os
import pathlib
import re
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("ENVIRONMENT", "development")

BACKEND = pathlib.Path(__file__).parent.parent
ROOT = BACKEND.parent
SRC = ROOT / "src"


def _read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


# ─────────────────────────────────────────────────────────────────────────
# G3-01 — профиль: каждая буква уходила PATCH'ем на сервер, кнопка
# «Сохранить изменения» ничего не делала, пустое имя сохранялось.
# ─────────────────────────────────────────────────────────────────────────

class _FakeSession:
    def add(self, obj):
        pass

    def commit(self):
        pass

    def refresh(self, obj):
        pass


def test_patch_me_rejects_empty_name():
    """PATCH /users/me с пустым (или из одних пробелов) именем — 400, имя не
    перезаписывается."""
    from fastapi import HTTPException
    from app.api.v1.users.profile import update_user_me
    from app.models.user import UserUpdate

    for bad in ("", "   ", None):
        user = SimpleNamespace(name="Тина Новикова", phone="+995 555 00 00 00")
        try:
            update_user_me(session=_FakeSession(), user_in=UserUpdate(name=bad), current_user=user)
        except HTTPException as exc:
            assert exc.status_code == 400, f"ждали 400, получили {exc.status_code}"
        else:
            raise AssertionError(f"имя {bad!r} принято — клиент останется без имени")
        assert user.name == "Тина Новикова", "имя затёрто, хотя запрос отклонён"


def test_patch_me_trims_name_and_keeps_other_fields():
    """Пробелы по краям имени обрезаются; телефон без имени сохраняется как раньше."""
    from app.api.v1.users.profile import update_user_me
    from app.models.user import UserUpdate

    user = SimpleNamespace(name="Старое", phone="")
    update_user_me(session=_FakeSession(), user_in=UserUpdate(name="  Тина Ковальчук  "), current_user=user)
    assert user.name == "Тина Ковальчук", f"имя не обрезано: {user.name!r}"

    update_user_me(session=_FakeSession(), user_in=UserUpdate(phone="+995 555 12 34 56"), current_user=user)
    assert user.phone == "+995 555 12 34 56"
    assert user.name == "Тина Ковальчук", "обновление телефона задело имя"


def test_profile_page_saves_on_button_not_on_keystroke():
    """Поля имени и телефона — черновик, на сервер уходят по кнопке."""
    src = _read("src/pages/ProfilePage.tsx")
    assert "updateUser({ name: e.target.value })" not in src, \
        "поле имени снова шлёт PATCH на каждую букву"
    assert "updateUser({ phone: v })" not in src, \
        "поле телефона снова шлёт PATCH на каждую цифру"
    assert "value={currentUser.name}" not in src, \
        "поле имени снова привязано к ответу сервера — буквы будут теряться"
    i = src.find("'Сохранить изменения'")
    assert i != -1, "пропала кнопка «Сохранить изменения»"
    button = src[src.rfind("<button", 0, i):i]
    assert "onClick={handleSave}" in button, "у кнопки «Сохранить изменения» нет обработчика"
    assert "disabled={saving" in button, "кнопку можно нажать дважды во время сохранения"
    assert "toast.success(" in src and "toastProfileSaveError(" in src, \
        "нет ответа человеку об успехе/ошибке сохранения"


def test_update_user_store_rethrows():
    """updateUser в сторе пробрасывает ошибку — иначе экран не узнает о сбое."""
    src = _read("src/store/slices/createUserSlice.ts")
    i = src.find("updateUser: async (updates)")
    assert i != -1, "не нашли updateUser в сторе"
    body = src[i:src.find("updateUserById:", i)]
    assert "throw error" in body, "updateUser снова глотает ошибку сохранения профиля"


# ─────────────────────────────────────────────────────────────────────────
# G3-04 + X3-01 — баланс и платежи в кабинете были подписаны гривной (₴).
# ─────────────────────────────────────────────────────────────────────────

def test_no_hryvnia_sign_in_src():
    """Во фронте нет знака гривны. Единственное законное место — справочник
    символов валют Psy-CRM (utils/currency.ts, через \\u20B4)."""
    offenders = []
    for path in SRC.rglob("*"):
        if path.suffix not in (".ts", ".tsx", ".js", ".jsx", ".css", ".html"):
            continue
        text = path.read_text(encoding="utf-8")
        rel = path.relative_to(ROOT).as_posix()
        if "₴" in text:
            offenders.append(rel)
        elif re.search(r"\\u20[bB]4|&#8372;|&#x20[bB]4;", text) and rel != "src/utils/currency.ts":
            offenders.append(rel)
    assert not offenders, f"знак гривны вместо лари: {offenders}"


def test_dashboard_money_in_lari():
    """Баланс, кредит и последние платежи в кабинете — в лари."""
    src = _read("src/pages/DashboardOverview.tsx")
    assert "|| '0'} ₾" in src, "баланс в кабинете без знака лари"
    assert "Кредит: {availableCredit.toLocaleString('ru-RU')} ₾ из" in src, "кредит без знака лари"


# ─────────────────────────────────────────────────────────────────────────
# X3-02 — приветственный бонус: в телефоне писали «90 дней» (на деле 15),
# на тарифах и в базе знаний — «20 ₾ на счёт, как обычные деньги»
# (на деле 1 бесплатный час, на денежный баланс не попадает).
# ─────────────────────────────────────────────────────────────────────────

def _welcome_days() -> int:
    auth = (BACKEND / "app/api/v1/auth.py").read_text(encoding="utf-8")
    m = re.search(r"^WELCOME_BONUS_EXPIRY_DAYS\s*=\s*(\d+)", auth, re.M)
    assert m, "не нашли WELCOME_BONUS_EXPIRY_DAYS в auth.py"
    return int(m.group(1))


WELCOME_TEXT_FILES = (
    "src/pages/mobile/MobileBonuses.tsx",
    "src/pages/SubscriptionsPage.tsx",
    "src/pages/admin/KnowledgeBase.tsx",
    "src/pages/BonusesInfoPage.tsx",
)


def test_welcome_bonus_term_matches_backend():
    """Срок приветственного часа в текстах = WELCOME_BONUS_EXPIRY_DAYS на сервере.
    Поменяли срок на сервере — поменяйте и тексты (сторож напомнит)."""
    days = _welcome_days()
    for rel in WELCOME_TEXT_FILES:
        src = _read(rel)
        assert re.search(rf"\b{days}(\s|&nbsp;)дней", src), \
            f"{rel}: нет срока приветственного бонуса «{days} дней»"
        assert "90 дней" not in src and "90&nbsp;дней" not in src, \
            f"{rel}: снова «90 дней» — бонус живёт {days}"


def _welcome_block(src: str, start_marker: str, end_marker: str) -> str:
    i = src.find(start_marker)
    assert i != -1, f"не нашли блок приветственного бонуса ({start_marker})"
    j = src.find(end_marker, i)
    assert j != -1, f"не нашли конец блока ({end_marker})"
    return src[i:j]


def test_welcome_bonus_is_an_hour_not_money():
    """На тарифах и в базе знаний бонус — «1 бесплатный час», а не «20 ₾ на счёт»."""
    blocks = {
        "src/pages/SubscriptionsPage.tsx": _welcome_block(
            _read("src/pages/SubscriptionsPage.tsx"), "Приветственный бонус</div>", "ПРИОРИТЕТ"),
        "src/pages/admin/KnowledgeBase.tsx": _welcome_block(
            _read("src/pages/admin/KnowledgeBase.tsx"), "Приветственный бонус</div>", "Примечание."),
    }
    for rel, block in blocks.items():
        assert "1 бесплатный час" in block, f"{rel}: бонус не описан как 1 бесплатный час"
        for stale in ("20 ₾</strong>", "20 GEL", "Номинал", "обычные деньги", "доплачива"):
            assert stale not in block, f"{rel}: вернулось старое описание бонуса деньгами («{stale}»)"
    mobile = _read("src/pages/mobile/MobileBonuses.tsx")
    assert "1 бесплатный час" in mobile, "MobileBonuses: бонус не описан как 1 бесплатный час"


if __name__ == "__main__":
    failures = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"  ✓ {name}")
            except AssertionError as exc:
                failures += 1
                print(f"  ✗ {name}: {exc}")
            except Exception as exc:  # noqa: BLE001
                failures += 1
                print(f"  ✗ {name}: {exc!r}")
    print("СТОРОЖ ВОЛНЫ 0 (I): OK" if not failures else f"СТОРОЖ ВОЛНЫ 0 (I) УПАЛ ({failures}) — деплой НЕ выкатывать")
    sys.exit(1 if failures else 0)
