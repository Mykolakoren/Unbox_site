from typing import Optional
from sqlmodel import Session, select
from app.models.notification import Notification
from app.models.user import User
from app.api.deps import ADMIN_ROLES, has_permission


class NotificationService:
    @staticmethod
    def create(
        session: Session,
        recipient_id: str,
        type: str,
        title: str,
        description: str = "",
        icon: Optional[str] = None,
        link: Optional[str] = None,
    ) -> Notification:
        n = Notification(
            recipient_id=recipient_id,
            type=type,
            title=title,
            description=description,
            icon=icon,
            link=link,
        )
        session.add(n)
        return n

    @staticmethod
    def notify_by_permission(
        session: Session,
        permission: str,
        type: str,
        title: str,
        description: str = "",
        icon: Optional[str] = None,
        link: Optional[str] = None,
    ) -> list[Notification]:
        admins = session.exec(
            select(User).where(User.role.in_(list(ADMIN_ROLES)))
        ).all()
        created = []
        for admin in admins:
            if has_permission(admin, permission):
                n = NotificationService.create(
                    session, str(admin.id), type, title, description, icon, link
                )
                created.append(n)
        return created

    @staticmethod
    def notify_admins(
        session: Session,
        type: str,
        title: str,
        description: str = "",
        icon: Optional[str] = None,
        link: Optional[str] = None,
        min_role: str = "admin",
    ) -> list[Notification]:
        role_hierarchy = {"admin": 0, "senior_admin": 1, "owner": 2}
        min_level = role_hierarchy.get(min_role, 0)
        admins = session.exec(
            select(User).where(User.role.in_(list(ADMIN_ROLES)))
        ).all()
        created = []
        for admin in admins:
            level = role_hierarchy.get(admin.role, -1)
            if level >= min_level:
                n = NotificationService.create(
                    session, str(admin.id), type, title, description, icon, link
                )
                created.append(n)
        return created


notification_service = NotificationService()
