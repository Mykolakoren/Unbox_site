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


# Default permissions by admin role (auto-granted without storing in DB)
ADMIN_DEFAULT_PERMISSIONS = {
    "admin.access", "admin.dashboard",
    "crm.view_clients", "crm.create_client", "crm.edit_client", "crm.manage_status",
    "bookings.view_all", "bookings.cancel_any", "bookings.reschedule_any", "bookings.manage_rerent",
    "subscriptions.manage", "subscriptions.request_discount",
    "finance.topup_balance", "finance.set_credit_limit", "finance.view_reports",
    "content.edit_locations", "content.edit_rooms", "content.set_hours",
    "specialists.verify",
}

SENIOR_ADMIN_DEFAULT_PERMISSIONS = ADMIN_DEFAULT_PERMISSIONS | {
    "bookings.override_24h",
    "subscriptions.set_discount",
    "finance.manage_cashbox",
    "content.add_locations", "content.add_rooms", "content.edit_pricing",
    "admin.assign_roles", "admin.accept_requests",
}


def has_permission(user, permission: str) -> bool:
    """Check if user has a specific granular permission.

    Owner auto-has ALL permissions.
    Senior_admin auto-has admin defaults + senior extras.
    Admin auto-has admin defaults.
    Specialists auto-have all psy_crm.* permissions via their role.
    """
    # Owner has all permissions
    if user.role == "owner":
        return True
    # Senior admin defaults
    if user.role == "senior_admin" and permission in SENIOR_ADMIN_DEFAULT_PERMISSIONS:
        return True
    # Admin defaults
    if user.role == "admin" and permission in ADMIN_DEFAULT_PERMISSIONS:
        return True
    # Specialist auto-has psy_crm.*
    if permission in PSY_CRM_PERMISSIONS and user.role == SPECIALIST_ROLE:
        return True
    # Explicit permissions in user record (overrides/extras)
    return permission in (user.permissions or [])
