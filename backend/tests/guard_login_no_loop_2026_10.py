"""СТОРОЖ · вход на сайт не уходит в бесконечную перезагрузку (инцидент 02.10).

Что случилось: модуль utils/currency.ts при загрузке сам запрашивал курсы валют
(GET /settings/exchange_rates, нужен токен). Вчера он попал в общий бандл
(crmStore → sessionMoney → currency), и у разлогиненного человека на /login запрос
получал 401, а перехватчик API перезагружал /login — снова запрос, и так по кругу.
Страница входа висела пустой с крутилкой у всех, кто вышел из аккаунта.

Что держит:
  * currency.ts не дёргает сеть на загрузке модуля без токена;
  * перехватчик 401 не перезагружает /login из-за фонового GET;
  * crmStore.fetchClients подтягивает курсы вошедшему.

    python3 backend/tests/guard_login_no_loop_2026_10.py
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]


def _read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def test_currency_module_does_not_fetch_without_token():
    src = _read("src/utils/currency.ts")
    assert not re.search(r"^fetchExchangeRates\(\);", src, re.M), \
        "currency.ts снова грузит курсы на старте без проверки токена — цикл 401 на /login"
    assert "localStorage.getItem('token')" in src and "void fetchExchangeRates();" in src, \
        "загрузка курсов на старте должна быть только при токене"


def test_401_interceptor_does_not_reload_login_on_background_get():
    src = _read("src/api/client.ts")
    i = src.index("status === 401")
    block = src[i:i + 900]
    assert "pathname.startsWith('/login') && isReadOnly" in block, \
        "перехватчик 401 снова перезагружает /login из-за фонового GET"
    assert block.index("pathname.startsWith('/login') && isReadOnly") < block.index("window.location.href"), \
        "проверка /login должна стоять ДО перенаправления"


def test_crm_store_loads_rates_for_logged_in_user():
    src = _read("src/store/crmStore.ts")
    assert "import { fetchExchangeRates } from '../utils/currency';" in src
    i = src.index("fetchClients: async")
    assert "void fetchExchangeRates();" in src[i:i + 500], "fetchClients не подтягивает курсы"


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
    print("СТОРОЖ вход без цикла 2026-10: OK" if not failures else f"СТОРОЖ вход без цикла 2026-10 УПАЛ ({failures}) — деплой НЕ выкатывать")
    sys.exit(1 if failures else 0)
