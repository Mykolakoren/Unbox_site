from geopy.geocoders import Nominatim
import time

geolocator = Nominatim(user_agent="unbox_app")

addresses = [
    "Paliashvili 4, Tbilisi, Georgia",
    "Tbel Abuseridze 38, Batumi, Georgia",
    "Sulaberidze 80, Batumi, Georgia"
]

for addr in addresses:
    try:
        location = geolocator.geocode(addr)
        if location:
            print(f"{addr}: {location.latitude}, {location.longitude}")
        else:
            print(f"{addr}: Not found")
    except Exception as e:
        print(f"Error {addr}: {e}")
    time.sleep(1)
