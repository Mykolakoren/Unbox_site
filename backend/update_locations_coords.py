import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from sqlmodel import Session
from app.db.session import engine
from app.models.location import Location

def run_update():
    with Session(engine) as session:
        locs = [
            {"id": "unbox_one", "lat": 41.7096589, "lng": 44.7570254},
            {"id": "unbox_uni", "lat": 41.6330829, "lng": 41.6132810},
            {"id": "neo_school", "lat": 41.6381811, "lng": 41.6470100}
        ]
        
        for loc_data in locs:
            loc = session.get(Location, loc_data["id"])
            if loc:
                loc.lat = loc_data["lat"]
                loc.lng = loc_data["lng"]
                session.add(loc)
        
        session.commit()
        print("Locations updated with exact coordinates.")

if __name__ == "__main__":
    run_update()
