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
        event = TimelineEvent(
            actor_id=actor_id,
            actor_req_role=actor_role,
            target_id=target_id,
            target_type=target_type,
            event_type=event_type,
            description=description,
            metadata_dump=metadata,
            timestamp=datetime.utcnow()
        )
        session.add(event)
        session.commit()
        session.refresh(event)
        return event

timeline_service = TimelineService()
