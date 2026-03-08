import urllib.request
import urllib.parse
import json
import ssl

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

addr = "Paliashvili 4, Batumi, Georgia"
url = "https://nominatim.openstreetmap.org/search?format=json&q=" + urllib.parse.quote(addr)
req = urllib.request.Request(url, headers={'User-Agent': 'UnboxApp/1.0'})

try:
    with urllib.request.urlopen(req, context=ctx) as response:
        data = json.loads(response.read().decode())
        if data:
            print(f"{addr}: {data[0]['lat']}, {data[0]['lon']}")
        else:
            print(f"{addr}: Not found")
except Exception as e:
    print(f"Error {addr}: {e}")
