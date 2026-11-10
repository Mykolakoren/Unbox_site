"""СТОРОЖ: мусор из календаря не становится клиентом; пауза с главной CRM (владелец 10.11).

Повод: в «Без следующей встречи» — «Созвон по саду», «Новое событие»,
«Встреча с Олей», «Созвон с Робертом», «Парикмахерская»: карточки из событий
календаря (апрель–август, до фильтра 24.09 или мимо него).

Что держит:
  1  «Новое событие» / «без названия» / «New event» / «Парикмахерская» — не клиент.
  2  Прежний мусор («Созвон…», «Встреча с…») — не клиент.
  3  Настоящие имена — клиенты: пары, подростки, «Анна, 16 лет.», «Мать и дочь…».
  4  Главная CRM, «Без следующей встречи»: «Поставить на паузу» рядом с «Записать»
     (не в просмотре чужого календаря) — мягкая пауза deleteClient без permanent,
     с «Вернуть» в тосте; поставленный сразу пропадает из списка.

    python3 backend/tests/guard_crm_calendar_junk_pause_2026_11.py
"""
import os
import pathlib
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("ENVIRONMENT", "development")
ROOT = pathlib.Path(__file__).resolve().parents[2]


def _code(rel: str) -> str:
    src = (ROOT / rel).read_text(encoding="utf-8")
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return re.sub(r"(?<![:'\"`\w])//[^\n]*", "", src)


def test_junk_titles_are_not_clients():
    from app.api.v1.crm.sync import _looks_non_client as f
    for t in ("Новое событие", "(без названия)", "New event", "Untitled", "Парикмахерская",
              "Барбершоп", "Созвон по саду", "Созвон с Робертом", "Встреча с Олей"):
        assert f(t), f"1/2: «{t}» стал бы клиентом"


def test_real_names_stay_clients():
    from app.api.v1.crm.sync import _looks_non_client as f
    for t in ("Руслан Д", "Ника и Денис", "Максим Лугин", "Елена Bilgin", "Марат (подросток)",
              "Барно и Сергей", "Анна, 16 лет.", "Мать и дочь Ивановы", "Алена", "Паша", "Залина"):
        assert not f(t), f"3: настоящий клиент «{t}» отсеян как мусор"


def test_dashboard_pause_button():
    c = _code("src/pages/crm/CrmDashboard.tsx")
    assert "await crmApi.deleteClient(id);" in c and "deleteClient(id, true)" not in c, "4: пауза должна быть мягкой"
    assert "crmApi.updateClient(id, { isActive: true })" in c and "undoToast(`${name} на паузе`" in c, "4: нет «Вернуть»"
    assert ".filter(c => !pausedIds.has(c.id))" in c, "4: поставленный на паузу не пропадает из списка"
    i = c.find("Поставить на паузу")
    j = c.find("Записать", i)
    assert i != -1 and j != -1, "4: нет кнопки рядом с «Записать»"
    block = c[c.rfind("{!viewingOther && (", 0, i):i]
    assert "pauseClient(c.id, c.name)" in block, "4: кнопка не в ветке !viewingOther или не вызывает паузу"


if __name__ == "__main__":
    for name, fn in sorted(dict(globals()).items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("  ✓", name)
    print("СТОРОЖ crm_calendar_junk_pause: OK")
