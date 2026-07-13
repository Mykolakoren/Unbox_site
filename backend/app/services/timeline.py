from datetime import datetime
from uuid import UUID
from sqlmodel import Session
from app.models.timeline import TimelineEvent, TimelineEventCreate

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
                actor_id = None  # type: ignore[assignment]

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
