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
            loc.lat = 41.6445739
            loc.lng = 41.6314886
            session.add(loc)
            session.commit()
            print("Lat/Lng for unbox_one updated to Batumi successfully.")
        else:
            print("unbox_one not found.")

if __name__ == "__main__":
    run_update()
