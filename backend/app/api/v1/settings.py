"""
App-wide settings — exchange_rates for now, more knobs as we need them.

Reads are cheap: anyone authed can ask. Writes are admin-only and logged
(updated_by_user_id + updated_at on the row). Values are plain JSON so
the front can store whatever shape it wants without backend churn.
"""
from datetime import datetime
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app.api import deps
from app.db.session import get_session
from app.models.app_setting import AppSetting
from app.models.user import User

router = APIRouter()


# Defaults served when the table is empty (first deploy / fresh env).
# Same numbers as the frontend fallback in src/utils/currency.ts, so
# boots without any DB row still report consistent GEL equivalents.
DEFAULT_EXCHANGE_RATES: Dict[str, float] = {
    "GEL": 1.0,
    "USD": 2.69,
    "EUR": 3.11,
    "RUB": 0.034,
    "USDT": 2.69,
}


def get_exchange_rates(session: Session) -> Dict[str, float]:
    """Return current rates: DB row if present, else defaults. Never raises."""
    row = session.get(AppSetting, "exchange_rates")
    if row and isinstance(row.value, dict):
        merged = dict(DEFAULT_EXCHANGE_RATES)
        # Defensive: coerce values to float, drop garbage keys.
        for k, v in row.value.items():
            try:
                merged[str(k).upper()] = float(v)
            except (TypeError, ValueError):
                continue
        merged["GEL"] = 1.0  # immutable — GEL→GEL is always 1
        return merged
    return dict(DEFAULT_EXCHANGE_RATES)


@router.get("/exchange_rates")
def read_exchange_rates(
    session: Session = Depends(get_session),
    _: User = Depends(deps.get_current_user),  # auth only, no role check
) -> Dict[str, float]:
    return get_exchange_rates(session)


@router.put("/exchange_rates")
def update_exchange_rates(
    *,
    payload: Dict[str, Any],
    session: Session = Depends(get_session),
    current_user: User = Depends(deps.require_admin),
) -> Dict[str, float]:
    if current_user.role not in ("owner", "senior_admin"):
        raise HTTPException(403, "Только владелец или старший администратор")

    # Coerce all values to float, keep only recognized currency codes.
    clean: Dict[str, float] = {}
    for k, v in payload.items():
        code = str(k).upper().strip()
        if code not in ("GEL", "USD", "EUR", "RUB", "USDT"):
            continue
        try:
            clean[code] = float(v)
        except (TypeError, ValueError):
            continue
    clean["GEL"] = 1.0  # always

    row = session.get(AppSetting, "exchange_rates")
    if row is None:
        row = AppSetting(key="exchange_rates", value=clean)
    else:
        row.value = clean
    row.updated_at = datetime.now()
    row.updated_by_user_id = str(current_user.id)
    session.add(row)
    session.commit()
    session.refresh(row)
    return get_exchange_rates(session)
