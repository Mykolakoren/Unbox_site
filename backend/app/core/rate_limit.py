"""Shared rate-limiter instance.

Uses slowapi (in-memory store by default). For a single-process deploy that's
fine; if we ever go multi-worker behind nginx we'll switch the storage_uri to
Redis. Keep import surface minimal so route files stay readable.
"""
from slowapi import Limiter
from slowapi.util import get_remote_address


# Single shared instance. We key by client IP (pulled from X-Forwarded-For by
# starlette when the nginx `real_ip` module is correct — which it is on our
# droplet). On miss falls back to the direct socket address.
limiter = Limiter(key_func=get_remote_address)
