"""СТОРОЖ wave1 — доделки после ревизий (30.09).

Без сети и базы, только чтение исходников:
  1. «Отменено 5 броней» (а не «5 бронь»); Esc не закрывает карточку брони,
     пока поверх открыто старое окно «Сократить бронь».
  5. Мастер брони на телефоне: стрелки недели отдельной строкой (44×44),
     дни во всю ширину; «Далее» заблокирована, пока открыт вопрос
     «Кабинеты пересекаются».
  7. «Режим CRM»: сбой заявки показывает тост, а не глотается молча.
  8. /admin/bookings сам грузит полный список и говорит «Броней не найдено»
     только после ответа; шторки не закрываются, пока идёт запрос.
 11. Псевдостатус «На пересдаче» живёт в общем словаре.
 12. Мёртвый код удалён и не вернулся (в т.ч. JoinWaitlistModal, который
     изображал отправку заявки, ничего не отправляя).

    python3 backend/tests/guard_wave1_consolidation.py
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).parent.parent.parent
SRC = ROOT / "src"


def _read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def _func_body(src: str, signature: str) -> str:
    """Текст функции от сигнатуры до следующей функции верхнего уровня."""
    i = src.index(signature)
    m = re.search(r"\n(?:export )?(?:function|const|type|interface) ", src[i + len(signature):])
    return src[i: i + len(signature) + (m.start() if m else len(src))]


# ── 1 ────────────────────────────────────────────────────────────────────

def test_series_cancel_plural_is_genitive():
    src = _read("src/pages/mobile/BookingDetailSheet.tsx")
    assert "['бронь', 'брони', 'броней']" in src, "тост отмены серии: нужна форма «броней»"
    # Нигде во фронте третья форма «бронь» («Отменено 5 бронь»).
    bad = []
    for p in SRC.rglob("*.ts*"):
        if re.search(r"['\"]бронь['\"],\s*['\"]брони['\"],\s*['\"]бронь['\"]", p.read_text(encoding="utf-8")):
            bad.append(p.relative_to(ROOT).as_posix())
    assert not bad, f"«5 бронь» — неверная форма множественного числа: {bad}"


def test_detail_sheet_esc_ignored_while_trimming():
    src = _read("src/pages/mobile/BookingDetailSheet.tsx")
    # Волна 2: шторка брони на общем Sheet — Esc обрабатывает он. Суть та же:
    # пока открыто окно «Сократить бронь», Esc/свайп карточку не закрывают.
    m = re.search(r"const onKey = \(e: KeyboardEvent\) => \{(.*?)\};", src, re.S)
    if m:
        assert "trimming" in m.group(1), \
            "Esc снова закрывает карточку под окном «Сократить бронь» (нужна проверка trimming)"
    else:
        assert "<Sheet" in src and "dismissible={!trimming}" in src, \
            "Esc снова закрывает карточку под окном «Сократить бронь» (нужно dismissible={!trimming})"


# ── 5 ────────────────────────────────────────────────────────────────────

def test_mobile_week_picker_days_not_squeezed_by_arrows():
    src = _read("src/components/Wizard/ChessboardStep.tsx")
    i = src.index("Week Picker — compact mobile")
    block = src[i: src.index("occupancyFailed &&", i)]
    # Стрелки — 44×44 и в отдельной строке: контейнер колонкой, дни — своей сеткой.
    assert block.count("minWidth: 44, minHeight: 44") >= 2, "стрелки недели меньше 44 px"
    assert "flexDirection: 'column'" in block, \
        "стрелки снова в одной строке с днями — на 375 px дни сжимаются до ~32 px"
    grid = block.index("gridTemplateColumns: 'repeat(7")
    assert block.index("Следующая неделя") < grid, "стрелки недели должны стоять над днями, а не по бокам"
    assert "minHeight: 44" in block[grid:], "кнопка дня ниже 44 px"


def test_next_blocked_while_overlap_dialog_open():
    src = _read("src/components/Wizard/ChessboardStep.tsx")
    body = src[src.index("const handleNext = async"):]
    body = body[: body.index("\n    };") + 7]
    assert "setNextPending(true)" in body and "finally" in body and "setNextPending(false)" in body, \
        "handleNext не блокирует повторный тап, пока открыт вопрос"
    assert "disabled={selectedSlots.length === 0}" not in src, "кнопка «Далее» не учитывает открытый вопрос"
    assert src.count("disabled={nextDisabled}") >= 4, "не все кнопки «Далее» блокируются на время вопроса"


# ── 7 ────────────────────────────────────────────────────────────────────

def test_crm_access_toggle_error_is_shown():
    src = _read("src/components/CrmAccessToggle.tsx")
    body = src[src.index("const handleToggle"):]
    m = re.search(r"catch\s*(?:\([^)]*\))?\s*\{(.*?)\}\s*finally", body, re.S)
    assert m, "не нашли catch у заявки на CRM"
    code = "\n".join(l for l in m.group(1).splitlines() if not l.strip().startswith("//"))
    assert "toast.error(" in code, "заявка на CRM снова глотает ошибку молча (пустой catch)"


# ── 8 ────────────────────────────────────────────────────────────────────

def test_admin_bookings_loads_full_list_before_empty_state():
    src = _read("src/pages/admin/Bookings.tsx")
    # Список грузит полный набор сам; шахматка — сама (без двойного запроса).
    assert re.search(r"if \(viewMode !== 'list' \|\| allListStatus === 'ready'\) return;\s*void loadAllBookings\(\);", src), \
        "/admin/bookings не грузит полный список на mount"
    assert "await fetchAllBookings()" in src, "loadAllBookings не зовёт fetchAllBookings"
    i = src.index('title="Броней не найдено"')
    before = src[max(0, i - 1500): i]
    assert "allListStatus === 'error'" in before and "allListStatus !== 'ready'" in before, \
        "«Броней не найдено» показывается до ответа полного админского списка"
    slice_src = _read("src/store/slices/createBookingSlice.ts")
    fab = slice_src[slice_src.index("fetchAllBookings: async"):slice_src.index("addBooking: async")]
    assert "return true" in fab and "return false" in fab, "fetchAllBookings не сообщает, пришёл ли список"


def test_admin_sheets_not_dismissible_while_busy():
    bk = _read("src/pages/admin/Bookings.tsx")
    rej = _func_body(bk, "function RejectBookingSheet(")
    assert "dismissible={!busy}" in rej, "«Отклонить бронь» закрывается посреди запроса"
    assert "onClick={onClose} disabled={busy}" in rej, "«Оставить» активна посреди запроса"
    ud = _read("src/pages/admin/UserDetails.tsx")
    uf = _func_body(ud, "function UserFieldSheets(")
    assert "dismissible={!busy}" in uf, "шторка поля пользователя закрывается посреди запроса"
    assert "onClick={onClose} disabled={busy}" in uf, "«Отмена» активна посреди запроса"


# ── 11 ───────────────────────────────────────────────────────────────────

def test_re_rent_listed_pseudo_status():
    src = _read("src/design/statuses.ts")
    m = re.search(r"'re-rent-listed':\s*\{([^}]*)\}", src)
    assert m, "нет псевдостатуса 're-rent-listed' в словаре"
    body = m.group(1)
    assert "'На пересдаче'" in body and "tone: 'pending'" in body and "icon: 'repeat'" in body, \
        "«На пересдаче»: подпись/тон/значок не те"
    assert "isReRentListed" in src, "нет пояснения, что это флаг isReRentListed, а не статус сервера"


# ── 12 ───────────────────────────────────────────────────────────────────

DEAD = (
    "src/components/Wizard/TimelineStep.tsx",
    "src/components/Booking/InteractiveTimeline.tsx",
    "src/components/WaitlistModal.tsx",
    "src/components/JoinWaitlistModal.tsx",
    "src/components/ReconciliationModal.tsx",
)


def test_dead_code_stays_deleted():
    back = [f for f in DEAD if (ROOT / f).exists()]
    assert not back, f"мёртвый код вернулся: {back}"
    names = [pathlib.Path(f).stem for f in DEAD]
    offenders = []
    for p in SRC.rglob("*.ts*"):
        text = p.read_text(encoding="utf-8")
        for n in names:
            if re.search(r"(?:import[^;]*\b%s\b|<%s\b)" % (n, n), text):
                offenders.append(f"{p.relative_to(ROOT).as_posix()}: {n}")
    assert not offenders, f"ссылки на удалённые компоненты: {offenders}"
    app = _read("src/App.tsx")
    assert "import { OptionsStep }" not in app or "<OptionsStep" in app, "в App.tsx снова лишний импорт OptionsStep"


if __name__ == "__main__":
    import sys
    failures = 0
    tests = [(n, f) for n, f in sorted(globals().items()) if n.startswith("test_") and callable(f)]
    for name, fn in tests:
        try:
            fn()
            print(f"  ✓ {name}")
        except AssertionError as exc:
            failures += 1
            print(f"  ✗ {name}: {exc}")
        except Exception as exc:  # noqa: BLE001
            failures += 1
            print(f"  ✗ {name}: {exc!r}")
    print(f"проверок: {len(tests)}")
    print("СТОРОЖ wave1-consolidation: OK" if not failures else f"СТОРОЖ wave1-consolidation УПАЛ ({failures})")
    sys.exit(1 if failures else 0)
