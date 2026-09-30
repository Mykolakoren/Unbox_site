"""СТОРОЖ волны 0, пакет E — честные состояния клиентского приложения /m.

29.09 аудит:
  X5-02 / X1-design-system-M2 — «Сегодня» и «Мои брони» писали «броней нет»,
      пока брони грузились и когда запрос падал; сбой /bookings/me стирал уже
      показанный список.
  X5-01 — «Свободно» при сбое /bookings/public выдавало занятые кабинеты за
      свободные (клиент узнавал об этом только на оформлении).
  X5-states-speed-M2 — привязка кабинета к сессии и перенос: чип можно было
      нажать повторно, пока идёт запрос → вторая бронь со списанием / второй
      перенос.

Проверки — по исходникам фронта, без сети и базы:

    python3 backend/tests/guard_wave0_E.py
"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
SRC = ROOT / "src"


def _read(rel: str) -> str:
    return (SRC / rel).read_text(encoding="utf-8")


def _fetch_bookings_body() -> str:
    src = _read("store/slices/createBookingSlice.ts")
    i = src.find("fetchBookings: async")
    assert i != -1, "не нашли fetchBookings в createBookingSlice"
    return src[i:src.find("fetchAllBookings:", i)]


# ─────────────────────────────────────────────────────────────────────────
# X5-02 / X5-01 — сбой загрузки не стирает данные и не выдаётся за «пусто»
# ─────────────────────────────────────────────────────────────────────────

def test_fetch_bookings_keeps_old_data_on_failure():
    """Упавшая часть (/me или /public) не заменяется пустым списком — берутся
    прошлые данные этой части. Иначе «броней нет» / «всё свободно»."""
    body = _fetch_bookings_body()
    assert "let myBookings: BookingHistoryItem[] = [];" not in body, \
        "сбой /me снова превращается в пустой список — брони «пропадут» с экрана"
    assert "prev.filter(b => !!b.userId)" in body, "сбой /me стирает уже загруженные мои брони"
    assert "prev.filter(b => !b.userId)" in body, "сбой /public стирает занятость кабинетов"


def test_fetch_bookings_sets_statuses():
    """У броней и занятости есть статус: экран обязан отличать
    «грузим» / «ошибка» / «правда пусто»."""
    body = _fetch_bookings_body()
    assert "bookingsStatus: myOk ? 'ready' : 'error'" in body, "нет статуса загрузки моих броней"
    assert "occupancyStatus: publicOk ? 'ready' : 'error'" in body, "нет статуса загрузки занятости"
    assert "bookingsLoadedAt: Date.now()" in body, "нет времени последней удачной загрузки"
    assert "'loading'" in body, "первая загрузка / повтор не помечаются как 'loading'"
    types = _read("store/types.ts")
    for field in ("bookingsStatus: LoadStatus", "bookingsLoadedAt: number | null", "occupancyStatus: LoadStatus"):
        assert field in types, f"в BookingSlice пропало поле {field}"


def test_fetch_bookings_drops_stale_response():
    """Два параллельных fetchBookings (App.tsx + экран): поздний ответ
    старого запроса не должен перетирать свежий."""
    body = _fetch_bookings_body()
    assert "if (seq < appliedSeq) return;" in body, \
        "нет защиты от гонки: запоздавший старый ответ снова перетрёт свежие данные"


def test_today_empty_only_after_load():
    """/m/today: «Ближайших сессий нет» — только после загрузки; до неё
    заглушки, при сбое — ошибка с «Повторить»."""
    src = _read("pages/mobile/MobileToday.tsx")
    # Волна 2: «Сегодня» по варианту V1 — вместо списка «Ближайшие» карточка
    # ближайшей встречи; пустое состояние — «Пока ничего не забронировано».
    # Суть та же: «ничего нет» — только после загрузки.
    j = src.find('title="Пока ничего не забронировано"')
    assert j != -1, "не нашли пустое состояние «Пока ничего не забронировано»"
    i = src.rfind("<StaleBar", 0, j)
    assert i != -1, "не нашли блок ближайшей встречи (StaleBar перед пустым состоянием)"
    block = src[i:j]
    assert "bookingsLoadedAt == null" in block, "«ничего не забронировано» снова показывается до загрузки"
    assert "<SkeletonRows" in block and "<LoadErrorCard" in block and "<StaleBar" in block, \
        "пропали заглушки / ошибка с «Повторить» / плашка «данные на HH:MM»"


def test_my_bookings_empty_only_after_load():
    """/m/bookings: без загрузки нет «· 0» и «броней нет»; опечатка исправлена."""
    src = _read("pages/mobile/MobileMyBookings.tsx")
    assert "Будущих бронь" not in src, "вернулась опечатка «Будущих бронь»"
    assert "Будущих броней пока нет" in src
    assert "loaded ? `Будущие · ${upcoming.length}` : 'Будущие'" in src, \
        "счётчик «Будущие · 0» снова показывается до загрузки"
    for tab in ("upcoming", "series", "past"):
        assert f"loaded && tab === '{tab}'" in src, f"вкладка {tab} показывает «пусто» до загрузки"
    assert "<SkeletonRows" in src and "<LoadErrorCard" in src and "<StaleBar" in src


def test_own_bookings_filter_uses_camel_case_uuid():
    """После toCamelCase поле называется userUuid; user_uuid всегда undefined —
    мёртвая проверка прятала брони, где user_id ≠ текущий email."""
    for rel in ("pages/mobile/MobileToday.tsx", "pages/mobile/MobileMyBookings.tsx", "pages/mobile/MobileCalendar.tsx"):
        src = _read(rel)
        assert "(b as any).user_uuid" not in src, f"{rel}: снова мёртвая проверка user_uuid"
        assert "(b as any).userUuid ===" in src, f"{rel}: пропала проверка по userUuid"


def test_find_hides_free_rooms_until_occupancy_ready():
    """/m/find: пока занятость не загружена или упала — никаких «свободно»."""
    src = _read("pages/mobile/MobileFind.tsx")
    assert "const occupancyReady = occupancyStatus === 'ready';" in src
    assert "{occupancyReady && slots.map(" in src, \
        "чипы снова показываются без загруженной занятости — занятые кабинеты выглядят свободными"
    assert "occupancyStatus === 'error' && (" in src and "<LoadErrorCard" in src, \
        "при сбое занятости нет ошибки с «Повторить»"


# ─────────────────────────────────────────────────────────────────────────
# X5-states-speed-M2 — повторный тап по чипу во время привязки/переноса
# ─────────────────────────────────────────────────────────────────────────

def test_find_chips_guard_double_tap():
    src = _read("pages/mobile/MobileFind.tsx")
    i = src.find("async function chooseWindow(")
    assert i != -1, "не нашли chooseWindow"
    head = src[i:src.find("if (linkSessionMeta) {", i)]
    assert "if (inFlightRef.current) return;" in head, \
        "chooseWindow снова пускает второй тап, пока идёт запрос — вторая бронь / второй перенос"
    body = src[i:src.find("// Normal create path", i)]
    link = body[body.find("if (linkSessionMeta) {"):body.find("bookingsApi.createBooking(")]
    assert "inFlightRef.current = true;" in link, "привязка: блокировка ставится не ДО запроса"
    resch = body[body.find("if (rescheduleBooking) {"):body.find("bookingsApi.rescheduleBooking(")]
    assert "inFlightRef.current = true;" in resch, "перенос: блокировка ставится не ДО запроса"
    assert "disabled={chipsBusy}" in src, "чипы не блокируются, пока идёт запрос"
    assert "const isPending = pendingChip ===" in src and '<Loader2 size={11} className="animate-spin" />' in src, \
        "нет спиннера на нажатом чипе — человек не видит, что запрос идёт, и жмёт ещё раз"


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
    print("СТОРОЖ E: OK" if not failures else f"СТОРОЖ E УПАЛ ({failures}) — деплой НЕ выкатывать")
    sys.exit(1 if failures else 0)
