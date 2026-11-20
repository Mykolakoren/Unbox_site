"""СТОРОЖ: страницы /m листаются пальцем (чат админов 20.11).

Повод: «не листаются страницы сайта с телефона, проблема уже у нескольких
людей». У <main data-mobile-scroll> стояло overscroll-behavior-y: contain, но
сам main не прокручивается — оболочки /m растут по содержимому (minHeight
100vh), прокручивается страница. Свежие браузеры применяют contain и к такой
прокрутке без содержимого: свайп упирался в main и не доходил до страницы.
Проверено в мобильном Chrome: без contain свайп листает /m/find, /m/me,
/m/booking-rules; с contain — ни на одном из 10 экранов.

Что держит:
  1  У [data-mobile-scroll] нет overscroll-behavior (ни -y, ни общего).
  2  Оболочки /m (клиент, CRM, админ) по-прежнему растут по содержимому
     (minHeight), а не зажаты высотой экрана — иначе прокрутка переехала бы
     в main, и правило выше пришлось бы пересмотреть вместе с блокировкой
     фона под шторками.
  3  Настоящая внутренняя прокрутка (тело шторки) свой contain сохраняет —
     фон под шторкой не уезжает.

    python3 backend/tests/guard_mobile_touch_scroll_2026_11.py
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[2]


def _css_rules(text: str):
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", text):
        yield m.group(1).strip(), m.group(2)


def test_mobile_main_does_not_block_page_scroll():
    for rel in ("src/index.css", "src/styles/ui.css"):
        for sel, body in _css_rules((ROOT / rel).read_text(encoding="utf-8")):
            if "data-mobile-scroll" in sel and "scroll-locked" not in sel:
                assert "overscroll-behavior" not in body, \
                    f"1: {rel}: «{sel}» снова гасит свайп — страницы /m не листаются с телефона"


def test_shells_grow_with_content():
    for rel in ("src/pages/mobile/MobileLayout.tsx", "src/pages/mobile/crm/MobileCrmLayout.tsx",
                "src/pages/mobile/admin/MobileAdminLayout.tsx"):
        src = (ROOT / rel).read_text(encoding="utf-8")
        assert "<main" in src and "data-mobile-scroll" in src, f"2: {rel}: нет main data-mobile-scroll"
        assert "minHeight: '100vh'" in src, f"2: {rel}: оболочка больше не растёт по содержимому"
        assert not re.search(r"\bheight: '100(d)?vh'", src), \
            f"2: {rel}: оболочка зажата высотой экрана — пересмотреть прокрутку /m"


def test_sheet_body_keeps_contain():
    ui = (ROOT / "src/styles/ui.css").read_text(encoding="utf-8")
    rules = dict(_css_rules(ui))
    body = next((b for s, b in rules.items() if s.endswith(".ui-sheet__body")), "")
    assert "overflow-y: auto" in body and "overscroll-behavior: contain" in body, \
        "3: тело шторки потеряло свою прокрутку/contain — фон поедет под шторкой"


if __name__ == "__main__":
    for name, fn in sorted(dict(globals()).items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("  ✓", name)
    print("СТОРОЖ mobile_touch_scroll: OK")
