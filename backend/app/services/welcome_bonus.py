"""Приветственный час: только действительно новому клиенту (владелец 27.10).

Кейс Лейсан Хусаиновой (26.10): аккаунт на сайте новый — подарок выдан, а по
переписке админов она бронировала и раньше. Сайт сверял только почту, поэтому
подарок получал и постоянный клиент, впервые зашедший сам, и второй аккаунт
на другую почту.

Теперь при самостоятельной регистрации:
  * имя+фамилия (или телефон) совпадают с уже известным клиентом (на сайте,
    в т.ч. архивные дубли, или в кассе) → подарок «ждёт подтверждения»
    (status='pending' — не тратится), в чат админов вопрос с кнопками
    «Новый — выдать» / «Не новый — не выдавать»;
  * совпадений нет → подарок сразу, как раньше, а в чат — короткое
    уведомление с кнопкой «Не новый — забрать подарок» (клиент мог ходить к
    нам до сайта — этого сайт знать не может).
Кнопки обрабатывает telegram.py (_handle_welcome_callback).
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta
from html import escape
from typing import Optional

from sqlmodel import Session, select

from app.models.bonus import Bonus
from app.models.user import User

logger = logging.getLogger(__name__)

WELCOME_DESCRIPTION = "Добро пожаловать в Unbox! 1 час аренды в подарок"


def _name_key(name: Optional[str]) -> Optional[str]:
    """«Хусаинова  Лейсан» и «лейсан хусаинова» — один ключ. Одно слово — None
    (одно имя без фамилии даёт слишком много ложных совпадений)."""
    words = re.findall(r"[a-zа-я]+", (name or "").lower().replace("ё", "е"))
    words = [w for w in words if len(w) >= 2]
    return " ".join(sorted(words)) if len(words) >= 2 else None


def _phone_key(phone: Optional[str]) -> Optional[str]:
    digits = re.sub(r"\D", "", phone or "")
    return digits[-9:] if len(digits) >= 9 else None


def known_client_match(session: Session, user: User) -> Optional[str]:
    """Чем новый аккаунт похож на уже известного клиента (текст для админов) или None."""
    from app.models.cashbox_transaction import CashboxTransaction

    nk, pk = _name_key(user.name), _phone_key(getattr(user, "phone", None))
    if not nk and not pk:
        return None
    for other in session.exec(select(User).where(User.id != user.id)).all():
        if (other.email or "").lower().endswith("@unbox.center"):
            continue
        if nk and _name_key(other.name) == nk:
            return f"на сайте уже есть клиент «{other.name}» ({other.email})" + (" — в архиве" if other.archived_at else "")
        if pk and _phone_key(getattr(other, "phone", None)) == pk:
            return f"телефон совпадает с клиентом «{other.name}» ({other.email})"
    if nk:
        # Одна колонка — exec отдаёт строки, а не кортежи.
        for cname in session.exec(select(CashboxTransaction.client_name).where(
                CashboxTransaction.client_name.is_not(None)).distinct()).all():  # type: ignore[union-attr]
            if _name_key(cname) == nk:
                return f"в кассе уже есть оплаты клиента «{cname}»"
    return None


def _markup(rows: list[list[tuple[str, str]]]) -> dict:
    return {"inline_keyboard": [[{"text": t, "callback_data": d} for t, d in row] for row in rows]}


def grant_welcome_bonus(session: Session, user: User, expiry_days: int) -> Optional[Bonus]:
    """Создать приветственный час (сразу или «на подтверждение») и сказать админам."""
    match = None
    try:
        match = known_client_match(session, user)
    except Exception:
        logger.exception("welcome bonus: known-client check failed for %s", user.email)
    bonus = Bonus(
        user_id=str(user.id),
        type="free_hour",
        quantity=1.0,
        status="pending" if match else "active",
        description=WELCOME_DESCRIPTION,
        granted_by_id="system",
        granted_by_name="Система",
        expires_at=datetime.now() + timedelta(days=expiry_days),
    )
    session.add(bonus)
    session.commit()
    session.refresh(bonus)
    try:
        from app.services.telegram import telegram_service
        who = f"{escape(user.name or '—')} ({escape(user.email or '—')})"
        if match:
            text = (f"🎁❓ Подарочный час ждёт решения\n\nЗарегистрировался {who}.\n"
                    f"Похоже, не новый клиент: {escape(match)}.\n\n"
                    "Подарочный час положен только новым клиентам. Новый — выдать?")
            markup = _markup([[("✅ Новый — выдать", f"wa:{bonus.id}"), ("❌ Не новый — не выдавать", f"wr:{bonus.id}")]])
        else:
            text = (f"🎁 Новый клиент: {who}\nПодарочный час выдан (действует {expiry_days} дн.).\n\n"
                    "Если это не новый клиент (ходил к нам раньше, до сайта) — заберите подарок кнопкой ниже.")
            markup = _markup([[("↩️ Не новый — забрать подарок", f"wx:{bonus.id}")]])
        telegram_service.send_admin_alert(text, reply_markup=markup)
    except Exception:
        logger.warning("welcome bonus: admin alert failed for %s", user.email, exc_info=True)
    return bonus


def decide(session: Session, bonus_id: str, action: str, actor_label: str) -> str:
    """Решение админа по кнопке. action: 'wa' выдать | 'wr' не выдавать | 'wx' забрать.
    Возвращает текст для админа."""
    from uuid import UUID
    try:
        bonus = session.get(Bonus, UUID(bonus_id))
    except (ValueError, TypeError):
        bonus = None
    if bonus is None or bonus.type != "free_hour":
        return "Подарок не найден"
    if action == "wa":
        if bonus.status != "pending":
            return "Уже решено раньше"
        bonus.status = "active"
    elif action in ("wr", "wx"):
        if bonus.status == "used":
            return ("Подарок уже потрачен на бронь — переведите её в обычную оплату "
                    "(карточка брони → «Цена») или напишите Жан-Клоду")
        if bonus.status not in ("pending", "active"):
            return "Уже решено раньше"
        bonus.status = "rejected"
        bonus.reject_reason = "Не новый клиент — подарочный час не положен"
    else:
        return "Неизвестное действие"
    bonus.approved_by_id = "telegram"
    bonus.approved_by_name = actor_label
    bonus.updated_at = datetime.now()
    session.add(bonus)
    session.commit()
    return "Подарочный час выдан" if action == "wa" else "Подарочный час убран"
