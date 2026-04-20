"""
ShiftOpenLog — audit-only record that an admin opened the shift.

Why a separate model from ShiftReport (the close): the close already does the
heavy lifting (reconcile cash, compute discrepancy, write a report). Open is a
much lighter event — we just want a timestamped, signed "I'm starting work"
mark for two reasons:

  1. UX (Excel #61, Иры): admins were starting the day with no clear "begin"
     action. A button + a confirmed log gives them a clear "smena nachata at
     09:12 by Ира" badge on the finance page.

  2. Audit: when something doesn't add up later ("who was at the till at 11am
     on the 18th?") we have a per-admin, per-branch row to point to.

Open events do NOT change cash math. The reconciliation in shifts.py still
treats `previous close → current close` as the shift window. An open event
without a matching close is fine (smena was opened, hasn't been closed yet).
"""
from typing import Optional
from uuid import uuid4
from datetime import datetime
from sqlmodel import SQLModel, Field


class ShiftOpenLogBase(SQLModel):
    branch: Optional[str] = Field(default=None, index=True)
    starting_balance: float = Field(default=0.0)
    notes: Optional[str] = Field(default=None)


class ShiftOpenLog(ShiftOpenLogBase, table=True):
    __tablename__ = "shift_open_logs"

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    admin_id: str = Field(index=True)
    admin_name: str = Field(default="")
    opened_at: datetime = Field(default_factory=datetime.now, index=True)


class ShiftOpenLogCreate(SQLModel):
    branch: Optional[str] = None
    starting_balance: float = 0.0
    notes: Optional[str] = None


class ShiftOpenLogRead(ShiftOpenLogBase):
    id: str
    admin_id: str
    admin_name: str
    opened_at: datetime
