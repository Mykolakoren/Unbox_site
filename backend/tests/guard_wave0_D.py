"""СТОРОЖ волны 0, пакет D — «опасное одним кликом».

Аудит 29.09: на десктопе три места стирали деньги или записи одним нажатием,
без вопроса и без отмены:
  G5-07 — плашка «Оплачено» в карточке клиента Psy-CRM была кнопкой и
          удаляла платёж (у клиента появлялся долг);
  G5-01 — заметки психолога удалялись корзиной навсегда, без вопроса;
  G8-04 — задачи админов удалялись крошечной корзиной рядом с DONE.
Теперь всё это идёт через общее окно подтверждения (useConfirmDialog).
Сторож читает исходники фронта — без сети и без базы:

    python3 backend/tests/guard_wave0_D.py
"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent


def _read(rel):
    return (ROOT / rel).read_text()


def _body(src, start, end_marker="\n    const handle"):
    """Тело обработчика: от его объявления до следующего handle*-обработчика."""
    i = src.find(start)
    assert i != -1, f"не нашли {start!r}"
    j = src.find(end_marker, i + len(start))
    return src[i:j if j != -1 else len(src)]


def _before(body, first, second):
    a, b = body.find(first), body.find(second)
    return a != -1 and b != -1 and a < b


# ─────────────────────────────────────────────────────────────────────────
# Окно подтверждения подключено в корне приложения — иначе хук упадёт.
# ─────────────────────────────────────────────────────────────────────────

def test_confirm_provider_mounted_in_app():
    app = _read("src/App.tsx")
    assert "<ConfirmDialogProvider>" in app, "ConfirmDialogProvider снят с App — useConfirmDialog упадёт"


# ─────────────────────────────────────────────────────────────────────────
# G5-07 — снятие оплаты в карточке клиента.
# ─────────────────────────────────────────────────────────────────────────

def test_unmark_paid_asks_before_deleting_payment():
    """unmarkPaidSession удаляет ВСЕ платежи сессии — только после «да»."""
    src = _read("src/pages/crm/CrmClientDetail.tsx")
    body = _body(src, "const handleUnmarkPaid = async")
    assert _before(body, "await askConfirm(", "crmApi.unmarkPaidSession("), \
        "снятие оплаты снова идёт без подтверждения"
    assert "if (!ok) return;" in body, "ответ «Оставить» не останавливает снятие оплаты"
    assert "destructive: true" in body, "окно снятия оплаты должно быть красным (destructive)"


def test_paid_label_is_status_not_button():
    """Плашка «Оплачено» — просто статус. Кнопка с title «Нажми чтобы
    отменить оплату» и есть тот самый баг одного клика."""
    src = _read("src/pages/crm/CrmClientDetail.tsx")
    assert "Нажми чтобы отменить оплату" not in src, "плашка «Оплачено» снова стала кнопкой снятия оплаты"
    i = src.find("session.isPaid ? (")
    assert i != -1, "не нашли ветку оплаченной сессии"
    chunk = src[i:src.find(") : (", i)]
    # Wave 1 (30.09): «Оплачено» — общий StatusBadge payment/paid, а кнопка
    # отмены называется «Снять отметку об оплате» (одни слова во всей CRM, G5-06).
    label = max(chunk.find("Оплачено"), chunk.find('kind="payment" status="paid"'))
    btn = chunk.find("<button")
    assert label != -1 and (btn == -1 or label < btn), \
        "текст «Оплачено» снова внутри кнопки"
    assert ('aria-label="Снять оплату"' in chunk or 'aria-label="Снять отметку об оплате"' in chunk), \
        "у снятия оплаты нет отдельной подписанной кнопки"


def test_delete_payment_uses_same_dialog():
    src = _read("src/pages/crm/CrmClientDetail.tsx")
    body = _body(src, "const handleDeletePayment = async")
    assert "window.confirm(" not in body, "удаление оплаты вернулось на браузерный confirm"
    assert _before(body, "await askConfirm(", "crmApi.deletePayment("), \
        "удаление оплаты идёт без подтверждения"


# ─────────────────────────────────────────────────────────────────────────
# G5-01 — заметки психолога.
# ─────────────────────────────────────────────────────────────────────────

def test_client_card_note_delete_asks_first():
    src = _read("src/pages/crm/CrmClientDetail.tsx")
    body = _body(src, "const handleDeleteNote = async")
    assert _before(body, "await askConfirm(", "await deleteNote("), \
        "заметка в карточке клиента снова удаляется без вопроса"
    assert "if (!ok) return;" in body


def test_notes_page_delete_asks_first():
    src = _read("src/pages/crm/CrmNotes.tsx")
    i = src.find("onDelete={async (id) => {")
    assert i != -1, "не нашли обработчик удаления на /crm/notes"
    body = src[i:src.find("}}", src.find("await deleteNote(", i))]
    assert _before(body, "await askConfirm(", "await deleteNote("), \
        "заметка на /crm/notes снова удаляется одним кликом"
    assert "if (!ok) return;" in body


def test_client_card_note_trash_hit_area():
    """Корзина заметки в карточке клиента была 12 px с отступом 2 px."""
    src = _read("src/pages/crm/CrmClientDetail.tsx")
    i = src.find("onClick={() => handleDeleteNote(note.id)}")
    assert i != -1
    chunk = src[i:src.find("</button>", i)]
    assert "width: 32, height: 32" in chunk, "зона нажатия корзины заметки снова меньше 32 px"


# ─────────────────────────────────────────────────────────────────────────
# G8-04 — задачи админов.
# ─────────────────────────────────────────────────────────────────────────

def test_task_delete_asks_and_reports_real_result():
    src = _read("src/pages/admin/TasksBoard.tsx")
    assert "p.deleteTask(task.id); toast.success('Удалено')" not in src, \
        "карточка задачи снова удаляет одним кликом и хвалится «Удалено» до ответа сервера"
    body = _body(src, "const confirmDeleteTask = async", "\n    };")
    assert _before(body, "await askConfirm(", "await deleteTask("), \
        "задача удаляется без подтверждения"
    assert "if (deleted) toast.success(" in body, "«Задача удалена» показывается даже при ошибке сервера"
    # И корзина на карточке, и кнопка в окне задачи идут через подтверждение.
    assert src.count("p.confirmDeleteTask(") >= 2, "одно из мест удаления задачи обходит подтверждение"


def test_task_store_delete_returns_result():
    store = _read("src/store/adminTaskStore.ts")
    assert "deleteTask: (id: string) => Promise<boolean>;" in store, \
        "deleteTask снова глотает ошибку — экран не узнает, что удаление не прошло"
    i = store.find("deleteTask: async (id) => {")
    body = store[i:store.find("\n    },", i)]
    assert "return true;" in body and "return false;" in body


def test_task_card_trash_hit_area():
    src = _read("src/pages/admin/TasksBoard.tsx")
    i = src.find('aria-label="Удалить задачу"')
    assert i != -1, "у корзины задачи нет подписи"
    chunk = src[i:src.find("</button>", i)]
    assert "width: 32, height: 32" in chunk, "зона нажатия корзины задачи снова ~18 px"


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
    print("СТОРОЖ D: OK" if not failures else f"СТОРОЖ D УПАЛ ({failures}) — деплой НЕ выкатывать")
    sys.exit(1 if failures else 0)
