"""Сторож вида мобильной админки /m/admin (09.11, фаза 3, review/admin-design.md).

Только вид, без денег: экраны собраны из общих деталей дизайн-системы
(ListRow / SummaryCard / MobilePageHeader / Money tone), нет чёрных «выбранных»
и чёрных/круглых главных кнопок, скругления — только 8 / 16 / круг.

    python3 backend/tests/guard_admin_design_2026_11.py
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
MA = ROOT / "src/pages/mobile/admin"


def _read(p: pathlib.Path) -> str:
    return p.read_text(encoding="utf-8")


def _code(p: pathlib.Path) -> str:
    """Код без комментариев (// … и /* … */), чтобы пояснения не обманывали проверки."""
    s = _read(p)
    s = re.sub(r"/\*.*?\*/", "", s, flags=re.S)
    s = re.sub(r"(?m)^\s*//.*$", "", s)
    s = re.sub(r"\{\s*\}", "{}", s)
    return s


def _screens():
    return sorted(p for p in MA.glob("*.tsx"))


# ── Одна строка брони (admin-design №3, №4) ───────────────────────────────

def test_one_booking_row():
    row = _code(MA / "AdminBookingRow.tsx")
    assert "<ListRow" in row and "<ListTime" in row, "строка брони не на общем ListRow + ListTime"
    assert "trail={badge}" in row, "справа должна быть ОДНА плашка"
    assert "tone={owes ? 'danger'" in row, "долг — полосой danger на строке"
    for name in ("MobileAdminDashboard.tsx", "MobileAdminBookings.tsx", "MobileAdminUserCard.tsx"):
        code = _code(MA / name)
        assert "<AdminBookingRow" in code, f"{name}: своя строка брони вместо AdminBookingRow"
        assert "<ListGroup" in code, f"{name}: брони снова стопкой карточек, а не одной группой"
    b = _code(MA / "MobileAdminBookings.tsx")
    assert "<StatusBadge" not in b, "в «Бронях» снова вторая плашка статуса справа"
    assert "whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'" not in b, \
        "имя клиента снова режется многоточием («Ната…»)"


# ── Списки с действиями (№5, №21, №24) ────────────────────────────────────

def test_lists_on_list_row():
    for name in ("MobileAdminUsers.tsx", "MobileAdminTeam.tsx", "MobileAdminSpecialists.tsx",
                 "MobileAdminCabinets.tsx", "MobileAdminAccessRights.tsx", "MobileAdminCrm.tsx",
                 "MobileAdminWaitlist.tsx"):
        code = _code(MA / name)
        assert "<ListRow" in code and "<ListGroup" in code, f"{name}: список не на ListGroup/ListRow"
    for name in ("MobileAdminTeam.tsx", "MobileAdminSpecialists.tsx", "MobileAdminCabinets.tsx"):
        code = _code(MA / name)
        part = code[code.index("function CabinetsTab("):code.index("function MaintenanceTab(")] if "CabinetsTab" in code else code
        assert 'size="touch"' not in part, f"{name}: снова 44-px кнопки «Выключить» в строке"
        assert 'size="sm"' in code, f"{name}: действие в строке — не тихая кнопка sm"
        assert "dimmed={" in code, f"{name}: выключенное не бледнее"
    users = _code(MA / "MobileAdminUsers.tsx")
    assert 'tone="balance"' in users, "баланс в «Клиентах» не через Money tone=balance (0 серый, минус красный)"
    rights = _code(MA / "MobileAdminAccessRights.tsx")
    assert "<table" not in rights and "<AdminAccessRights" not in rights, "«Права доступа» снова таблица с компьютера"


# ── Шапки и главная кнопка (№6, №7, №13) ─────────────────────────────────

def test_headers_and_primary_button():
    large = ("MobileAdminDashboard.tsx", "MobileAdminBookings.tsx", "MobileAdminUsers.tsx",
             "MobileAdminInbox.tsx", "MobileAdminFinance.tsx", "MobileAdminTasks.tsx")
    inner = ("MobileAdminTeam.tsx", "MobileAdminSpecialists.tsx", "MobileAdminCabinets.tsx",
             "MobileAdminKB.tsx", "MobileAdminCrm.tsx", "MobileAdminWaitlist.tsx",
             "MobileAdminAccessRights.tsx", "MobileAdminUserCard.tsx")
    for name in large:
        code = _code(MA / name)
        assert "<MobilePageHeader" in code and 'variant="large"' in code, f"{name}: шапка раздела не общая крупная"
        assert "<h1" not in code, f"{name}: свой H1 вместо MobilePageHeader"
    for name in inner:
        code = _code(MA / name)
        assert "<MobilePageHeader" in code and "<h1" not in code, f"{name}: внутренний экран без общей шапки со «←»"
    for name in ("MobileAdminTeam.tsx", "MobileAdminKB.tsx"):
        code = _read(MA / name)
        assert "Команда · {members.length}" not in code and "База знаний · {SECTIONS.length}" not in code, \
            f"{name}: заголовок снова продублирован подписью раздела"
    for name in ("MobileAdminDashboard.tsx", "MobileAdminBookings.tsx"):
        code = _code(MA / name)
        assert 'className="ui-btn ui-btn--primary"' in code, f"{name}: «+ Бронь» не главная бирюзовая кнопка"
    fin = _code(MA / "MobileAdminFinance.tsx")
    assert "position: 'fixed'" not in fin, "в «Кассе» снова плавающая круглая кнопка поверх сумм"
    assert "Операция" in fin and "setShowAdd(true)" in fin
    tasks = _code(MA / "MobileAdminTasks.tsx")
    assert "position: 'fixed'" not in tasks, "«Новая задача» снова полосой над нижним меню"


# ── Деньги одним правилом (№9, №11) ───────────────────────────────────────

def test_money_tones():
    fin = _code(MA / "MobileAdminFinance.tsx")
    row = fin[fin.index("function TransactionRow("):fin.index("function txClient(")]
    assert 'tone="flow"' in row, "сумма операции не через Money tone=flow"
    assert "var(--status-danger" not in row, "расход в кассе снова красный (красный — только долг)"
    assert "<SummaryCard" in fin, "«Сейчас в кассе» / итоги не на SummaryCard"
    total = fin[fin.index("function TotalCell("):fin.index("function TransactionRow(")]
    assert 'tone="flow"' in total, "итоги периода не через Money tone=flow"
    card = _code(MA / "MobileAdminUserCard.tsx")
    assert "<SummaryCard" in card and 'tone="balance"' in card and 'tone="flow"' in card, \
        "карточка клиента: баланс/лента не по правилу Money"
    dash = _code(MA / "MobileAdminDashboard.tsx")
    assert 'tone="debt"' in dash and "num-inline" in dash


# ── Тёмная тема: нет чёрных «выбранных» и чёрных кнопок ────────────────────

def test_no_ink_fills():
    bad = re.compile(r"background:\s*(?:'var\(--color-ink\)'|COLOR\.ink\b|GH\.ink\b)")
    for p in _screens():
        assert not bad.search(_code(p)), f"{p.name}: заливка ink (в тёмной теме — белая плита)"
    lay = _code(MA / "MobileAdminLayout.tsx")
    assert "background: COLOR.paper" in lay, "фон админки снова card, а не бумага"
    assert "themed('var(--color-panel)', 'var(--color-paper)')" in lay, "в тёмной теме шапка светлее страницы"
    desk = _code(ROOT / "src/pages/admin/AdminLayout.tsx")
    assert "background: active ? GH.ink" not in desk and "background: active ? 'var(--color-accent-soft)'" in desk, \
        "в боковом меню компьютера выбранный пункт снова залит ink"


# ── Один счётчик (№14) ────────────────────────────────────────────────────

def test_one_counter():
    # 09.11 фаза 3 (общие файлы): AdminCounter переехал в components/ui/Counter (+ .ui-counter в ui.css).
    c = _code(ROOT / "src/components/ui/Counter.tsx")
    css = (ROOT / "src/styles/ui.css").read_text(encoding="utf-8")
    assert "ui-counter" in c and re.search(r"\.ui-counter \{[^}]*background: var\(--status-danger-solid\)", css)
    lay = _code(MA / "MobileAdminLayout.tsx")
    assert "<Counter value={badge}" in lay and "background: 'var(--status-pending-fg)'" not in lay
    spec = _code(MA / "MobileAdminSpecialists.tsx")
    assert "<Counter" in spec


# ── Скругления только 8 / 16 / круг (№22) ──────────────────────────────────

def test_radii_scale():
    ok = {"8", "16", "0", "'var(--radius-pill)'", "'var(--radius-card)'", "'var(--radius-control)'"}
    for p in _screens():
        code = _code(p)
        for m in re.finditer(r"border(?:Top|Bottom)?(?:Left|Right)?Radius:\s*([^,}\n]+)", code):
            val = m.group(1).strip()
            parts = re.findall(r"\?\s*([^:]+?)\s*:\s*(.+)$", val)
            vals = [x.strip() for x in parts[0]] if parts else [val]
            for v in vals:
                assert v in ok, f"{p.name}: скругление {v} вне шкалы 8/16/круг"


def _run():
    fails = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"  ✓ {name}")
            except Exception as e:  # noqa: BLE001
                fails += 1
                print(f"  ✗ {name}: {e!r}")
    return fails


if __name__ == "__main__":
    sys.exit(1 if _run() else 0)
