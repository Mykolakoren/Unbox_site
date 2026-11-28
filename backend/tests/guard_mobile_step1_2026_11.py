"""СТОРОЖ mobile-step1 — «быстрые удобства» мобильной брони (28.11.2026, шаг 1 плана).

Только чтение исходников, без сети и базы.

Что ловит:
  Шторка   — системная «Назад» на Android закрывает только ВЕРХНЮЮ шторку; сторож
             (CloseWatcher) взводится заново, если шторка осталась открытой
             («Закрыть без сохранения?» → «Вернуться»); Esc не закрывает дважды.
  Сегодня  — кошелёк считает абонемент той же функцией, что «Я» и оплата;
             «Как обычно» не предлагает кабинет в закрытом центре (переезд 30.11);
             «Последняя бронь серии» помнит «не продлевать».
  После брони — «В календарь / Повторять / Как войти» только у своей подтверждённой
             одиночной брони (не админ «за другого», не заявка на одобрении);
             «Повторять каждую неделю» не теряет привязку к клиенту CRM.
  Календарь — время брони батумское (UTC+4) → точный момент; адрес с запятой
             не обрезается в .ics.
  Как войти — в открытый код сайта не попадают код двери и пароль Wi-Fi.

    python3 backend/tests/guard_mobile_step1_2026_11.py
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).parent.parent.parent


def _read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def _block(src: str, start: str, end: str) -> str:
    i = src.find(start)
    assert i != -1, f"не нашли «{start}»"
    j = src.find(end, i)
    assert j != -1, f"не нашли конец блока после «{start}»"
    return src[i:j]


# ── Шторка ──────────────────────────────────────────────────────────────

def test_sheet_back_closes_only_top_and_rearms():
    src = _read("src/components/ui/Sheet.tsx")
    assert "CloseWatcher" in src, "шторка больше не слушает системную «Назад»"
    arm = _block(src, "const arm = () => {", "// Фокус внутрь")
    assert "openStack[openStack.length - 1] === id && dismissibleRef.current" in arm, \
        "«Назад» закрывает не только верхнюю шторку (или «незакрываемую»)"
    assert arm.count("arm()") >= 3, \
        "сторож «Назад» не взводится заново — вторая «Назад» уведёт со страницы с несохранённой формой"
    assert "presentRef.current" in arm, "шторка, которая уже уезжает, закрывается второй раз"
    esc = _block(src, "const onKey = (e: KeyboardEvent) => {", "document.addEventListener('keydown', onKey)")
    assert "e.preventDefault()" in esc, "Esc закроет шторку дважды (обработчик + CloseWatcher)"
    assert "history.pushState" not in src and "popstate" not in src, \
        "шторка полезла в историю браузера — сломает маршруты и «Назад» у страниц"


# ── Сегодня ─────────────────────────────────────────────────────────────

def test_today_wallet_and_usual_slot():
    src = _read("src/pages/mobile/MobileToday.tsx")
    assert "subscriptionOverview(sub, bookings, currentUser.email)" in src, \
        "кошелёк считает часы абонемента иначе, чем «Я» и оплата"
    regular = _block(src, "const regularSlot = useMemo(", "/** Last 5 distinct")
    assert "locationClosedReason(room.locationId, next)" in regular, \
        "«Как обычно» снова предлагает кабинет в закрытом центре — касание кончится отказом"
    ret = src[src.find("    return (\n        <>"):]
    i_hero, i_wallet = ret.find("<NextMeetingCard"), ret.find('aria-label="Кошелёк"')
    i_btn, i_usual = ret.find("Забронировать кабинет"), ret.find('aria-label="Как обычно"')
    i_next = ret.find("<>Дальше</>")
    assert -1 not in (i_hero, i_wallet, i_btn, i_usual, i_next), "не нашли блоки «Сегодня»"
    assert i_hero < i_wallet < i_btn < i_usual < i_next, \
        "порядок «Сегодня»: встреча → кошелёк → главная кнопка → «как обычно» → «дальше»"
    # Кошелёк всегда одной высоты: бонус догружается позже, кнопка под ним не должна прыгать.
    assert "minHeight: 76" in src and "walletCells.length === 1 ?" not in src, \
        "кошелёк меняет высоту при загрузке бонуса — главная кнопка прыгает под пальцем"


def test_series_end_row_respects_choice():
    today = _read("src/pages/mobile/MobileToday.tsx")
    block = _block(today, "const endingSeries = useMemo(", "}, [sortedFuture, now]);")
    assert "dismissedSeriesEnds()" in block and "dismissed.has(gid)" in block, \
        "строка «Последняя бронь серии» не помнит «не продлевать»"
    assert "x.b.status !== 'confirmed'" in block, "в серию попали заявки на одобрении"
    helper = _read("src/pages/mobile/seriesEnd.ts")
    assert helper.count("try {") >= 3 and helper.count("catch") >= 3, \
        "seriesEnd без try/catch — в приватном режиме «Сегодня» упадёт"
    sheet = _read("src/pages/mobile/BookingDetailSheet.tsx")
    assert sheet.count("dismissSeriesEnd(groupId)") >= 2 and "restoreSeriesEnd(groupId)" in sheet, \
        "шторка брони не сообщает «Сегодня», что серию не продлевают / продлили"


# ── После брони ─────────────────────────────────────────────────────────

def test_done_screen_next_steps_only_for_own_confirmed_booking():
    src = _read("src/pages/mobile/MobileCheckout.tsx")
    assert "booking={doneFor ? null : doneBooking}" in src, \
        "админ «за другого» получил «В календарь / Повторять» на чужую бронь"
    done = _block(src, "function DoneScreen(", "/** Минуты от полуночи")
    for needle in ("booking && !pending ? bookingCalendarEvent(booking)",
                   "booking && !pending ? bookingEntry(booking)",
                   "!!booking && !pending && !!onRepeatWeekly",
                   "booking && !pending ? paymentLine(booking"):
        assert needle in done, f"у заявки на одобрении появились действия подтверждённой брони: {needle}"
    assert "цену покажем до подтверждения" in done, "«Повторять каждую неделю» не говорит, что цена будет до подтверждения"
    # Перезапуск оформления: с чистого листа, но с тем же клиентом CRM.
    assert "key={run.n}" in src and "startCrmClientId={run.crmClientId}" in src
    assert "useState<string>(startCrmClientId)" in src, \
        "«Повторять каждую неделю» теряет привязку к клиенту CRM"
    assert "уже оформлена — здесь её продолжение со следующей недели" in src, \
        "новое оформление не говорит, что первая бронь уже есть"


# ── Календарь и «Как войти» ─────────────────────────────────────────────

def test_calendar_event_time_and_text():
    view = _read("src/pages/mobile/bookingView.ts")
    ev = _block(view, "export function bookingCalendarEvent(", "\n}\n")
    assert "Date.UTC(" in ev and "start.getHours() - 4" in ev, \
        "событие календаря считает время по поясу телефона, а не по батумскому (UTC+4)"
    cal = _read("src/utils/calendar.ts")
    for field in ("SUMMARY:${icsText(", "DESCRIPTION:${icsText(", "LOCATION:${icsText("):
        assert field in cal, f".ics без экранирования ({field}) — адрес обрежется на запятой"


def test_entry_text_has_no_secrets():
    """«Как войти» лежит в открытом коде сайта: код двери и пароль Wi-Fi туда нельзя."""
    data = _read("src/utils/data.ts")
    locations = _block(data, "export const LOCATIONS", "];")
    for m in re.finditer(r"entry:\s*\[(.*?)\]", locations, flags=re.S):
        text = m.group(1).lower()
        assert not re.search(r"парол|wi-?fi|вай-?фай|код\s*(двери|домофона|:)|\b\d{4,}\b", text), \
            "в «Как войти» попал код или пароль — этот текст виден всем в коде сайта"


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
    print("СТОРОЖ mobile-step1: OK" if not failures else f"СТОРОЖ mobile-step1 УПАЛ ({failures}) — деплой НЕ выкатывать")
    sys.exit(1 if failures else 0)
