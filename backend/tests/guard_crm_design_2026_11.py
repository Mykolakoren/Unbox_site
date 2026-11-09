"""СТОРОЖ вида Psy-CRM на телефоне (/m/crm), 09.11 фаза 3.

Дизайн-ревью CRM (review/crm-design.md) нашло: одна и та же строка списка
нарисована пятью способами, на «Сегодня» спорят четыре главные кнопки и три
чёрные массы, долг то жёлтый, то красный, «Часы приёма» — в чужом стиле
(компьютерный Grid House), скругления 8/10/12/14/16 вперемешку. Здесь — что
экраны собраны из общих деталей, и старое не вернулось (только чтение исходников):

  * списки — общий ListGroup + ListRow (Сегодня, Сессии, Клиенты, история клиента,
    Финансы, Заметки, строки шторки сессии, Часы приёма);
  * шапки корней разделов — MobilePageHeader variant="large";
  * итоги — SummaryCard (Финансы, деньги в карточке клиента);
  * нет чёрного (ink) как фона «выбранного» и больших блоков; выбранный день
    недели — accent-soft + рамка accent; главная плитка шторки — accent, не ink;
  * долг — <Money tone="debt"> / класс долга, никогда не янтарь (pending) в карточке;
  * на «Сегодня» одна главная кнопка: оплата в строке — Button size="sm" secondary;
  * скругления в /m/crm — только 8 / 16 / круг;
  * поиск — один компонент CrmSearch на трёх экранах;
  * /m/crm/schedule — мобильный вид MobileCrmSchedule (одна кнопка «Сохранить»);
  * фон оболочки CRM — бумага (COLOR.paper), не карточка.

    python3 backend/tests/guard_crm_design_2026_11.py
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).parent.parent.parent
MCRM = ROOT / "src" / "pages" / "mobile" / "crm"


def _strip_comments(src: str) -> str:
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return re.sub(r"(?m)(^|[^:'\"])//[^\n]*", r"\1", src)


def _code(name: str) -> str:
    return _strip_comments((MCRM / name).read_text(encoding="utf-8"))


def _all():
    return {p.name: _code(p.name) for p in sorted(MCRM.glob("*.tsx"))}


def test_lists_use_shared_list_row():
    for name in ("MobileCrmToday.tsx", "MobileCrmSessions.tsx", "MobileCrmClients.tsx", "MobileCrmClient.tsx",
                 "MobileCrmFinance.tsx", "MobileCrmNotes.tsx", "SessionActionSheet.tsx", "MobileCrmSchedule.tsx"):
        code = _code(name)
        assert "from '../../../components/ui/ListRow'" in code and "<ListRow" in code, \
            f"{name}: список снова нарисован своими карточками, а не общим ListRow"
    # Старые самодельные строки не вернулись.
    assert "function SessionLine(" not in _code("MobileCrmToday.tsx"), "«Сегодня»: своя SessionLine вместо ListRow"
    assert "TONE_BG" not in _code("MobileCrmSessions.tsx"), "«Сессии»: цветная плитка-значок на каждой строке"
    assert "rowBase" not in _code("MobileCrmClient.tsx"), "история клиента: отдельная карточка на строку"
    assert "function TotalCell(" not in _code("MobileCrmFinance.tsx"), "«Финансы»: свои ячейки итогов вместо SummaryCard"


def test_large_headers_on_section_roots():
    for name in ("MobileCrmToday.tsx", "MobileCrmSessions.tsx", "MobileCrmClients.tsx", "MobileCrmFinance.tsx",
                 "MobileCrmNotes.tsx", "MobileCrmClient.tsx", "MobileCrmProfile.tsx", "MobileCrmSchedule.tsx"):
        code = _code(name)
        assert "<MobilePageHeader" in code and 'variant="large"' in code, f"{name}: шапка не общая (28/14/16)"
        assert not re.search(r"<h1\b", code), f"{name}: свой <h1> рядом с общей шапкой"
    # Счётчики «Всего: 8 · показано: 8» не вернулись.
    for name in ("MobileCrmClients.tsx", "MobileCrmNotes.tsx"):
        assert "Всего: ${" not in _code(name), f"{name}: снова «Всего: N» в подзаголовке"


def test_summary_cards():
    assert "<SummaryCard" in _code("MobileCrmFinance.tsx"), "«Финансы»: итог месяца не SummaryCard"
    card = _code("MobileCrmClient.tsx")
    assert "<SummaryCard" in card, "карточка клиента: долг/ставка не SummaryCard"


def test_no_black_selected_or_blocks():
    for name, code in _all().items():
        for m in re.finditer(r"background:\s*([^,\n}]+)", code):
            val = m.group(1)
            assert "--color-ink)" not in val and not re.search(r"COLOR\.ink\b(?!\d)", val), \
                f"{name}: чёрный (ink) как фон — в тёмной теме светлое пятно: {val.strip()}"
        # on-ink допустим только у галочки оплаты (CheckMark на зелёном ok-fg).
        assert "var(--color-on-ink)" not in code or (name == "SessionActionSheet.tsx" and code.count("var(--color-on-ink)") == 1), \
            f"{name}: on-ink — значит, рядом ink-заливка"
    today = _code("MobileCrmToday.tsx")
    assert "selected ? 'var(--color-accent-soft)'" in today and "inset 0 0 0 1.5px var(--color-accent)" in today, \
        "выбранный день недели — не стиль «выбрано» (accent-soft + рамка accent)"
    assert "background: 'var(--color-panel)'" in today, "«Дальше» — не --color-panel"
    sheet = _code("SessionActionSheet.tsx")
    tile = sheet[sheet.index("function ActionTile("):sheet.index("function FormShell(")]
    assert "tone === 'primary' ? 'var(--color-accent)'" in tile, "главная плитка шторки снова ink (белое пятно в тёмной теме)"


def test_debt_is_danger_never_amber():
    card = _code("MobileCrmClient.tsx")
    assert "moneyToneClass(1, 'debt')" in card, "карточка клиента: долг не в тоне danger"
    assert "status-pending-bg" not in card, "карточка клиента: долг снова янтарный"
    assert 'tone="debt"' in _code("MobileCrmClients.tsx"), "«Клиенты»: долг не <Money tone=\"debt\">"
    assert 'tone="debt"' in _code("MobileCrmFinance.tsx"), "«Финансы»: долг не <Money tone=\"debt\">"
    assert 'tone="debt"' in _code("MobileCrmSessions.tsx"), "«Сессии»: долг не <Money tone=\"debt\">"
    fin = _code("MobileCrmFinance.tsx")
    assert "status-danger-bg" not in fin, "«Финансы»: красные аватарки — красным только суммы"


def test_one_primary_on_today():
    today = _code("MobileCrmToday.tsx")
    close = today[today.index('title="Закрыть день"'):today.index('title="Аренда без сессии"')]
    pay = close[close.index("quickPay.pay(s)") - 400:close.index("quickPay.pay(s)")]
    assert 'variant="secondary"' in pay and 'size="sm"' in pay, "оплата в строке снова бирюзовая главная кнопка"
    assert "Другая дата · ${formatDayMonth" not in today, "дата снова повторена на кнопке «Другая дата»"


def test_radii_only_8_16_round():
    bad = []
    for name, code in _all().items():
        for m in re.finditer(r"(?:borderRadius|radius)\s*[:=]\s*\{?\s*(\d+)", code):
            v = int(m.group(1))
            if v not in (0, 8, 16, 999):
                bad.append(f"{name}: {m.group(0)}")
    assert not bad, f"скругления вне шкалы 8 / 16 / круг: {bad}"


def test_one_search_component():
    for name in ("MobileCrmClients.tsx", "MobileCrmSessions.tsx", "MobileCrmNotes.tsx"):
        code = _code(name)
        assert "<CrmSearch" in code, f"{name}: поиск снова свой (три вида на трёх экранах)"
        assert not re.search(r"<input\b", code), f"{name}: самодельное поле вместо общего"


def test_schedule_is_mobile_view():
    sched = (ROOT / "src" / "pages" / "crm" / "CrmSchedule.tsx").read_text(encoding="utf-8")
    assert "const View = compact ? MobileCrmSchedule : GridHouseCrmSchedule;" in sched, \
        "/m/crm/schedule снова рисует компьютерный Grid House"
    mob = _code("MobileCrmSchedule.tsx")
    assert "GH_MONO" not in mob and "fontFamily" not in mob, "мобильные «Часы приёма»: снова моно-подписи Grid House"
    assert mob.count("onClick={handleSave}") == 1, "в «Часах приёма» снова две кнопки «Сохранить»"
    # 09.11 фаза 3 (общие файлы): переключатель вынесен в общий components/ui/Switch.
    sw = (ROOT / "src" / "components" / "ui" / "Switch.tsx").read_text(encoding="utf-8")
    css = (ROOT / "src" / "styles" / "ui.css").read_text(encoding="utf-8")
    assert "<Switch" in mob and "components/ui/Switch'" in mob, "«Часы приёма» не на общем Switch"
    assert 'role="switch"' in sw and re.search(r'\.ui-switch\[aria-checked="true"\] \.ui-switch__track \{ background: var\(--color-accent\)', css), \
        "переключатель дня не бирюзовый switch"


def test_shell_on_paper():
    lay = _code("MobileCrmLayout.tsx")
    assert lay.count("background: COLOR.paper") >= 2, "фон оболочки CRM снова карточка, а не бумага"


def test_profile_bio_without_raw_markup():
    prof = _code("MobileCrmProfile.tsx")
    assert "function renderBio(" in prof and "<BioField" in prof, "«О себе» снова показывает «##» как текст"
    assert "function Section(" in prof and "border: '1px solid var(--color-ink-08)'" not in prof[prof.index("function Section("):prof.index("function BioField(")], \
        "поле анкеты снова в карточке-коробке"


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
    print("СТОРОЖ вид Psy-CRM 2026-11: OK" if not failures
          else f"СТОРОЖ вид Psy-CRM 2026-11 УПАЛ ({failures}) — деплой НЕ выкатывать")
    sys.exit(1 if failures else 0)
