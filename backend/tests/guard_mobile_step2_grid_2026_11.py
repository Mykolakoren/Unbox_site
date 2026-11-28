"""СТОРОЖ mobile-step2 — сетка дня на «Свободно» (28.11.2026, шаг 2 плана мобильной брони).

Только чтение исходников, без сети и базы.

Что ловит:
  Начало    — где можно НАЧАТЬ бронь, решает прежний расчёт (buildFreeWindows →
              slots), а не сама сетка: иначе на сетке нажималось бы время,
              которое сервер отвергнет (прошедшее, «срочное» при переносе).
  Длина     — на полосе под сеткой только длительности, которые помещаются до
              ближайшей брони или закрытия; от часа до 9 часов.
  Перенос   — бронь двигается целиком: полосы с длительностями нет, касание
              сразу показывает «было → станет».
  Занятость — на сетке занят каждый получас, который бронь задевает (в том
              числе начало в :15/:45); пересдача — не занято; закрытые
              кабинеты и закрытые центры не показываются.
  Выделение — снимается при смене дня и когда время заняли, пока человек
              выбирал; пока идёт запрос — не трогается.
  Оформление — получает ровно выбранные получасы выбранного кабинета.
  Подписка  — «сообщить, когда освободится» только в обычной брони и только
              на будущее время.
  Календарь — отдельного экрана нет, старая ссылка ведёт на «Свободно».

    python3 backend/tests/guard_mobile_step2_grid_2026_11.py
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).parent.parent.parent
FIND = "src/pages/mobile/MobileFind.tsx"
GRID = "src/pages/mobile/DayGrid.tsx"
MODEL = "src/pages/mobile/dayGridModel.ts"


def _read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def _code(rel: str) -> str:
    src = _read(rel)
    src = re.sub(r"\{/\*.*?\*/\}", "", src, flags=re.S)
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return re.sub(r"(?m)(^|[^:'\"`\\])//.*$", r"\1", src)


def _block(src: str, start: str, end: str) -> str:
    i = src.find(start)
    assert i != -1, f"не нашли «{start}»"
    j = src.find(end, i)
    assert j != -1, f"не нашли конец блока после «{start}»"
    return src[i:j]


# ── Где можно начать ────────────────────────────────────────────────────

def test_start_is_decided_by_free_windows_not_by_grid():
    src = _code(FIND)
    startable = _block(src, "const startable = useMemo(", "}, [slots]);")
    assert "for (const w of slots) for (const rid of w.freeResIds) set.add(`${w.startMin}|${rid}`);" in startable, \
        "сетка сама решает, где можно начать, — мимо расчёта свободных окон"
    pick = _block(src, "function pickFree(", "function pickDuration(")
    assert "if (chipsBusy || inFlightRef.current) return;" in pick
    # Ревизия 28.11: бронь с началом в :15/:45 расчёт окон не видит, а сетка закрывает
    # оба соседних получаса — начать можно, только если согласны ОБА (иначе выделение
    # ложилось поверх чужой брони, и сервер отвечал «занято» уже на оформлении).
    gate = pick.find("if (!startable.has(`${startMin}|${roomId}`) || run < searchDuration) {")
    assert gate != -1, "касание сетки не сверяется со списком разрешённых начал и со свободным отрезком"
    assert pick.find("const run = freeRunMin(col, startMin, MAX_DURATION);") < gate
    assert gate < pick.find("setSelection("), "время выделяется раньше, чем проверено, что с него можно начать"
    # Окна считаются по всем центрам и типам помещений, под час (перенос — под всю бронь).
    assert "buildFreeWindows(occupancy, targetDate, searchDuration, EVERY_LOC, EVERY_SPACE, null, dayOffset === 0," in src
    assert "const searchDuration = rescheduleId ? duration : MIN_DURATION;" in src


def test_past_day_without_backdate_right_offers_nothing():
    """Чужая ссылка ?date=<прошлый день>: раньше список показывал такой день
    свободным, а сервер бронь отвергал."""
    src = _code(FIND)
    assert "if (daysBack > 0 && backdateMin === 0) return [];" in src, \
        "прошлый день без права «задним числом» снова предлагает время"


def test_closed_cells_follow_same_borders_as_windows():
    src = _code(FIND)
    past = _block(src, "const pastUntilMin = ", "const firstRowMin")
    for must in ("backdateMin === 0 ? Infinity", "nowMin - backdateMin + daysBack * 1440",
                 "nowMin - (canBackdate && showPast ? backdateMin : 0)"):
        assert must in past, f"граница «прошло» на сетке разошлась с расчётом окон: нет «{must}»"
    closed = _block(src, "closedReason={t => (", "/>")
    assert "t <= pastUntilMin ? 'прошло'" in closed and "restrictHot && isHotStart(targetYmd, t) ? 'через админа' : null" in closed, \
        "прошедшее или «срочное» при переносе время снова выглядит на сетке свободным"
    grid = _code(GRID)
    cell = _block(grid, "{cells.map(t => {", "{col.blocks.map(")
    assert -1 < cell.find("if (closed) {") < cell.find("<button"), "закрытое время на сетке — кнопка"


# ── Длительность ────────────────────────────────────────────────────────

def test_only_durations_that_fit():
    src = _code(FIND)
    fit = _block(src, "const fitDurations = useMemo(", "}, [selection, selCol]);")
    assert "const run = freeRunMin(selCol, selection.startMin, MAX_DURATION);" in fit
    assert "for (let d = MIN_DURATION; d <= run; d += GRID_STEP_MIN) out.push(d);" in fit, \
        "на полосе появились длительности, которые не помещаются до ближайшей брони"
    assert "MIN_DURATION = 60" in src and "MAX_DURATION = 9 * 60" in src
    pick = _block(src, "function pickFree(", "function pickDuration(")
    assert "duration: Math.max(MIN_DURATION, Math.min(duration, run))" in pick, \
        "привычная длительность не обрезается по свободному отрезку — бронь залезет на чужую"
    model = _code(MODEL)
    run = _block(model, "export function freeRunMin(", "\n}\n")
    assert "t < GRID_END_MIN" in run and "!col.busy.has(t)" in run and "t - startMin < capMin" in run


def test_reschedule_moves_whole_booking_without_bar():
    src = _code(FIND)
    assert "const barOpen = !!selection && !!selCol && !rescheduleId && occupancyReady;" in src, \
        "при переносе снова можно менять длительность на полосе"
    pick = _block(src, "function pickFree(", "function pickDuration(")
    resch = _block(pick, "if (rescheduleId) {", "return;")
    assert "void chooseWindow(startMin, roomId, searchDuration);" in resch
    choose = _block(src, "async function chooseWindow(", "const slotStrs: string[] = [];")
    assert "const moveMin = rescheduleBooking.duration ?? durMin;" in choose and "newDuration: moveMin," in choose
    assert "await askConfirm({" in choose and "title: 'Перенести бронь?'" in choose


# ── Занятость на сетке ──────────────────────────────────────────────────

def test_grid_busy_covers_every_touched_half_hour():
    model = _code(MODEL)
    build = _block(model, "export function buildDayColumns(", "\n}\n")
    assert "if (t < rawEnd && t + GRID_STEP_MIN > rawStart) col.busy.add(t);" in build, \
        "бронь с началом в :15/:45 закрывает не все получасы, которые задевает"
    assert build.find("if (kind === 'rerent') continue;") < build.find("col.busy.add(t)"), \
        "пересдача снова считается занятой — слот нельзя забрать"
    # Своя бронь — всегда «ваша» (даже на пересдаче): её можно открыть, поверх неё не бронируют.
    assert "isOwn(b) ? 'mine' : b.isReRentListed ? 'rerent' : 'busy'" in build
    rooms = _block(model, "export function roomsOpenOn(", "\n}\n")
    for must in ("locationIds.includes(r.locationId)", "r.isActive !== false", "isLocationOpenOn(r.locationId, dayKey)"):
        assert must in rooms, f"на сетке кабинет, который в этот день не сдаётся: нет «{must}»"
    find = _code(FIND)
    assert "const gridRooms = useMemo(() => roomsOpenOn(targetKey, ALL_LOCS), [targetKey]);" in find
    # Сетка считает занятость по тем же броням, что лента дней: подтверждённые и «на подтверждении».
    by_day = _block(find, "const occupancyByDay = useMemo(", "}, [occupancy]);")
    # completed — уже прошедшая бронь: у админа «задним числом» она тоже занимала время.
    assert "b.status !== 'confirmed' && b.status !== 'pending_approval' && b.status !== 'completed'" in by_day, \
        "прошедшие брони пропали с сетки — прошлый день у админа выглядит пустым"
    assert "buildDayColumns(occupancyByDay.get(targetKey) ?? [], gridRooms, isOwnBooking)" in find


def test_rerent_block_lets_taps_through():
    grid = _code(GRID)
    rerent = _block(grid, "if (block.kind === 'rerent') {", "if (block.kind === 'mine') {")
    assert "pointerEvents: 'none'" in rerent and "пересдача" in rerent, \
        "плашка «пересдача» перекрывает ячейки — слот на пересдаче не выбрать"
    find = _code(FIND)
    assert "{touchesReRent(selCol, selection.startMin, selection.startMin + selection.duration) && (" in find \
        and "Пересдача: это время освободил другой специалист" in find, \
        "бронь поверх пересдачи больше не помечена до оформления"


# ── Выделение ───────────────────────────────────────────────────────────

def test_selection_is_dropped_when_stale():
    src = _code(FIND)
    assert "useEffect(() => { setSelection(null); }, [targetKey]);" in src, \
        "выделение переживает смену дня — «Дальше» оформит не тот день"
    stale = _block(src, "if (!selection || inFlightRef.current) return;", "}, [columns]);")
    assert "freeRunMin(col, selection.startMin, selection.duration) < selection.duration" in stale \
        and "setSelection(null)" in stale, "время заняли, пока человек выбирал, а выделение осталось"


# ── Оформление ──────────────────────────────────────────────────────────

def test_checkout_gets_exactly_the_selected_half_hours():
    src = _code(FIND)
    choose = src[src.find("async function chooseWindow("):]
    normal = _block(choose, "const slotStrs: string[] = [];", "navigate('/m/checkout');")
    assert "for (let m = startMin; m < startMin + durMin; m += 30) {" in normal \
        and "slotStrs.push(`${resourceId}|${minsToHHMM(m)}`);" in normal, \
        "оформление получает не те получасы, что выбраны на сетке"
    assert "selectedSlots: slotStrs," in normal and "date: targetDate," in normal
    assert "onClick={() => pickWindow(selection.startMin, selection.roomId, selection.duration)}" in src
    link = _block(src, "function pickWindow(", "async function chooseWindow(")
    assert "if (linkSessionMeta) { setLinkPick({ startMin, resourceId, duration: durMin }); return; }" in link
    assert "void chooseWindow(linkPick.startMin, linkPick.resourceId, linkPick.duration);" in src, \
        "под сессию CRM бронь создаётся не той длительности, что показана в шторке с ценой"


# ── Что человек видит до «Дальше» ───────────────────────────────────────

def test_shortened_duration_is_said_in_words():
    """Привычные 2 часа (под сессию CRM — длительность сессии) не должны молча
    превращаться в час, если дальше занято."""
    src = _code(FIND)
    limit = _block(src, "const selLimit = (() => {", "})();")
    assert "if (duration > run) {" in limit and "Обычно вы берёте" in limit and "кабинет получится короче" in limit, \
        "укороченная длительность снова без объяснения"
    assert "{selLimit && (" in src
    assert "linkPick.duration < linkSessionMeta.duration" in src and "Бронь будет короче сессии." in src, \
        "кабинет короче сессии CRM бронируется без предупреждения"


def test_price_is_seen_before_tap_and_belongs_to_the_right_person():
    src = _code(FIND)
    hint = _block(src, "const priceHint = useMemo(() => {", "}, [gridRooms, peakVisible, peakTag]);")
    assert "gridRooms.map(r => r.hourlyRate)" in hint and "PRICING_CONFIG.peak_hours.surcharge_per_hour_gel" in hint, \
        "цена часа над сеткой написана руками, а не взята из данных"
    assert "'Нажмите на свободное время.'} ${priceHint}`" in src, "цена часа пропала с экрана до касания"
    # Админ-бронь «за другого»: скидка — клиента, а не самого админа.
    who = _block(src, "const priceUser = adminFlow", "const windowPrice")
    assert "bookingForUser ? users.find(u => u.email === bookingForUser || u.id === bookingForUser) ?? null : null" in who \
        and ": currentUser;" in who, "цена в полосе у админа снова считается по его собственной скидке"
    price = _block(src, "const windowPrice = (", "\n    };")
    assert "personalDiscountPercent: priceUser?.personalDiscountPercent," in price
    assert "peak: ind.finalPrice > 0 ? (ind.peakSurcharge ?? 0) : 0," in price, \
        "надбавка за пик в полосе считается не из самого расчёта цены"


def test_favourite_room_still_means_something():
    """В профиле есть «Любимый кабинет»: раньше он шёл первым в списке, теперь
    выделен на сетке (порядок колонок постоянный)."""
    src = _code(FIND)
    assert "highlightRoomId={cabParam ?? getFavoriteCabinet(currentUser?.id)}" in src, \
        "«Любимый кабинет» из профиля больше ни на что не влияет"
    prof = _read("src/pages/mobile/MobileProfile.tsx")
    assert "Покажем его первым" not in prof, "профиль обещает «покажем первым», а колонки на сетке не переставляются"


# ── Подписка и календарь ────────────────────────────────────────────────

def test_waitlist_only_for_future_time_in_plain_booking():
    src = _code(FIND)
    busy = _block(src, "function pickBusy(", "function pickWindow(")
    assert "while (from <= pastUntilMin && from < GRID_END_MIN) from += GRID_STEP_MIN;" in busy, \
        "подписка «когда освободится» ставится на прошедшее время"
    assert "onPickBusy={waitlistEnabled ? pickBusy : undefined}" in src
    grid = _code(GRID)
    assert "if (!onPickBusy) {" in grid, "занятое нажимается и там, где подписки нет (перенос, привязка к сессии)"


def test_calendar_route_redirects():
    app = _read("src/App.tsx")
    assert '<Route path="calendar" element={<Navigate to="/m/find" replace />} />' in app
    assert "MobileCalendar" not in re.sub(r"\{/\*.*?\*/\}", "", app, flags=re.S), "App.tsx снова подключает экран «Календарь»"


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
    print("СТОРОЖ mobile-step2: OK" if not failures else f"СТОРОЖ mobile-step2 УПАЛ ({failures}) — деплой НЕ выкатывать")
    sys.exit(1 if failures else 0)
