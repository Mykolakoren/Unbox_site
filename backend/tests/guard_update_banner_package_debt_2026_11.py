"""СТОРОЖ: «Сайт обновился» и долг за пакет одной строкой (владелец 10.11).

Поводы:
  • 09.11 у админа со старой вкладкой не было поля «причина поздней отмены»,
    а сервер уже требовал её — старый код против нового сервера.
  • Галя Белостоцкая: 160 ₾ недельного пакета экран делил на 108 «на бронях»
    и 52 «долги по броням вне списка» — админы не поняли, откуда 52.

Что держит:
  1  Сборка кладёт номер в код (VITE_BUILD_ID) и в dist/version.json.
  2  UpdateBanner смонтирован в App, сверяет номер раз в 5 минут и при возврате на
     вкладку, запрос без кэша; разошлись — «Сайт обновился» + «Обновить».
  3  Сервер: долг за пакет подписан «пакет 16 ч на неделю 09.11–15.11», в долге
     есть reason (subscription_purchase).
  4  Экран: долг за пакет НЕ раскладывается по броням; виден целиком в «Долги вне
     списка броней» с подписью пакета (компьютер и телефон).

    python3 backend/tests/guard_update_banner_package_debt_2026_11.py
"""
import importlib.util
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
os.environ.setdefault("ENVIRONMENT", "development")


def _ga():
    """Хелперы сторожа раскладки (R, B, _charge, _node, ROOT) — один раз."""
    if "ga" not in _CACHE:
        spec = importlib.util.spec_from_file_location("ga_alloc", os.path.join(HERE, "guard_balance_allocation_2026_10.py"))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        _CACHE["ga"] = mod
    return _CACHE["ga"]


_CACHE: dict = {}


def test_build_version_and_banner():
    ga = _ga()
    vite = (ga.ROOT / "vite.config.ts").read_text(encoding="utf-8")
    assert "fileName: 'version.json'" in vite and "buildVersionFile()" in vite, "1: сборка не пишет version.json"
    assert "'import.meta.env.VITE_BUILD_ID': JSON.stringify(BUILD_ID)" in vite, "1: номер сборки не в коде"
    banner = ga._code("src/components/UpdateBanner.tsx")
    assert "fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })" in banner, "2: запрос версии с кэшем"
    assert "visibilitychange" in banner and "5 * 60 * 1000" in banner, "2: нет проверки по таймеру/возврату"
    assert "server !== MY_BUILD" in banner and "Сайт обновился." in banner and "window.location.reload()" in banner
    assert "import.meta.env.PROD" in banner, "2: плашка только на проде"
    app = ga._code("src/App.tsx")
    assert "<UpdateBanner />" in app, "2: плашка не смонтирована в App"


def test_package_label_and_reason_on_server():
    ga = _ga()
    from app.services.balance_allocation import allocate
    bk = {"N": ga.B("N", "2026-11-08", price=20)}
    rows = [
        ga._charge("cN", "2026-11-07T06:00:00", 20, "N"),
        ga.R("p1", "2026-11-07T16:00:00", -160, "subscription_purchase", ref_type="user",
             description="Пакет 16 ч на неделю 09.11–15.11"),
    ]
    res = allocate(rows, bk, balance=-180)
    pkg = [d for d in res["debts"] if d["bookingId"] is None]
    assert pkg and pkg[0]["label"] == "пакет 16 ч на неделю 09.11–15.11", pkg
    assert pkg[0]["reason"] == "subscription_purchase", pkg
    old = allocate([ga.R("s1", "2026-11-07T16:00:00", -70, "subscription_purchase", ref_type="user",
                         description="Абонемент «Пробный»")], {}, balance=-70)
    assert old["debts"][0]["label"] == "абонемент «Пробный»", "3: подпись обычного абонемента сломалась"
    _CACHE["galya"] = res


def test_package_debt_one_line_on_screens():
    ga = _ga()
    if "galya" not in _CACHE:
        test_package_label_and_reason_on_server()
    res = _CACHE["galya"]
    summary = {"userId": "id-g", "email": "g@demo.ge", "balance": -180, "consistent": True,
               "batches": res["batches"], "debts": res["debts"], "unlinked": ["N"]}
    win = [{"id": "N", "userId": "g@demo.ge", "date": "2026-11-08T00:00:00", "startTime": "10:00",
            "status": "completed", "paymentStatus": "paid", "paymentMethod": "balance", "finalPrice": 20}]
    out = ga._node("""
const balanceOf = uid => (uid === 'g@demo.ge' || uid === 'id-g' ? -180 : null);
const idx = m.indexAllocation([data.summary]);
const due = m.applyAllocation(m.computeDueByBooking(data.win, balanceOf), data.win, idx, balanceOf);
const h = m.hiddenDebts(due, data.win, idx, balanceOf);
console.log(JSON.stringify({ shown: due.get('N').due, hidden: h.map(x => [x.amount, x.packageLabels, m.hiddenDebtNote(x)]) }));
""", {"win": win, "summary": summary})
    if out is not None:
        assert out["shown"] == 20, f"4: на брони только её 20 ₾, пакет не размазан: {out}"
        assert out["hidden"] == [[160, ["пакет 16 ч на неделю 09.11–15.11"], "пакет 16 ч на неделю 09.11–15.11"]], out
    for rel in ("src/pages/admin/Dashboard.tsx", "src/pages/mobile/admin/MobileAdminDashboard.tsx"):
        code = ga._code(rel)
        assert "hiddenDebtNote(" in code, f"{rel}: нет подписи пакета у должника"
        assert "Долги вне списка броней:" in code, rel
    alloc = ga._code("src/utils/balanceAllocation.ts")
    assert re.search(r"if \(isPackageDebt\(d\)\) continue;", alloc), "4: пакет снова раскладывается по броням"


if __name__ == "__main__":
    for name, fn in sorted(dict(globals()).items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("  ✓", name)
    print("СТОРОЖ update_banner_package_debt: OK")
