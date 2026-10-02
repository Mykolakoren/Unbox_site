"""Cashbox — transactions: balance, list, create, delete."""
from typing import List, Optional, Union
from datetime import datetime, date, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select, func, col, desc
from app.db.session import get_session
from app.models.user import User
from app.models.expense_category import ExpenseCategory
from app.models.cashbox_transaction import (
    CashboxTransaction, CashboxTransactionCreate, CashboxTransactionRead,
)
from app.api.v1.cashbox import require_cashbox

router = APIRouter()


# ── TZ normalisation for cashbox transaction dates ────────────────────
# The DB column stores naive UTC. Frontend sends Tbilisi wall-clock as a
# naive ISO string ("YYYY-MM-DDTHH:MM"). Without conversion we get a
# split-personality column where some rows are UTC (defaulted to now())
# and others are Tbilisi (admin-typed) — they render with a 4h shift
# relative to each other. This helper is the single normalisation point:
# whatever input shape we get, the result is always naive UTC.
_TZ_TBILISI = timezone(timedelta(hours=4))


def _normalise_tx_date(value: Union[str, datetime, None]) -> datetime:
    """Convert any incoming date representation to naive UTC datetime.

    - None       → utcnow() (naive UTC).
    - aware dt   → astimezone(UTC).replace(tzinfo=None).
    - naive dt   → treat as Tbilisi wall-clock, subtract 4h → UTC-naive.
    - string     → datetime.fromisoformat then recurse.
    """
    if value is None:
        return datetime.now(timezone.utc).replace(tzinfo=None)
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value)
        except Exception:
            return datetime.now(timezone.utc).replace(tzinfo=None)
    if isinstance(value, datetime):
        if value.tzinfo is not None:
            return value.astimezone(timezone.utc).replace(tzinfo=None)
        # Naive: treat as Tbilisi wall-clock per frontend convention.
        return value.replace(tzinfo=_TZ_TBILISI).astimezone(timezone.utc).replace(tzinfo=None)
    return datetime.now(timezone.utc).replace(tzinfo=None)


@router.get("/balance")
def get_balance(
    session: Session = Depends(get_session),
    current_user: User = Depends(require_cashbox),
    branch: Optional[str] = Query(None),
):
    """Балансы кассы по каждому счёту (опционально по филиалу)."""
    methods = ["cash", "card_tbc", "card_bog"]
    balances = {}
    total = 0.0
    for method in methods:
        inc_q = (
            select(func.coalesce(func.sum(CashboxTransaction.amount), 0))
            .where(CashboxTransaction.type == "income")
            .where(CashboxTransaction.payment_method == method)
        )
        exp_q = (
            select(func.coalesce(func.sum(CashboxTransaction.amount), 0))
            .where(CashboxTransaction.type == "expense")
            .where(CashboxTransaction.payment_method == method)
        )
        if branch:
            inc_q = inc_q.where(CashboxTransaction.branch == branch)
            exp_q = exp_q.where(CashboxTransaction.branch == branch)
        inc = session.exec(inc_q).one()
        exp = session.exec(exp_q).one()
        bal = round(float(inc) - float(exp), 2)
        balances[method] = bal
        total += bal
    return {
        "balance": round(total, 2),
        "cash": balances["cash"],
        "card_tbc": balances["card_tbc"],
        "card_bog": balances["card_bog"],
    }


@router.get("/client-total-paid/{user_id}")
def client_total_paid(
    user_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_cashbox),
):
    """«Общая сумма оплат» клиента — из РЕАЛЬНЫХ кассовых приходов, привязанных
    к нему (credited_user_id). Раньше это число считалось из фронтового стора,
    который пустой на перезагрузке — отсюда «не работает через Финансы».
    Теперь единый бэкенд-источник: и «Пополнить», и «Новая операция» пишут
    привязанный приход → оба видны здесь.
    """
    # user_id может прийти как UUID или email — приводим к user.id.
    from uuid import UUID as _UUID
    target = None
    try:
        target = session.get(User, _UUID(str(user_id)))
    except (ValueError, TypeError):
        target = None
    if target is None:
        target = session.exec(select(User).where(User.email == user_id)).first()
    if target is None:
        return {"total_paid": 0.0}

    # Сверка 19.08.2026: число считалось ТОЛЬКО по credited_user_id (приходы с
    # пометкой «пополнить баланс»), а список операций под ним в карточке клиента
    # показывает ещё и приходы, привязанные через client_id. Из-за этого у Ольги
    # Корень строка «+50 ₾» была видна, а «Общая сумма оплат» показывала 0.00 —
    # админ не мог понять, чему верить. Считаем по тому же набору, что и список.
    total = session.exec(
        select(func.coalesce(func.sum(CashboxTransaction.amount), 0))
        .where(CashboxTransaction.type == "income")
        .where(
            (CashboxTransaction.credited_user_id == str(target.id))
            | (CashboxTransaction.client_id == str(target.id))
        )
    ).one()
    return {"total_paid": round(float(total), 2)}


@router.get("/transactions", response_model=List[CashboxTransactionRead])
def list_transactions(
    session: Session = Depends(get_session),
    current_user: User = Depends(require_cashbox),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    type: Optional[str] = Query(None),
    category_id: Optional[str] = Query(None),
    payment_method: Optional[str] = Query(None),
    branch: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=1000),
):
    stmt = select(CashboxTransaction).order_by(desc(CashboxTransaction.date))

    if date_from:
        try:
            dt_from = datetime.fromisoformat(date_from)
            stmt = stmt.where(CashboxTransaction.date >= dt_from)
        except ValueError:
            pass
    if date_to:
        try:
            dt_to = datetime.fromisoformat(date_to)
            stmt = stmt.where(CashboxTransaction.date <= dt_to)
        except ValueError:
            pass
    if type and type in ("income", "expense"):
        stmt = stmt.where(CashboxTransaction.type == type)
    if category_id:
        stmt = stmt.where(CashboxTransaction.category_id == category_id)
    if payment_method:
        stmt = stmt.where(CashboxTransaction.payment_method == payment_method)
    # Филиал фильтруем на сервере: телефон раньше брал последние N операций
    # всей сети и уже потом отбирал свой филиал — от него оставались крохи.
    if branch:
        stmt = stmt.where(CashboxTransaction.branch == branch)

    stmt = stmt.offset(skip).limit(limit)
    transactions = session.exec(stmt).all()

    # Enrich with category_name
    category_ids = {t.category_id for t in transactions if t.category_id}
    cat_names = {}
    if category_ids:
        cats = session.exec(
            select(ExpenseCategory).where(col(ExpenseCategory.id).in_(category_ids))
        ).all()
        cat_names = {c.id: c.name for c in cats}

    result = []
    for t in transactions:
        data = CashboxTransactionRead.model_validate(t)
        data.category_name = cat_names.get(t.category_id) if t.category_id else None
        result.append(data)
    return result


# Корректировки — не деньги. Так помечены недельная скидка (weekly_rebate) и
# ручная правка баланса клиента (users/admin.py): это запись «для истории»,
# из кассы при этом ничего не приходит и не уходит. /balance их не считает —
# итоги за период тоже не должны.
NON_MONEY_METHOD = "adjustment"


def _parse_range_bound(value: Optional[str]) -> Optional[datetime]:
    """Граница периода → наивное UTC (так даты лежат в базе).

    Телефон шлёт toISOString() с 'Z'. До Python 3.11 fromisoformat 'Z' не
    понимает — меняем на +00:00 сами. Кривую дату не глотаем молча: итог
    «за всё время» вместо «за неделю» хуже честной ошибки.
    """
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(400, f"Неверная дата: {value}")
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


@router.get("/summary")
def get_period_summary(
    session: Session = Depends(get_session),
    current_user: User = Depends(require_cashbox),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    branch: Optional[str] = Query(None),
):
    """Итоги кассы за период: сколько реально пришло и ушло денег.

    Мобильные «Финансы» считали «Доход / Расход» на телефоне по последним
    100 операциям — остальное за неделю/месяц молча выпадало, а недельные
    скидки и правки балансов шли как настоящие деньги. Здесь сумма по ВСЕМ
    операциям периода, корректировки — отдельной строкой, не в итогах.
    """
    dt_from = _parse_range_bound(date_from)
    dt_to = _parse_range_bound(date_to)

    stmt = select(
        CashboxTransaction.type,
        CashboxTransaction.payment_method,
        func.coalesce(func.sum(CashboxTransaction.amount), 0),
        func.count(),
    ).group_by(CashboxTransaction.type, CashboxTransaction.payment_method)
    if dt_from:
        stmt = stmt.where(CashboxTransaction.date >= dt_from)
    if dt_to:
        stmt = stmt.where(CashboxTransaction.date <= dt_to)
    if branch:
        stmt = stmt.where(CashboxTransaction.branch == branch)

    income = expense = adj_income = adj_expense = 0.0
    count = adj_count = 0
    for tx_type, method, total, n in session.exec(stmt).all():
        total = float(total or 0)
        if method == NON_MONEY_METHOD:
            adj_count += int(n)
            if tx_type == "income":
                adj_income += total
            else:
                adj_expense += total
            continue
        count += int(n)
        if tx_type == "income":
            income += total
        else:
            expense += total

    return {
        "income": round(income, 2),
        "expense": round(expense, 2),
        "net": round(income - expense, 2),
        "count": count,
        "adjustment_income": round(adj_income, 2),
        "adjustment_expense": round(adj_expense, 2),
        "adjustment_count": adj_count,
    }


# ── Защита от двойного внесения оплаты клиента ────────────────────────
# Случай 01.10: админ нажала «Принять оплату» (45 ₾), экран показал красную
# ошибку, хотя сервер ответил 200 и платёж записался. Она внесла заново другим
# способом через 23 секунды — на балансе клиента два платежа по 45 ₾.
# Теперь второй такой же приход по тому же клиенту в течение 3 минут сервер
# не пишет молча, а отвечает 409 duplicate_recent; фронт спрашивает «Записать
# ещё одну?» и при «да» повторяет запрос с confirm_duplicate=true.
#
# Расширение 02.10: то же самое, но за ВЕСЬ ТЕКУЩИЙ ДЕНЬ по Тбилиси (мягкое
# предупреждение). Случай: админ внесла Тамрико 20 ₾ в 12:45 в Uni и ещё раз
# 20 ₾ в 19:04 в One — окно в 3 минуты такое не ловит, у клиента появился
# ложный депозит. Код ответа тот же (duplicate_recent) — фронту менять нечего,
# отличается только текст и поле existing.window ("recent" / "today").
DUPLICATE_WINDOW = timedelta(minutes=3)
# Способ оплаты НЕ сравниваем: наличные и карта на ту же сумму — тот же дубль
# (в реальном случае первая запись была картой, вторая — наличными).
# Администратора тоже не сравниваем: с телефона и с компьютера могут нажать
# двое; лишний вопрос стоит одного нажатия, а двойной платёж — денег клиента.
_METHOD_RU = {"cash": "наличные", "card_tbc": "карта TBC", "card_bog": "карта BOG"}
# Для фразы «внесено 20 ₾ наличными» (творительный падеж).
_METHOD_RU_BY = {"cash": "наличными", "card_tbc": "картой TBC", "card_bog": "картой BOG"}


def _plural_ru(n: int, one: str, few: str, many: str) -> str:
    n10, n100 = n % 10, n % 100
    if n10 == 1 and n100 != 11:
        return one
    if 2 <= n10 <= 4 and not 12 <= n100 <= 14:
        return few
    return many


def _ago_ru(seconds: int) -> str:
    if seconds < 60:
        return f"{seconds} {_plural_ru(seconds, 'секунду', 'секунды', 'секунд')} назад"
    m = seconds // 60
    return f"{m} {_plural_ru(m, 'минуту', 'минуты', 'минут')} назад"


def _lock_client_for_payment(session: Session, key: str) -> None:
    """Очередь по клиенту на время транзакции (pg advisory lock).

    Два одновременных запроса «внести 45 ₾ клиенту X» без неё оба видят «дублей
    нет» и оба пишут. Замок берём ДО проверки и держим до commit/rollback
    (xact-lock снимается сам), второй запрос ждёт, потом читает уже записанную
    первым операцию и получает 409. Строку клиента для FOR UPDATE не берём:
    client_id бывает и id пользователя, и email, и id клиента Psy-CRM.
    В SQLite (тесты, dev) нет параллельных писателей — замок не нужен.
    """
    if session.get_bind().dialect.name != "postgresql":
        return
    from sqlalchemy import text
    from sqlalchemy.exc import OperationalError
    # Ждём очередь не дольше 5 с: иначе запрос, застрявший за «зависшим» держателем
    # замка, висел бы бесконечно и занимал соединение пула. SET LOCAL живёт до конца
    # транзакции, поэтому сразу после замка возвращаем умолчание — остальные запросы
    # этой транзакции (запись баланса, commit) ведут себя как раньше.
    session.execute(text("SET LOCAL lock_timeout = '5s'"))
    try:
        session.execute(
            text("SELECT pg_advisory_xact_lock(7101, hashtext(:k))"),
            {"k": key},
        )
    except OperationalError as e:
        # 55P03 = lock_not_available (вышло время ожидания замка).
        if getattr(getattr(e, "orig", None), "pgcode", None) != "55P03":
            raise
        session.rollback()
        raise HTTPException(
            409,
            "По этому клиенту сейчас уже записывается операция, повторите через минуту. "
            "Прежде чем вносить заново, проверьте журнал кассы.",
        )
    session.execute(text("SET LOCAL lock_timeout TO DEFAULT"))


def _server_now() -> datetime:
    """Серверное «сейчас» в той же шкале, что и created_at (naive, на проде UTC).
    Вынесено в функцию, чтобы сторож мог подставить своё время."""
    return datetime.now()


def _tbilisi_day_start_utc(now: datetime) -> datetime:
    """Начало текущего календарного дня по Тбилиси (UTC+4) в naive UTC.

    now — naive UTC. Полночь Тбилиси = 20:00 UTC предыдущих суток: в 19:00 UTC
    день ещё прежний, а в 20:30 UTC (00:30 по Тбилиси) уже новый.
    """
    local = now + timedelta(hours=4)
    return local.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(hours=4)


def _duplicate_candidates(
    payload: CashboxTransactionCreate, target_user: Optional[User], since: datetime,
):
    """Запрос: приходы по этому клиенту на ту же сумму и валюту с момента since."""
    # created_at пишется моделью через datetime.now() (серверное время, на проде
    # UTC) — сравниваем в той же шкале, а не с payload.date: дату админ может
    # проставить задним числом.
    who = CashboxTransaction.client_id == payload.client_id
    if target_user is not None:
        # Тот же человек мог прийти под email, а не под UUID (и зачисление на
        # баланс могло быть, а могло и нет) — сверяем все его обозначения.
        who = (
            who
            | (CashboxTransaction.client_id == str(target_user.id))
            | (CashboxTransaction.client_id == target_user.email)
            | (CashboxTransaction.credited_user_id == str(target_user.id))
        )
    return (
        select(CashboxTransaction)
        .where(CashboxTransaction.type == "income")
        .where(who)
        .where(CashboxTransaction.currency == payload.currency)
        # Корректировки — не оплаты, их повтор не дубль.
        .where(CashboxTransaction.payment_method != NON_MONEY_METHOD)
        .where(CashboxTransaction.created_at >= since)
        .where(func.abs(CashboxTransaction.amount - float(payload.amount)) < 0.005)
        .order_by(desc(CashboxTransaction.created_at))
    )


def _find_recent_duplicate(
    session: Session, payload: CashboxTransactionCreate, target_user: Optional[User],
) -> Optional[CashboxTransaction]:
    """Самый свежий приход по этому клиенту на ту же сумму за последние 3 минуты."""
    since = _server_now() - DUPLICATE_WINDOW
    return session.exec(_duplicate_candidates(payload, target_user, since)).first()


def _find_today_duplicate(
    session: Session, payload: CashboxTransactionCreate, target_user: Optional[User],
) -> Optional[CashboxTransaction]:
    """Самый свежий такой же приход с начала текущего дня по Тбилиси (любой
    способ оплаты, филиал и админ). Удалённая запись из таблицы уже исчезла —
    дублем не считается."""
    since = _tbilisi_day_start_utc(_server_now())
    return session.exec(_duplicate_candidates(payload, target_user, since)).first()


def _duplicate_payment_error(
    prev: CashboxTransaction, current_admin_id: str, window: str = "recent",
) -> HTTPException:
    now = _server_now()
    secs = max(0, int((now - prev.created_at).total_seconds()))
    cur = "₾" if prev.currency == "GEL" else prev.currency
    amount_txt = f"{prev.amount:g}".replace(".", ",")
    method = _METHOD_RU.get(prev.payment_method, prev.payment_method)
    # Время по Тбилиси: created_at хранится в UTC.
    time_local = (prev.created_at + timedelta(hours=4)).strftime("%H:%M")
    if window == "today":
        where = f" ({prev.branch})" if prev.branch else ""
        method_by = _METHOD_RU_BY.get(prev.payment_method, prev.payment_method)
        who = f" (записал(а) {prev.admin_name})" if prev.admin_name else ""
        message = (
            f"Сегодня в {time_local}{where} этому клиенту уже внесено "
            f"{amount_txt} {cur} {method_by}{who}. "
            "Если это второй платёж, подтвердите ещё одну запись."
        )
    else:
        # Первую запись сделал другой администратор — скажем, кто (может, коллега с телефона).
        by = f", записал(а) {prev.admin_name}" if prev.admin_name and prev.admin_id != current_admin_id else ""
        message = (
            f"Такая же операция по этому клиенту уже записана {_ago_ru(secs)} "
            f"({amount_txt} {cur}, {method}{by}). "
            "Если это не ошибка, подтвердите ещё одну запись."
        )
    return HTTPException(
        status_code=409,
        detail={
            "code": "duplicate_recent",
            "message": message,
            "existing": {
                "id": prev.id,
                "amount": prev.amount,
                "payment_method": prev.payment_method,
                "created_at": prev.created_at.isoformat(),
                "seconds_ago": secs,
                "window": window,
                "branch": prev.branch,
                "admin_name": prev.admin_name,
                "time_local": time_local,
            },
        },
    )


@router.post("/transactions", response_model=CashboxTransactionRead)
def create_transaction(
    payload: CashboxTransactionCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_cashbox),
):
    if payload.type not in ("income", "expense"):
        raise HTTPException(400, "type должен быть 'income' или 'expense'")
    if payload.amount <= 0:
        raise HTTPException(400, "amount должен быть больше 0")

    cat_name = None
    if payload.category_id:
        cat = session.get(ExpenseCategory, payload.category_id)
        if not cat:
            raise HTTPException(404, "Категория не найдена")
        cat_name = cat.name

    # Resolve client name if client_id provided
    client_name = payload.client_name
    if payload.client_id and not client_name:
        from app.models.therapist_client import TherapistClient
        client = session.get(TherapistClient, payload.client_id)
        if client:
            client_name = client.name

    # ── Optionally credit user balance (Excel #43) ──
    # Only for income transactions with a client selected. We try to resolve
    # the client_id as either a User UUID or an email and top up User.balance.
    credited_user_id: Optional[str] = None
    target_user: Optional[User] = None
    # Пользователя для проверки дубля и ключа замка ищем и без флага зачисления:
    # один человек под UUID и под email — один клиент. Не нашли — остаётся сырой client_id.
    lookup_user: Optional[User] = None
    if payload.type == "income" and payload.client_id:
        lookup_user = _resolve_user_from_client_id(session, payload.client_id)
    if payload.credit_user_balance and payload.type == "income" and payload.client_id:
        target_user = lookup_user
        if not target_user:
            raise HTTPException(
                400,
                "Клиент не найден среди пользователей — нельзя зачислить на баланс. "
                "Выберите клиента из списка зарегистрированных пользователей.",
            )
        credited_user_id = str(target_user.id)
        # Prefer the user's canonical name for the cash-box record
        if not client_name and target_user.name:
            client_name = target_user.name

    # ── Защита от двойного внесения (приход с клиентом, не корректировка) ──
    # Замок и проверка — в той же транзакции, что и запись ниже (commit в конце).
    if (
        payload.type == "income"
        and payload.client_id
        and payload.payment_method != NON_MONEY_METHOD
    ):
        _lock_client_for_payment(
            session, str(lookup_user.id) if lookup_user is not None else payload.client_id,
        )
        if not payload.confirm_duplicate:
            prev = _find_recent_duplicate(session, payload, lookup_user)
            if prev is not None:
                raise _duplicate_payment_error(prev, str(current_user.id))
            # Не в последние 3 минуты, но уже сегодня (по Тбилиси) — мягкое
            # предупреждение с временем и филиалом первой записи.
            prev = _find_today_duplicate(session, payload, lookup_user)
            if prev is not None:
                raise _duplicate_payment_error(prev, str(current_user.id), window="today")

    # ── Normalise the operation date to UTC-naive ──
    # Frontend sends Tbilisi wall-clock as a naive ISO string
    # ("YYYY-MM-DDTHH:MM"). The DB column is stored UTC-naive (server is
    # UTC). Without conversion the same column carried two different
    # meanings — frontend's naive went in as-is, defaulted-to-now() rows
    # went in as UTC. Display always treats as UTC → entries with
    # explicit date appeared shifted +4h ("кенгуру" admins reported).
    # Always go through `_normalise_tx_date` so the column has one
    # interpretation forever.
    tx = CashboxTransaction(
        type=payload.type,
        amount=payload.amount,
        currency=payload.currency,
        payment_method=payload.payment_method,
        category_id=payload.category_id,
        description=payload.description,
        branch=payload.branch,
        date=_normalise_tx_date(payload.date),
        admin_id=str(current_user.id),
        admin_name=current_user.name or "",
        client_id=payload.client_id,
        client_name=client_name,
        credited_user_id=credited_user_id,
    )
    session.add(tx)

    if target_user is not None:
        from app.services import wallet
        wallet.credit(session, target_user, float(payload.amount), reason="topup",
                      description=f"Пополнение через кассу ({payload.payment_method})",
                      ref_type="cashbox_tx", ref_id=str(tx.id), actor=current_user)

    session.commit()
    session.refresh(tx)

    result = CashboxTransactionRead.model_validate(tx)
    result.category_name = cat_name
    return result


def _resolve_user_from_client_id(session: Session, client_id: str) -> Optional[User]:
    """Treat client_id as either a User.id (UUID) or a User.email and fetch."""
    if not client_id:
        return None
    # Try UUID path first
    try:
        from uuid import UUID as _UUID
        u = session.get(User, _UUID(client_id))
        if u:
            return u
    except (ValueError, AttributeError):
        pass
    # Fallback: email
    return session.exec(select(User).where(User.email == client_id)).first()


@router.delete("/transactions/{transaction_id}")
def delete_transaction(
    transaction_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_cashbox),
):
    tx = session.get(CashboxTransaction, transaction_id)
    if not tx:
        raise HTTPException(404, "Транзакция не найдена")

    # Senior_admin/owner can delete any transaction immediately
    # Admin can only delete today's transactions; older ones need senior approval
    tx_date = tx.date.date() if isinstance(tx.date, datetime) else tx.date
    is_today = tx_date == date.today()

    if current_user.role not in ("owner", "senior_admin") and not is_today:
        raise HTTPException(403, "Удаление прошлых транзакций требует подтверждения старшего администратора")

    # If this transaction credited a user balance, reverse the credit.
    if tx.credited_user_id:
        try:
            from uuid import UUID as _UUID
            target = session.get(User, _UUID(tx.credited_user_id))
        except (ValueError, AttributeError):
            target = None
        if target:
            from app.services import wallet
            wallet.debit(session, target, float(tx.amount), reason="topup_reversal",
                         description="Удаление кассовой проводки — откат зачисления",
                         ref_type="cashbox_tx", ref_id=str(tx.id), actor=current_user)

    session.delete(tx)
    session.commit()
    return {"ok": True}


@router.patch("/transactions/{transaction_id}", response_model=CashboxTransactionRead)
def update_transaction(
    transaction_id: str,
    payload: dict,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_cashbox),
):
    """Edit an existing transaction. Permission rules mirror delete:
    owner/senior_admin — any transaction; admin — today and yesterday only."""
    tx = session.get(CashboxTransaction, transaction_id)
    if not tx:
        raise HTTPException(404, "Транзакция не найдена")

    # 2026-06-28 owner: РЕДАКТИРОВАТЬ транзакции может только владелец.
    if current_user.role != "owner":
        raise HTTPException(403, "Редактировать транзакции может только владелец")

    # Allowed fields
    allowed = {"type", "amount", "currency", "payment_method", "category_id",
               "description", "branch", "date", "client_id", "client_name"}

    # Snapshot pre-change state to rebalance a credited user afterwards.
    old_amount = float(tx.amount or 0)
    old_type = tx.type
    old_credited_user_id = tx.credited_user_id

    for key, value in payload.items():
        if key in allowed:
            if key == "date" and value:
                value = _normalise_tx_date(value)
            if key == "type" and value not in ("income", "expense"):
                raise HTTPException(400, "type должен быть 'income' или 'expense'")
            if key == "amount" and (value is None or float(value) <= 0):
                raise HTTPException(400, "amount должен быть больше 0")
            setattr(tx, key, value)

    # Resolve client name from client_id if not provided
    if "client_id" in payload and payload["client_id"] and "client_name" not in payload:
        from app.models.therapist_client import TherapistClient
        client = session.get(TherapistClient, payload["client_id"])
        if client:
            tx.client_name = client.name

    # If this transaction previously credited a user, and the amount/type has
    # changed, compensate the user balance accordingly. We don't support moving
    # a credit between users via edit — changing client_id on a credited tx
    # keeps the original credit pinned to the original user; admins should
    # delete + recreate to reassign.
    if old_credited_user_id:
        try:
            from uuid import UUID as _UUID
            target = session.get(User, _UUID(old_credited_user_id))
        except (ValueError, AttributeError):
            target = None
        if target:
            # If the type flipped off income, reverse the old credit entirely.
            # Otherwise apply the delta (new_amount − old_amount).
            if tx.type != "income":
                delta = -old_amount
                tx.credited_user_id = None  # credit no longer applies
            else:
                delta = float(tx.amount or 0) - old_amount
            if delta != 0:
                from app.services import wallet
                wallet.apply(session, target, delta, reason="topup_adjust",
                             description="Правка кассовой проводки — пересчёт зачисления",
                             ref_type="cashbox_tx", ref_id=str(tx.id), actor=current_user)

    # Resolve category name for response
    cat_name = None
    if tx.category_id:
        cat = session.get(ExpenseCategory, tx.category_id)
        if cat:
            cat_name = cat.name

    session.add(tx)
    session.commit()
    session.refresh(tx)

    result = CashboxTransactionRead.model_validate(tx)
    result.category_name = cat_name
    return result


@router.post("/balance-correction")
def create_balance_correction(
    payload: dict,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_cashbox),
):
    """Create a balance correction (start balance or adjustment). Owner/senior_admin only."""
    from app.api import deps
    if not deps.has_permission(current_user, "finance.balance_correction"):
        raise HTTPException(403, "Нет права на корректировку остатков")

    payment_method = payload.get("payment_method", "cash")
    new_balance = payload.get("new_balance")
    reason = payload.get("reason", "Корректировка остатков")
    branch = payload.get("branch")  # optional branch filter

    if new_balance is None:
        raise HTTPException(400, "new_balance обязателен")

    # Calculate current balance for this payment method (optionally filtered by branch)
    inc_q = select(func.coalesce(func.sum(CashboxTransaction.amount), 0)).where(
        CashboxTransaction.type == "income",
        CashboxTransaction.payment_method == payment_method,
    )
    exp_q = select(func.coalesce(func.sum(CashboxTransaction.amount), 0)).where(
        CashboxTransaction.type == "expense",
        CashboxTransaction.payment_method == payment_method,
    )
    if branch:
        inc_q = inc_q.where(CashboxTransaction.branch == branch)
        exp_q = exp_q.where(CashboxTransaction.branch == branch)

    income = session.exec(inc_q).one()
    expense = session.exec(exp_q).one()
    current_balance = float(income) - float(expense)
    diff = float(new_balance) - current_balance

    if abs(diff) < 0.01:
        return {"ok": True, "message": "Баланс уже соответствует", "diff": 0}

    # Create correction transaction (with branch if specified)
    tx = CashboxTransaction(
        type="income" if diff > 0 else "expense",
        amount=abs(diff),
        currency="GEL",
        payment_method=payment_method,
        branch=branch or None,
        description=f"[КОРРЕКЦИЯ{' · ' + branch if branch else ''}] {reason} (было: {current_balance:.2f}, стало: {new_balance:.2f})",
        date=_normalise_tx_date(None),
        admin_id=str(current_user.id),
        admin_name=current_user.name or "",
    )
    session.add(tx)
    session.commit()

    return {
        "ok": True,
        "previous_balance": round(current_balance, 2),
        "new_balance": round(float(new_balance), 2),
        "diff": round(diff, 2),
        "transaction_id": tx.id,
    }
