from sqlmodel import SQLModel, Field, Relationship
from typing import Optional, List, TYPE_CHECKING
from sqlalchemy import Column, String, JSON
from uuid import UUID
import uuid

if TYPE_CHECKING:
    from .user import User

class SpecialistBase(SQLModel):
    first_name: str
    last_name: str
    photo_url: Optional[str] = None
    tagline: str = Field(default="", max_length=150)
    bio: str = Field(default="")

    # Store lists as JSON in the database
    specializations: List[str] = Field(default_factory=list, sa_column=Column(JSON))
    formats: List[str] = Field(default_factory=list, sa_column=Column(JSON))

    # Загруженные документы (дипломы/сертификаты) — URL-ы файлов. Обязательны
    # при подаче анкеты (2026-07-03 owner). Видны админу при проверке.
    documents: List[str] = Field(default_factory=list, sa_column=Column(JSON))
    # Плашки-маркеры на карточке специалиста. Фиксированный набор кодов,
    # ставит только админ. Допустимые: "in_training" | "recommended".
    badges: List[str] = Field(default_factory=list, sa_column=Column(JSON))

    # Контакты специалиста (показываются в профиле). Хендл или ссылка.
    instagram: Optional[str] = Field(default=None)
    telegram: Optional[str] = Field(default=None)
    website: Optional[str] = Field(default=None)

    base_price_gel: int = Field(default=0)
    # Длительность консультации в минутах — показывается в шапке профиля,
    # редактируется самим специалистом в анкете. Owner 2026-06-24.
    session_duration_min: int = Field(default=50)
    is_verified: bool = Field(default=False)
    # Visibility in PUBLIC catalog (/specialists). Separate from is_verified
    # which gates "can this profile work in CRM at all" (KYC/approval).
    # Owner 2026-06-06: Яна Педан и Юлия Рожек — verified, работают,
    # но в публичном каталоге не показываются (Яна — партнёр,
    # Юлия — сооснователь, не принимают по записи через сайт).
    is_public: bool = Field(default=True)
    # Self-service application status: NULL = legacy/admin-created (skip queue),
    # "pending" = user-submitted, awaiting admin review,
    # "approved" / "rejected" = post-decision.
    # NULL is intentional so existing rows keep working unchanged.
    application_status: Optional[str] = Field(default=None, index=True)
    # Category for public catalog filtering
    # Values: psychology | psychiatry | narcology | coaching | education
    category: Optional[str] = Field(default=None)
    # Display order in public catalog (lower = shown first)
    sort_order: int = Field(default=0)
    # Custom payment accounts for Psy CRM
    payment_accounts: List[dict] = Field(
        default_factory=lambda: [
            {"id": "cash", "label": "Наличные"},
            {"id": "tbc", "label": "TBC"},
            {"id": "bog", "label": "BOG"},
        ],
        sa_column=Column(JSON)
    )

class Specialist(SpecialistBase, table=True):
    __tablename__ = "specialists" # type: ignore

    id: UUID = Field(default_factory=uuid.uuid4, primary_key=True, index=True)
    user_id: Optional[UUID] = Field(default=None, foreign_key="user.id", index=True, unique=True)
    
    # Optional relationship back to user
    user: Optional["User"] = Relationship(back_populates="specialist_profile")

class SpecialistCreate(SpecialistBase):
    user_id: Optional[UUID] = None

class SpecialistUpdate(SQLModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    photo_url: Optional[str] = None
    tagline: Optional[str] = None
    bio: Optional[str] = None
    specializations: Optional[List[str]] = None
    formats: Optional[List[str]] = None
    base_price_gel: Optional[int] = None
    session_duration_min: Optional[int] = None
    is_verified: Optional[bool] = None
    is_public: Optional[bool] = None
    application_status: Optional[str] = None
    category: Optional[str] = None
    user_id: Optional[UUID] = None
    payment_accounts: Optional[List[dict]] = None
    sort_order: Optional[int] = None
    documents: Optional[List[str]] = None
    badges: Optional[List[str]] = None
    instagram: Optional[str] = None
    telegram: Optional[str] = None
    website: Optional[str] = None

class SpecialistRead(SpecialistBase):
    id: UUID
    user_id: Optional[UUID] = None
    sort_order: int = 0
    # True when the linked user has role 'owner' — that card is pinned to
    # the top of the catalogue and cannot be reordered below others.
    is_owner: bool = False
