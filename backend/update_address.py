import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from sqlmodel import Session
from app.db.session import engine
from app.models.location import Location

def run_update():
    with Session(engine) as session:
        loc = session.get(Location, "unbox_one")
        if loc:
            loc.address = "Закария Палиашвили, 4"
            session.add(loc)
            session.commit()
            print("Address for unbox_one updated successfully.")
        else:
            print("unbox_one not found.")

if __name__ == "__main__":
    run_update()
