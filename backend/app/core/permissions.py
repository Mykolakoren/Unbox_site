"""
Centralized permission definitions and checks.
Extracted from api/deps.py to avoid layering violations (services → api).
"""

ADMIN_ROLES = {"owner", "senior_admin", "admin"}
SPECIALIST_ROLE = "specialist"

# ── Granular permissions ───────────────────────────────────────────────────────
# Psy-CRM permissions — also auto-granted to role=specialist
PSY_CRM_PERMISSIONS = {"psy_crm.access", "psy_crm.clients", "psy_crm.sessions", "psy_crm.finances"}

# Permissions that senior_admin is allowed to grant/revoke (subset of all)
SENIOR_ADMIN_GRANTABLE = {
    # CRM Unbox
    "crm.view_clients", "crm.create_client", "crm.edit_client", "crm.manage_status",
    # Бронирования
    "bookings.view_all", "bookings.cancel_any", "bookings.reschedule_any",
    "bookings.override_24h", "bookings.manage_rerent",
    # Абонементы и скидки
    "subscriptions.manage", "subscriptions.request_discount", "subscriptions.set_discount",
    # Финансы
    "finance.topup_balance", "finance.set_credit_limit", "finance.view_reports", "finance.manage_cashbox",
    # Контент
    "content.edit_locations", "content.edit_rooms", "content.add_locations", "content.add_rooms",
    "content.set_hours", "content.edit_pricing",
    # Специалисты
    "specialists.verify",
    # Система
    "admin.access", "admin.dashboard", "admin.accept_requests",
}

# Owner can grant everything above + these
OWNER_ONLY_GRANTABLE = {
    "admin.assign_roles",
    "admin.assign_owner",
    "content.delete",
}
ALL_GRANTABLE = SENIOR_ADMIN_GRANTABLE | OWNER_ONLY_GRANTABLE


def has_permission(user, permission: str) -> bool:
    """Check if user has a specific granular permission.

    Owner auto-has ALL permissions.
    Specialists auto-have all psy_crm.* permissions via their role.
    Admins/owners auto-have admin.access via their role.
    """
    # Owner has all permissions
    if user.role == "owner":
        return True
    if permission in PSY_CRM_PERMISSIONS and user.role == SPECIALIST_ROLE:
        return True
    if permission == "admin.access" and user.role in ADMIN_ROLES:
        return True
    return permission in (user.permissions or [])
