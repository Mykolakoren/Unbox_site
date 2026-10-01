"""CRM Payments — payment CRUD for specialist's clients."""
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select
from app.api import deps
from app.models.user import User
from app.models.therapist_client import TherapistClient
from app.models.therapy_session import TherapySession
from app.services.finance_bridge import push_payment, retract_payment, resync_payment
from app.services import session_balance as sb
from app.models.therapist_payment import (
    TherapistPayment, TherapistPaymentCreate, TherapistPaymentRead, TherapistPaymentUpdate,
)

router = APIRouter()

def _apply_paid_flag(session: Session, ts: TherapySession, client, rates) -> None:
    """Пересчитать «оплачено» у сессии по её платежам — ОДНО правило для
    создания, правки и (через session_balance) долга: оплачено, если внесённое
    в валюте сессии ≥ цены − 0,01, либо цена ≤ 0."""
    payments = session.exec(
        select(TherapistPayment).where(
            TherapistPayment.session_id == ts.id,
            TherapistPayment.specialist_id == ts.specialist_id,
        )
    ).all()
    price = sb.session_price(ts, client)
    cur = sb.session_currency(ts, client)
    fully_paid = sb.covers(price, sb.paid_in(payments, cur, rates), sb.slack(payments, cur, rates))
    if ts.is_paid != fully_paid:
        ts.is_paid = fully_paid
    ts.updated_at = datetime.now()
    session.add(ts)


@router.get("/payments", response_model=List[TherapistPaymentRead])
def list_payments(
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_specialist),
    client_id: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
):
    uid = str(current_user.id)
    stmt = select(TherapistPayment).where(TherapistPayment.specialist_id == uid)
    if client_id:
        stmt = stmt.where(TherapistPayment.client_id == client_id)
    if date_from:
        stmt = stmt.where(TherapistPayment.date >= datetime.fromisoformat(date_from))
    if date_to:
        stmt = stmt.where(TherapistPayment.date <= datetime.fromisoformat(date_to + "T23:59:59"))
    stmt = stmt.order_by(TherapistPayment.date.desc())
    return session.exec(stmt).all()


@router.post("/payments", response_model=TherapistPaymentRead)
def create_payment(
    data: TherapistPaymentCreate,
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_specialist),
):
    client = session.get(TherapistClient, data.client_id)
    if not client or client.specialist_id != str(current_user.id):
        raise HTTPException(404, "Клиент не найден — возможно, его удалили или склеили с другим")

    ts = None
    if data.session_id:
        # FOR UPDATE — тот же паттерн, что в quick-pay: одновременные
        # «Оплатить» и произвольный платёж по той же сессии не должны
        # обгонять друг друга (иначе один из них падал 500 на
        # uq_therapist_payment_session).
        ts = session.exec(
            select(TherapySession)
            .where(TherapySession.id == data.session_id)
            .with_for_update()
        ).first()
        if ts and ts.specialist_id != str(current_user.id):
            ts = None

    # На сессию разрешён РОВНО ОДИН платёж — это защита в самой базе
    # (uq_therapist_payment_session), поставленная после чистки 74 дублей.
    # Поэтому доплата не создаёт вторую строку, а прибавляется к существующей.
    existing = None
    if ts is not None:
        existing = session.exec(
            select(TherapistPayment).where(
                TherapistPayment.session_id == ts.id,
                TherapistPayment.specialist_id == str(current_user.id),
            )
        ).first()

    from app.api.v1.settings import get_exchange_rates
    rates = get_exchange_rates(session)

    if existing is not None:
        # Доплата в другой валюте: прибавляем в валюте УЖЕ записанного платежа
        # (одна строка = одна валюта), а не складываем доллары с лари как числа.
        added = sb.convert(data.amount, data.currency, existing.currency, rates)
        existing.amount = round(float(existing.amount or 0) + added, 2)
        if data.account:
            existing.account = data.account
        payment = existing
    else:
        payment = TherapistPayment(
            **data.model_dump(),
            specialist_id=str(current_user.id),
        )
    session.add(payment)

    if ts is not None:
        # Сессию закрываем ТОЛЬКО когда собрана вся её стоимость. Раньше любая
        # сумма ставила галочку «оплачено»: клиент вносит 50 из 100 — сессия
        # считается закрытой, а оставшиеся 50 молча исчезают из долга.
        # Как в quick-pay: к моменту оплаты цена и валюта сессии «замораживаются»,
        # иначе правка ставки/валюты клиента потом сдвинула бы уже внесённое.
        if ts.price is None and client.base_price:
            ts.price = client.base_price
        ts.currency = ts.currency or client.currency
        # Внесённое — в ВАЛЮТЕ СЕССИИ: платёж в долларах за сессию в лари раньше
        # сравнивался с ценой как голое число.
        _apply_paid_flag(session, ts, client, rates)

    session.commit()
    session.refresh(payment)
    # После commit: платёж уже записан, и даже если мост упадёт, оплата в
    # CRM останется. Доплата уходит той же записью с новой суммой.
    push_payment(payment, client.name)
    return payment


@router.patch("/payments/{payment_id}", response_model=TherapistPaymentRead)
def update_payment(
    payment_id: str,
    data: TherapistPaymentUpdate,
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_specialist),
):
    """Поправить платёж: сумму, валюту, счёт, дату.

    Раньше платёж можно было только удалить и внести заново — ошибся в сумме
    или счёте, и приходилось снимать оплату, теряя дату. Клиента и сессию не
    меняем. После правки у сессии пересчитывается «оплачено» тем же правилом,
    что при создании платежа: внесённое (в валюте сессии) ≥ цены − 0,01.
    Недобрали — сессия снова неоплачена, и долг равен остатку.
    """
    uid = str(current_user.id)
    payment = session.get(TherapistPayment, payment_id)
    # Чужой платёж и несуществующий неразличимы — не подсказываем, что id живой.
    if not payment or payment.specialist_id != uid:
        raise HTTPException(404, "Платёж не найден")

    # Сначала замок на сессию (как в create_payment и quick-pay), потом правка:
    # одновременные «Доплатить» и «Изменить» не должны обгонять друг друга.
    ts = None
    if payment.session_id:
        ts = session.exec(
            select(TherapySession)
            .where(TherapySession.id == payment.session_id)
            .with_for_update()
        ).first()
        if ts and ts.specialist_id != uid:
            ts = None
        session.refresh(payment)

    client = session.get(TherapistClient, payment.client_id)
    from app.api.v1.settings import get_exchange_rates
    rates = get_exchange_rates(session)

    fields = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    old_account = payment.account

    if "amount" in fields:
        amount = round(float(fields["amount"]), 2)
        # nan/inf в JSON не придут, но бесконечность из «1e999» — придёт.
        if not (0 < amount < 1e9):
            raise HTTPException(400, "Сумма платежа должна быть больше нуля")
        payment.amount = amount
    if "currency" in fields:
        try:
            payment.currency = sb.clean_currency(
                fields["currency"], rates, payment.currency, getattr(client, "currency", None),
            )
        except ValueError as exc:
            raise HTTPException(400, str(exc))
    if "account" in fields:
        account = str(fields["account"]).strip()
        if not account or len(account) > 64:
            raise HTTPException(400, "Укажите счёт, на который пришла оплата")
        payment.account = account
    if "date" in fields:
        d = fields["date"]
        # В базе даты платежей — naive (локальное время сервера, как у
        # datetime.now() в quick-pay); aware-время с «Z» приводим к тому же виду.
        payment.date = d.replace(tzinfo=None) if d.tzinfo else d
    session.add(payment)

    # «Оплачено» зависит только от суммы и валюты: правка счёта или даты не
    # должна переоткрывать старую сессию (легаси: отметили руками, платёж меньше цены).
    if ts is not None and ("amount" in fields or "currency" in fields):
        _apply_paid_flag(session, ts, client, rates)

    session.commit()
    session.refresh(payment)
    # После commit — как в create_payment: сбой моста не откатывает правку.
    resync_payment(payment, client.name if client else None, old_account)
    return payment


@router.delete("/payments/{payment_id}")
def delete_payment(
    payment_id: str,
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_specialist),
):
    """Удалить платёж.

    Раньше такой возможности не было вообще: ошибся в сумме — запись
    оставалась навсегда и завышала доход. Если платёж был привязан к сессии,
    снимаем с неё «оплачено» — но только когда других платежей по ней не
    осталось (частичные оплаты не должны открывать сессию заново).
    """
    payment = session.get(TherapistPayment, payment_id)
    if not payment or payment.specialist_id != str(current_user.id):
        raise HTTPException(404, "Платёж не найден")

    session_id = payment.session_id
    session.delete(payment)
    session.flush()

    if session_id:
        ts = session.get(TherapySession, session_id)
        if ts and ts.specialist_id == str(current_user.id):
            remaining = session.exec(
                select(TherapistPayment).where(
                    TherapistPayment.session_id == session_id,
                    TherapistPayment.specialist_id == str(current_user.id),
                )
            ).first()
            if remaining is None and ts.is_paid:
                ts.is_paid = False
                ts.updated_at = datetime.now()
                session.add(ts)

    session.commit()
    retract_payment(payment_id, str(current_user.id))
    return {"ok": True}
