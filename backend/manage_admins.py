
import sys
import argparse
from sqlmodel import Session, select, create_engine
from app.models.user import User

# Adjust this connection string if needed
sqlite_file_name = "database.db"
sqlite_url = f"sqlite:///{sqlite_file_name}"

engine = create_engine(sqlite_url)

def manage_admin(email: str, role: str):
    with Session(engine) as session:
        user = session.exec(select(User).where(User.email == email)).first()
        if not user:
            print(f"Error: User with email '{email}' not found.")
            return

        print(f"Found user: {user.name} ({user.email})")
        print(f"Current Role: {user.role}, Is Admin: {user.is_admin}")

        # Update fields
        user.role = role
        user.is_admin = True 
        
        session.add(user)
        session.commit()
        session.refresh(user)
        
        print(f"Success! User promoted to '{role}' and is_admin=True.")
        print(f"New state -> Role: {user.role}, Is Admin: {user.is_admin}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Manage Admin Users")
    parser.add_argument("email", help="Email of the user to promote")
    parser.add_argument("role", nargs="?", default="admin", help="Role to assign (admin, owner). Default: admin")
    
    args = parser.parse_args()
    
    # Simple validation
    valid_roles = ["owner", "senior_admin", "admin", "user"]
    if args.role not in valid_roles:
        print(f"Warning: Unknown role '{args.role}'. Standard roles are: {', '.join(valid_roles)}")

    manage_admin(args.email, args.role)
