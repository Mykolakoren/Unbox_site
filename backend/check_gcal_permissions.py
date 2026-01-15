
import asyncio
import logging
from app.services.google_calendar import gcal_service
from app.core.config import settings

# Setup basic logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def check_permissions():
    print("--- 🔍 Google Calendar Permission Check ---")
    
    if not gcal_service.is_connected():
        print("❌ Service Account NOT connected! Check credentials.json path.")
        return

    print("✅ Service Account Authenticated.")
    print(f"📧 Service Account Email: {gcal_service.creds.service_account_email if gcal_service.creds else 'Unknown'}")
    print("-------------------------------------------")

    resources = [
        ("Кабинет 1 (Палиашвили)", "unbox_one_room_1"),
        ("Кабинет 2 (Палиашвили)", "unbox_one_room_2"),
        ("Кабинет 5 (Uni)", "unbox_uni_room_5"),
        ("Кабинет 6 (Uni)", "unbox_uni_room_6"),
        ("Кабинет 7 (Uni)", "unbox_uni_room_7"),
        ("Кабинет 8 (Uni)", "unbox_uni_room_8"),
        ("Кабинет 9 (Uni)", "unbox_uni_room_9"),
        ("Капсула 1 (Uni)", "unbox_uni_capsule_1"),
        ("Капсула 2 (Uni)", "unbox_uni_capsule_2"),
    ]

    for name, resource_id in resources:
        cal_id = gcal_service.get_calendar_id(resource_id)
        
        if not cal_id:
            print(f"⚠️  {name}: No Calendar ID found in .env settings.")
            continue

        try:
            # Try to fetch calendar details (requires Read access)
            gcal_service.service.calendars().get(calendarId=cal_id).execute()
            print(f"✅ {name}: OK ({cal_id[:10]}...)")
        except Exception as e:
            error_msg = str(e)
            if "404" in error_msg:
                print(f"❌ {name}: Not Found (Wrong ID?)")
            elif "403" in error_msg:
                print(f"🚫 {name}: Access Denied (Share calendar with Service Account!)")
            else:
                print(f"❌ {name}: Error - {error_msg}")

    print("-------------------------------------------")
    print("Done.")

if __name__ == "__main__":
    check_permissions()
