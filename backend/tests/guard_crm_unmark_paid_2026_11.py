"""СТОРОЖ: в Psy-CRM видно, как снять ошибочную отметку «оплачено» (владелец 10.11).

Повод: «поставил «оплачена» — не вижу, как отменить». Снять можно было только
крестиком 12 px в карточке клиента, галочкой в правке или «Вернуть» в тосте 5 с.

Что держит:
  1  Одна функция unmarkPaidWithConfirm: сначала вопрос (красная кнопка), потом
     crmApi.unmarkPaidSession — без подтверждения платёж не удаляется.
  2  «Сессии» на компьютере: в меню «⋯» оплаченной сессии — «Снять отметку об
     оплате» (не в просмотре чужого календаря).
  3  Главная CRM: у оплаченной сегодняшней сессии — «Снять оплату».
  4  Карточка клиента: подписанная кнопка «снять» (обработчик с вопросом — прежний, заморожен).
  5  Правка сессии: сняли галочку «Оплачено» — предупреждение, что платёж удалится.
  6  Телефон: на плитке «Оплачено» подсказка «нажмите, чтобы снять».

    python3 backend/tests/guard_crm_unmark_paid_2026_11.py
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[2]


def _code(rel: str) -> str:
    src = (ROOT / rel).read_text(encoding="utf-8")
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return re.sub(r"(?<![:'\"`\w])//[^\n]*", "", src)


def test_helper_confirms_first():
    c = _code("src/pages/crm/unmarkPaid.ts")
    i_confirm, i_api = c.find("await confirmAction("), c.find("crmApi.unmarkPaidSession(")
    assert 0 <= i_confirm < i_api, "1: снятие оплаты без вопроса"
    assert "if (!ok) return false;" in c and "tone: 'danger'" in c, "1: вопрос не блокирует или не красный"


def test_sessions_row_menu():
    c = _code("src/pages/crm/CrmSessions.tsx")
    assert "const canUnmark = !!session.isPaid && !viewingOther;" in c, "2: условие пункта меню"
    assert re.search(r"\{canUnmark && \(\s*<MenuItem onSelect=\{\(\) => \{ close\(\); void handleUnmark\(\); \}\}>", c), "2: нет пункта меню"
    assert "Снять отметку об оплате" in c and "unmarkPaidWithConfirm(session, client)" in c
    assert "При сохранении платёж удалится" in c, "5: нет предупреждения в правке"


def test_dashboard_and_client_card():
    d = _code("src/pages/crm/CrmDashboard.tsx")
    assert "s.isPaid && !cancelled && !viewingOther" in d and "unmarkPaidWithConfirm(s, client)" in d, "3: главная"
    assert "Снять оплату" in d
    cd = _code("src/pages/crm/CrmClientDetail.tsx")
    # Обработчик карточки заморожен (guard_wave3_crm_clients) — свой вопрос, те же слова.
    assert "handleUnmarkPaid(session.id)" in cd, "4: кнопка не ведёт к снятию с вопросом"
    assert '<X size={12} aria-hidden="true" /> снять' in cd, "4: кнопка без подписи"


def test_mobile_hint():
    m = _code("src/pages/mobile/crm/SessionActionSheet.tsx")
    assert "нажмите, чтобы снять" in m, "6: нет подсказки на телефоне"
    i_confirm = m.find("title: 'Снять оплату?'")
    i_api = m.find("crmApi.unmarkPaidSession(session.id)")
    assert 0 <= i_confirm < i_api, "6: на телефоне снятие без вопроса"


if __name__ == "__main__":
    for name, fn in sorted(dict(globals()).items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("  ✓", name)
    print("СТОРОЖ crm_unmark_paid: OK")
