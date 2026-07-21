from datetime import datetime
from uuid import UUID
from sqlmodel import Session
from app.models.timeline import TimelineEvent, TimelineEventCreate

# Актор для действий, которые совершил не человек, а система (крон, скрипты).
# Колонка actor_id — UUID NOT NULL, поэтому «ничей» актор должен быть не None,
# а вот этим нулевым UUID: иначе вставка падает и валит транзакцию вызывающего.
SYSTEM_ACTOR_ID = UUID("00000000-0000-0000-0000-000000000000")


class TimelineService:
    @staticmethod
    def log_event(
        session: Session,
        actor_id: UUID,
        actor_role: str,
        target_id: str,
        target_type: str,
        event_type: str,
        description: str,
        metadata: dict = {}
    ) -> TimelineEvent:
        """
        Create a timeline entry.
        """
        # Nearly every caller passes `str(user.id)` although the column is a
        # UUID. psycopg2 adapts that silently, so it went unnoticed; any other
        # driver raises inside the flush — and because log_event commits, that
        # poisons the caller's whole transaction (the balance change it was
        # logging gets rolled back with it). Coerce instead of trusting callers.
        if isinstance(actor_id, str):
            try:
                actor_id = UUID(actor_id)
            except ValueError:
                # Раньше здесь стояло None — и вставка падала на NOT NULL,
                # утаскивая за собой всю транзакцию вызывающего (log_event
                # делает commit). Так молча ломался ночной скрипт завершения
                # абонементов: он передаёт actor_id="system". Теперь любой
                # нечеловеческий актор пишется системным UUID.
                actor_id = SYSTEM_ACTOR_ID
        if actor_id is None:
            actor_id = SYSTEM_ACTOR_ID

        event = TimelineEvent(
            actor_id=actor_id,
            actor_req_role=actor_role,
            target_id=target_id,
            target_type=target_type,
            event_type=event_type,
            description=description,
            metadata_dump=metadata,
            timestamp=datetime.now()
        )
        session.add(event)
        session.commit()
        session.refresh(event)
        return event

timeline_service = TimelineService()
