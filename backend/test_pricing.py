import requests
from datetime import datetime, timedelta

API_URL = "http://127.0.0.1:8000/api/v1"

import time

def test_pricing():
    # Generate unique user
    ts = int(time.time())
    email = f"test_pricing_{ts}@example.com"
    password = "testpassword123"
    
    login_data = {
        "username": email,
        "password": password
    }
    
    # Register new user first
    print(f"Registering new user: {email}...")
    reg_data = {
        "email": email,
        "password": password,
        "name": "Test Pricing User",
        "phone": "+1234567890"
    }
    
    try:
        reg_resp = requests.post(f"{API_URL}/auth/register", json=reg_data, timeout=5)
        if reg_resp.status_code not in [200, 201]:
             print(f"Registration failed: {reg_resp.text}")
             if "already exists" in reg_resp.text:
                 # If somehow exists, try login? No, unique email handles this.
                 pass
             else:
                 return

        # Login
        resp = requests.post(f"{API_URL}/auth/login", data=login_data)
        if resp.status_code != 200:
            print(f"Login failed: {resp.text}")
            return
            
        token = resp.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        
        print("\n--- Testing Standard Price ---")
        # Standard booking in 24 hours (No Hot Deal)
        start_time = (datetime.utcnow() + timedelta(hours=24)).isoformat()
        
        payload = {
            "resource_id": "unbox_one_room_1", # Ensure this resource exists!
            "start_time": start_time,
            "duration_minutes": 60,
            "format_type": "individual"
        }
        
        r = requests.post(f"{API_URL}/pricing/quote", json=payload, headers=headers)
        if r.status_code == 200:
            print("Standard Quote:", r.json())
        else:
            print("Error:", r.text)

        print("\n--- Testing Hot Booking (<12h) ---")
        # Hot booking in 2 hours
        start_time_hot = (datetime.utcnow() + timedelta(hours=2)).isoformat()
        payload["start_time"] = start_time_hot
        
        r = requests.post(f"{API_URL}/pricing/quote", json=payload, headers=headers)
        if r.status_code == 200:
            print("Hot Quote:", r.json())
        else:
            print("Error:", r.text)

        print("\n--- Testing Consecutive Discount (3 hours) ---")
        # 3 hours, >12h ahead (to avoid hot deal)
        start_time_consecutive = (datetime.utcnow() + timedelta(hours=48)).isoformat()
        payload["start_time"] = start_time_consecutive
        payload["duration_minutes"] = 180 # 3 hours
        
        r = requests.post(f"{API_URL}/pricing/quote", json=payload, headers=headers)
        if r.status_code == 200:
            data = r.json()
            print("Consecutive Quote (3h):", data)
            if data['final_price'] == 51.0:
                 print("SUCCESS: 3h booking price is 51.0 (Discount applied)")
            else:
                 print(f"FAILURE: 3h booking price is {data['final_price']} (Expected 51.0)")
        else:
            print("Error:", r.text)
            
    except Exception as e:
        print(f"Test failed: {e}")

if __name__ == "__main__":
    test_pricing()
