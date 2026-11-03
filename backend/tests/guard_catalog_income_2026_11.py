"""СТОРОЖ: оплата каталога и прочие приходы не про баланс (03.11).

Кейс Алёны Дёминой: 80 ₾ за участие в каталоге легли на баланс — их можно было
потратить на брони. Выбор клиента в кассе зачислял деньги при любой статье.
Статьи cat-catalog и cat-other только для кассы: клиент остаётся в записи, баланс
не меняется, удаление такой записи баланс не трогает. Остальное — как решил
владелец 22.07: клиент выбран = деньги на баланс.

    python3 backend/tests/guard_catalog_income_2026_11.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("ENVIRONMENT", "development")

import guard_duplicate_today_2026_10 as D  # noqa: E402

_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")


def _setup():
    from app.models.expense_category import ExpenseCategory
    s, admin, client = D._setup()
    for cid in ("cat-catalog", "cat-other", "cat-topup", "cat-booking-income"):
        s.add(ExpenseCategory(id=cid, name=cid, category_type="income"))
    s.commit()
    return s, admin, client


def _balance(s, client):
    from app.models.user import User
    s.expire_all()
    return float(s.get(User, client.id).balance)


def test_catalog_and_other_stay_off_balance():
    for category in ("cat-catalog", "cat-other"):
        s, admin, client = _setup()
        status, tx = D._pay(s, admin, client, amount=80.0, method="cash", category_id=category)
        assert status == "ok", tx
        assert _balance(s, client) == 0.0, f"{category}: деньги снова легли на баланс"
        assert tx.credited_user_id is None and tx.client_id == str(client.id)
        assert tx.client_name == client.name, "в записи кассы потерялось имя клиента"
        assert float(tx.amount) == 80.0


def test_delete_does_not_touch_balance():
    from app.api.v1.cashbox.transactions import delete_transaction
    s, admin, client = _setup()
    admin.role = "owner"
    _, tx = D._pay(s, admin, client, amount=80.0, method="cash", category_id="cat-catalog")
    delete_transaction(transaction_id=str(tx.id), session=s, current_user=admin)
    assert _balance(s, client) == 0.0, "удаление записи каталога списало деньги с баланса"


def test_other_income_still_goes_to_balance():
    for category in ("cat-topup", "cat-booking-income", None):
        s, admin, client = _setup()
        status, tx = D._pay(s, admin, client, amount=50.0, method="cash", category_id=category)
        assert status == "ok", tx
        assert _balance(s, client) == 50.0, f"{category}: оплата клиента не зачислилась на баланс"
        assert tx.credited_user_id == str(client.id)


def test_category_exists_with_known_id():
    with open(os.path.join(_ROOT, "backend/app/db/init_data.py"), encoding="utf-8") as f:
        src = f.read()
    assert 'id="cat-catalog"' in src, "статья создаётся не с тем id: сервер её не узнает, деньги уйдут на баланс"


def test_category_edit_cannot_cross_balance_border():
    from fastapi import HTTPException
    from app.api.v1.cashbox.transactions import update_transaction
    s, admin, client = _setup()
    admin.role = "owner"
    _, credited = D._pay(s, admin, client, amount=50.0, method="cash", category_id="cat-topup")
    _, cash_only = D._pay(s, admin, client, amount=80.0, method="cash", category_id="cat-catalog")
    for tx, new in ((credited, "cat-catalog"), (cash_only, "cat-topup")):
        try:
            update_transaction(transaction_id=str(tx.id), payload={"category_id": new}, session=s, current_user=admin)
            raise AssertionError(f"статья сменилась на {new}, а деньги остались как были")
        except HTTPException as e:
            assert e.status_code == 400
    assert _balance(s, client) == 50.0
    update_transaction(transaction_id=str(cash_only.id), payload={"category_id": "cat-other"}, session=s, current_user=admin)
    update_transaction(transaction_id=str(credited.id), payload={"category_id": "cat-booking-income"}, session=s, current_user=admin)
    assert _balance(s, client) == 50.0, "смена статьи внутри одного вида сдвинула баланс"


def test_form_matches_server():
    with open(os.path.join(_ROOT, "src/components/admin/cashbox/AddCashboxTransactionModal.tsx"), encoding="utf-8") as f:
        form = f.read()
    assert "['cat-catalog', 'cat-other']" in form, "список статей в форме разошёлся с сервером"
    assert "credit_user_balance: toBalance," in form
    assert form.index("useState('');\n    const toBalance") > form.index("const [clientId, setClientId]"), \
        "toBalance читает клиента раньше объявления"


if __name__ == "__main__":
    fails = 0
    for n, f in sorted(globals().items()):
        if n.startswith("test_") and callable(f):
            try:
                f(); print(f"  ✓ {n}")
            except Exception as e:  # noqa: BLE001
                fails += 1
                print(f"  ✗ {n}: {type(e).__name__}: {str(e)[:400]}")
    sys.exit(1 if fails else 0)
