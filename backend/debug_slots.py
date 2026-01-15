
import sys
import os
from datetime import datetime

# Add parent directory to path so we can import 'app'
current_dir = os.path.dirname(os.path.abspath(__file__)) # .../backend
sys.path.append(current_dir)

from sqlmodel import Session, select
from app.db.session import engine
from app.models.booking import Booking

resource_id = "unbox_uni_room_8"
target_date = datetime(2026, 1, 16).date()

def check_slots():
    print(f"--- 🔍 Checking Bookings for {resource_id} on {target_date} ---")
    try:
        with Session(engine) as session:
            statement = select(Booking).where(
                Booking.resource_id == resource_id,
                Booking.date == target_date,
                Booking.status.in_(['confirmed', 'pending'])
            )
            bookings = session.exec(statement).all()
            
            if not bookings:
                print("✅ No bookings found! Slot should be free.")
            else:
                print(f"⚠️ Found {len(bookings)} bookings:")
                for b in bookings:
                    print(f"   - ID: {b.id}, Time: {b.start_time}, Duration: {b.duration}m, Status: {b.status}")
                    # Calculate end time
                    start_h, start_m = map(int, b.start_time.split(':'))
                    start_min = start_h * 60 + start_m
                    end_min = start_min + b.duration
                    end_h = end_min // 60
                    end_m = end_min % 60
                    print(f"     Range: {b.start_time} - {end_h:02d}:{end_m:02d}")
    except Exception as e:
        print(f"❌ Error querying database: {e}")

if __name__ == "__main__":
    check_slots()
