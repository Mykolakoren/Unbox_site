import sys
import logging
from sqlmodel import Session, select, create_engine
from app.models.user import User
# from app.api.v1.auth import get_password_hash

# Configure logging to capture everything
logging.basicConfig(level=logging.DEBUG)

sqlite_file_name = "database.db"
sqlite_url = f"sqlite:///{sqlite_file_name}"
engine = create_engine(sqlite_url)

def test_fetch():
    print("Starting reproduction test...")
    with Session(engine) as session:
        # 1. Fetch any user
        user = session.exec(select(User)).first()
        if not user:
            print("No users found to test.")
            return

        print(f"Found user ID: {user.id}")
        user_id_str = str(user.id)
        
        print(f"Testing session.get with string '{user_id_str}'...")
        user_by_get = session.get(User, user_id_str)
        if not user_by_get:
            # Try with UUID object
            print("session.get with string failed (returned None). Trying UUID object...")
            import uuid
            user_by_get = session.get(User, uuid.UUID(user_id_str))
            
        print(f"User retrieved: {user_by_get}")

        from app.models.user import UserRead
        # 2. Try to access JSON fields to trigger deserialization
        try:
            print(f"Admin Tasks: {user.admin_tasks}")
            print(f"Comment History: {user.comment_history}")
            print(f"Subscription: {user.subscription}")
            
            # 3. Validate response model
            print("Validating UserRead...")
            user_read = UserRead.model_validate(user)
            print(f"UserRead: {user_read}")
            
            print("Successfully accessed fields.")
        except Exception as e:
            print(f"CRASHED accessing fields: {e}")
            import traceback
            traceback.print_exc()

if __name__ == "__main__":
    test_fetch()
