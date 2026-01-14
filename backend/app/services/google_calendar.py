import os
import logging
from typing import Optional
from google.oauth2 import service_account
from googleapiclient.discovery import build
from app.models.booking import Booking

logger = logging.getLogger(__name__)

SCOPES = ['https://www.googleapis.com/auth/calendar']

class GoogleCalendarService:
    def __init__(self):
        self.creds = None
        self.service = None
        self._authenticate()

    def _authenticate(self):
        """
        Authenticate using Service Account JSON from env variable.
        Expected ENV: GOOGLE_SERVICE_ACCOUNT_JSON (content of the file)
        """
        try:
            # We expect the actual JSON content in the env var for simplicity in Render,
            # OR a path to a file. Render supports "Secret Files", which appear as files.
            # Let's support both: Path or Content?
            # Easiest for Render Secret Files is a PATH.
            # Let's assume GOOGLE_APPLICATION_CREDENTIALS is set by Render if using that feature,
            # OR we use a custom var GOOGLE_SERVICE_ACCOUNT_FILE.
            
            # Using specific logic for Unbox:
            json_path = os.environ.get("GOOGLE_SERVICE_ACCOUNT_FILE", "credentials.json")
            
            if os.path.exists(json_path):
                self.creds = service_account.Credentials.from_service_account_file(
                    json_path, scopes=SCOPES
                )
            else:
                # Try parsing content directly? (Maybe later if needed)
                logger.warning(f"Google Service Account file not found at {json_path}. GCal Sync disabled.")
                return

            self.service = build('calendar', 'v3', credentials=self.creds)
            logger.info("Google Calendar Service Authenticated successfully.")

        except Exception as e:
            logger.error(f"Failed to authenticate Google Calendar Service: {e}")

    def get_calendar_id(self, resource_id: str) -> Optional[str]:
        """
        Map internal resource_id to Google Calendar ID.
        Expected ENVs: CALENDAR_ID_CABINET_5, CALENDAR_ID_CAPSULE
        """
        if resource_id == 'cabinet-5':
            return os.environ.get("CALENDAR_ID_CABINET_5")
        elif resource_id == 'unbox_one' or 'capsule' in resource_id: # Assuming capsule is unbox_one or similar
            return os.environ.get("CALENDAR_ID_CAPSULE")
        return None

    def create_event(self, booking: Booking) -> Optional[str]:
        """
        Create an event in Google Calendar. Returns event ID.
        """
        if not self.service:
            return None
            
        calendar_id = self.get_calendar_id(booking.resource_id)
        if not calendar_id:
            logger.warning(f"No Calendar ID found for resource {booking.resource_id}")
            return None

        summary = f"Бронь: {booking.format} ({booking.payment_method})"
        if booking.user_id: # Might be email
             summary += f" - {booking.user_id}"

        # Convert times. Booking date is datetime, start_time is "HH:MM".
        # Need ISO format with timezone. 
        # Assuming UTC for now or local? 
        # Render is UTC. Tbilis is UTC+4. 
        # Better to send explicit timeZone in body.
        
        try:
            # Construct start/end dt
            date_str = booking.date.strftime("%Y-%m-%d")
            
            start_dt = f"{date_str}T{booking.start_time}:00"
            
            # Calculate end
            start_h, start_m = map(int, booking.start_time.split(':'))
            total_minutes = start_h * 60 + start_m + booking.duration
            end_h = total_minutes // 60
            end_m = total_minutes % 60
            end_dt = f"{date_str}T{end_h:02d}:{end_m:02d}:00"

            event = {
                'summary': summary,
                'description': f"Id: {booking.id}\nExtras: {booking.extras}",
                'start': {
                    'dateTime': start_dt,
                    'timeZone': 'Asia/Tbilisi', # Hardcoded for Unbox
                },
                'end': {
                    'dateTime': end_dt,
                    'timeZone': 'Asia/Tbilisi',
                },
            }

            created_event = self.service.events().insert(calendarId=calendar_id, body=event).execute()
            return created_event.get('id')
            
        except Exception as e:
            logger.error(f"Failed to create GCal event: {e}")
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
            logger.info(f"Deleted GCal event {event_id}")
        except Exception as e:
            logger.error(f"Failed to delete GCal event {event_id}: {e}")

# Global instance
gcal_service = GoogleCalendarService()
