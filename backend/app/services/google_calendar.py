import os
import json
import logging
from typing import Optional
from google.oauth2 import service_account
from googleapiclient.discovery import build
from app.models.booking import Booking
from app.core.config import settings

logger = logging.getLogger(__name__)

SCOPES = ['https://www.googleapis.com/auth/calendar']

class GoogleCalendarService:
    def __init__(self):
        self.creds = None
        self.service = None
        self._authenticate()

    def _authenticate(self):
        """
        Authenticate using Service Account credentials.
        Supports two methods:
        1. GOOGLE_SERVICE_ACCOUNT_FILE — path to credentials JSON file
        2. GOOGLE_SERVICE_ACCOUNT_JSON — raw JSON content as env variable
        """
        try:
            # Method 1: JSON content from env variable (preferred for cloud deployments)
            json_content = os.environ.get('GOOGLE_SERVICE_ACCOUNT_JSON') or getattr(settings, 'GOOGLE_SERVICE_ACCOUNT_JSON', None)
            if json_content:
                try:
                    info = json.loads(json_content)
                    self.creds = service_account.Credentials.from_service_account_info(
                        info, scopes=SCOPES
                    )
                    self.service = build('calendar', 'v3', credentials=self.creds)
                    logger.info("Google Calendar: Authenticated via GOOGLE_SERVICE_ACCOUNT_JSON env variable.")
                    return
                except (json.JSONDecodeError, ValueError) as e:
                    logger.error(f"Google Calendar: Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON: {e}")

            # Method 2: File path
            json_path = settings.GOOGLE_SERVICE_ACCOUNT_FILE or "credentials.json"

            if os.path.exists(json_path):
                self.creds = service_account.Credentials.from_service_account_file(
                    json_path, scopes=SCOPES
                )
                self.service = build('calendar', 'v3', credentials=self.creds)
                logger.info(f"Google Calendar: Authenticated via file: {json_path}")
            else:
                logger.warning(
                    f"Google Calendar: NOT CONNECTED. "
                    f"No credentials found. Set GOOGLE_SERVICE_ACCOUNT_JSON env var "
                    f"(with JSON content) or place credentials file at: {os.path.abspath(json_path)}"
                )

        except Exception as e:
            logger.error(f"Google Calendar: Authentication failed: {e}")

    def get_calendar_id(self, resource_id: str) -> Optional[str]:
        """
        Map internal resource_id to Google Calendar ID.
        """
        mapping = {
            # Unbox One
            "unbox_one_room_1": "CALENDAR_ID_CABINET_1",
            "unbox_one_room_2": "CALENDAR_ID_CABINET_2",

            # Unbox Uni
            "unbox_uni_room_5": "CALENDAR_ID_CABINET_5",
            "unbox_uni_room_6": "CALENDAR_ID_CABINET_6",
            "unbox_uni_room_7": "CALENDAR_ID_CABINET_7",
            "unbox_uni_room_8": "CALENDAR_ID_CABINET_8",
            "unbox_uni_room_9": "CALENDAR_ID_CABINET_9",

            # Capsules
            "unbox_uni_capsule_1": "CALENDAR_ID_CAPSULE_1",
            "unbox_uni_capsule_2": "CALENDAR_ID_CAPSULE_2",
        }

        env_var = mapping.get(resource_id)

        # Legacy fallback / Aliases
        if not env_var:
             if "capsule" in resource_id and "1" in resource_id: env_var = "CALENDAR_ID_CAPSULE_1"
             if "capsule" in resource_id and "2" in resource_id: env_var = "CALENDAR_ID_CAPSULE_2"
             # Fallback for old "capsule" var if user hasn't updated to _1 yet
             if resource_id == "unbox_uni_capsule_1" and not os.environ.get("CALENDAR_ID_CAPSULE_1"):
                  return os.environ.get("CALENDAR_ID_CAPSULE")

        if env_var:
            cal_id = getattr(settings, env_var, None) or os.environ.get(env_var)
            if not cal_id:
                logger.warning(f"Google Calendar: Env var {env_var} is not set for resource {resource_id}")
            return cal_id

        logger.warning(f"Google Calendar: No mapping found for resource_id: {resource_id}")
        return None

    def create_event(self, booking: Booking) -> Optional[str]:
        """
        Create an event in Google Calendar. Returns event ID.
        """
        if not self.service:
            logger.warning(f"Google Calendar: Cannot create event — service not connected. Booking {booking.id}")
            return None

        calendar_id = self.get_calendar_id(booking.resource_id)
        if not calendar_id:
            logger.warning(f"Google Calendar: No Calendar ID found for resource {booking.resource_id}")
            return None

        summary = f"Бронь: {booking.format} ({booking.payment_method})"
        if booking.user_id:
             summary += f" - {booking.user_id}"

        try:
            # Construct start/end datetime strings
            date_str = booking.date.strftime("%Y-%m-%d")

            start_dt = f"{date_str}T{booking.start_time}:00"

            # Calculate end time
            start_h, start_m = map(int, booking.start_time.split(':'))
            total_minutes = start_h * 60 + start_m + booking.duration
            end_h = total_minutes // 60
            end_m = total_minutes % 60
            end_dt = f"{date_str}T{end_h:02d}:{end_m:02d}:00"

            event = {
                'summary': summary,
                'description': f"Booking ID: {booking.id}\nExtras: {booking.extras}",
                'start': {
                    'dateTime': start_dt,
                    'timeZone': 'Asia/Tbilisi',
                },
                'end': {
                    'dateTime': end_dt,
                    'timeZone': 'Asia/Tbilisi',
                },
            }

            logger.info(f"Google Calendar: Creating event for booking {booking.id} "
                       f"on calendar {calendar_id[:20]}... "
                       f"Date: {date_str}, Time: {booking.start_time}, Duration: {booking.duration}min")

            created_event = self.service.events().insert(calendarId=calendar_id, body=event).execute()
            event_id = created_event.get('id')
            logger.info(f"Google Calendar: Event created successfully. Event ID: {event_id}")
            return event_id

        except Exception as e:
            logger.error(f"Google Calendar: Failed to create event for booking {booking.id}: {e}")
            return None

    def delete_event(self, event_id: str, resource_id: str):
        """
        Delete an event from Google Calendar.
        """
        if not self.service or not event_id:
            return

        calendar_id = self.get_calendar_id(resource_id)
        if not calendar_id:
            return

        try:
            self.service.events().delete(calendarId=calendar_id, eventId=event_id).execute()
            logger.info(f"Google Calendar: Deleted event {event_id}")
        except Exception as e:
            logger.error(f"Google Calendar: Failed to delete event {event_id}: {e}")

    def is_connected(self) -> bool:
        """
        Check if the service is authenticated and ready.
        """
        if self.service is None:
            self._authenticate()
        return self.service is not None

# Global instance
gcal_service = GoogleCalendarService()
