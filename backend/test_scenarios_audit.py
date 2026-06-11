"""Scenario checks for the audit changes — comp discount + overload threshold.

Pure-Python stubs, no server/DB needed. Run: venv/bin/python test_scenarios_audit.py
"""
from datetime import datetime
from types import SimpleNamespace
import re
from app.services.pricing import PricingService

# Read the threshold straight from source (importing routes.py pulls slowapi,
# which isn't in this venv — the constant is all we need here).
_src = open("app/api/v1/bookings/routes.py").read()
FUTURE_BOOKING_ALERT_THRESHOLD = int(
    re.search(r"FUTURE_BOOKING_ALERT_THRESHOLD\s*=\s*(\d+)", _src).group(1)
)


class _EmptyResult:
    def all(self): return []
    def first(self): return None
    def __iter__(self): return iter([])


class _StubSession:
    """Returns one fixed Resource for .get; empty for any .exec query."""
    def __init__(self, resource):
        self._resource = resource
    def get(self, model, _id):
        return self._resource
    def exec(self, *_a, **_k):
        return _EmptyResult()


def _resource():
    # 20₾/ч individual room in Unbox One (not neo_school, not the cab-2 special)
    return SimpleNamespace(
        id="unbox_one_room_1", type="room",
        hourly_rate=20.0, location_id="unbox_one",
    )


def _user(email, pricing_system="standard", subscription=None):
    return SimpleNamespace(
        email=email, pricing_system=pricing_system,
        personal_discount_percent=0, subscription=subscription,
        id="stub-uuid-0001", role="client", created_at=datetime(2026, 1, 1),
    )


PEAK = datetime(2026, 6, 12, 9, 0)      # 09:00 — peak hour (+5₾/ч surcharge)
OFFP = datetime(2026, 6, 12, 14, 0)     # 14:00 — non-peak

results = []
def check(name, cond):
    results.append((name, cond))
    print(("✓" if cond else "✗ FAIL") + "  " + name)


svc = PricingService(_StubSession(_resource()))

# 1. Comp owner — peak hour, 1h → must be FULLY free incl. surcharge
q = svc.calculate_price(_user("koren.nikolas@gmail.com"), "unbox_one_room_1", PEAK, 60, "individual")
check("owner: peak 1h = 0₾", q.final_price == 0.0)
check("owner: peak surcharge zeroed", q.peak_surcharge == 0.0)
check("owner: rule = COMP_ACCOUNT", q.applied_rule == "COMP_ACCOUNT")

# 2. Comp Irina — case-insensitive email, off-peak 2h → free
q = svc.calculate_price(_user("IRINA.CBTPSY@gmail.com"), "unbox_one_room_1", OFFP, 120, "individual")
check("irina: off-peak 2h = 0₾ (case-insensitive)", q.final_price == 0.0)

# 3. Normal user — peak 1h → pays base 20 + surcharge 5 = 25₾ (NOT free)
q = svc.calculate_price(_user("someone@example.com"), "unbox_one_room_1", PEAK, 60, "individual")
check("normal: peak 1h = 25₾ (base+surcharge, no comp)", q.final_price == 25.0)
check("normal: surcharge present (5₾)", q.peak_surcharge == 5.0)

# 4. Anonymous (user=None) — unaffected by comp logic
q = svc.calculate_price(None, "unbox_one_room_1", OFFP, 60, "individual")
check("anon: off-peak 1h = 20₾", q.final_price == 20.0)

# 5. Overload-alert threshold crossing (fires only on the op that crosses up)
def crosses(count_after, n_created):
    before = count_after - n_created
    return not (before > FUTURE_BOOKING_ALERT_THRESHOLD or count_after <= FUTURE_BOOKING_ALERT_THRESHOLD)
check("alert: 20->21 single fires", crosses(21, 1) is True)
check("alert: 19->20 does not fire", crosses(20, 1) is False)
check("alert: 21->22 (already over) no spam", crosses(22, 1) is False)
check("alert: 15->27 series fires once", crosses(27, 12) is True)
check("alert: 0->30 big series fires", crosses(30, 30) is True)
check(f"alert: threshold is {FUTURE_BOOKING_ALERT_THRESHOLD}", FUTURE_BOOKING_ALERT_THRESHOLD == 20)

passed = sum(1 for _, c in results if c)
print(f"\n{passed}/{len(results)} checks passed")
raise SystemExit(0 if passed == len(results) else 1)
