import sqlite3
import os
import sys

# Try to import psycopg2
try:
    import psycopg2
except ImportError:
    psycopg2 = None

BACKEND_ENV_PATH = "backend/.env"

def get_database_url():
    """Read DATABASE_URL from .env file"""
    if not os.path.exists(BACKEND_ENV_PATH):
        print(f".env not found at {BACKEND_ENV_PATH}")
        return None
    
    with open(BACKEND_ENV_PATH, "r") as f:
        for line in f:
            if line.strip().startswith("DATABASE_URL="):
                # Remove quotes if present
                url = line.strip().split("=", 1)[1]
                url = url.strip().strip("'").strip('"')
                return url
    return None

def fix_postgres(db_url):
    print("Detected PostgreSQL URL.", flush=True)
    if not psycopg2:
        print("Error: psycopg2 module not found. Please install it with 'pip install psycopg2-binary'", flush=True)
        return

    # Add sslmode=require if not present (Neon requires it)
    if "sslmode" not in db_url:
        if "?" in db_url:
            db_url += "&sslmode=require"
        else:
            db_url += "?sslmode=require"

    try:
        print(f"Connecting to DB...", flush=True)
        conn = psycopg2.connect(db_url)
        cursor = conn.cursor()
        print("Connected.", flush=True)
        
        # Check booking table columns
        cursor.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'booking';")
        columns = [row[0] for row in cursor.fetchall()]
        
        if 'user_uuid' not in columns:
            print("Adding missing column 'user_uuid' to 'booking' table (Postgres)...")
            # UUID in Postgres is typically UUID type or VARCHAR/CHAR(36)
            # SQLModel uses UUID type by default in Postgres if using correct dialect, but let's be safe.
            # If using SQLModel/SQLAlchemy, it maps to UUID type.
            # Let's try UUID type first.
            try:
                cursor.execute("ALTER TABLE booking ADD COLUMN user_uuid UUID;")
                conn.commit()
                print("Column 'user_uuid' added successfully.")
            except Exception as e:
                print(f"Failed to add UUID column, trying VARCHAR: {e}")
                conn.rollback()
                cursor.execute("ALTER TABLE booking ADD COLUMN user_uuid VARCHAR(36);")
                conn.commit()
                print("Column 'user_uuid' added as VARCHAR.")
        else:
            print("Column 'user_uuid' already exists.")

        # Check User table credit_limit
        cursor.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'user';") # 'user' is reserved/sometimes tricky, but SQLModel uses lower case class name usually.
        # Note: Postgres table names might be quoted or capitalized depending on creation. 
        # SQLModel defaults to lowercase snake_case.
        # But `user` is reserved in Postgres! Usually it's quoted "user".
        # Let's try to detect table name.
        cursor.execute("SELECT table_name FROM information_schema.tables WHERE table_name = 'user' OR table_name = 'User';")
        tables = cursor.fetchall()
        table_name = tables[0][0] if tables else 'user'
        
        cursor.execute(f"SELECT column_name FROM information_schema.columns WHERE table_name = '{table_name}';")
        user_columns = [row[0] for row in cursor.fetchall()]

        if 'credit_limit' not in user_columns:
             print(f"Adding missing column 'credit_limit' to '{table_name}' table...")
             cursor.execute(f'ALTER TABLE "{table_name}" ADD COLUMN credit_limit FLOAT DEFAULT 0.0;')
             conn.commit()
             print("Column 'credit_limit' added successfully.")
        else:
             print("Column 'credit_limit' already exists.")

        cursor.close()
        conn.close()

    except Exception as e:
        print(f"Postgres Error: {e}")

def fix_sqlite(db_path="backend/database.db"):
    print(f"Using SQLite at {db_path}")
    if not os.path.exists(db_path):
        print(f"Database not found at {db_path}")
        return

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    try:
        # Check columns in booking table
        cursor.execute("PRAGMA table_info(booking)")
        columns = [info[1] for info in cursor.fetchall()]
        
        if not columns:
             print("Table 'booking' not found in SQLite.")
             return

        if 'user_uuid' not in columns:
            print("Adding missing column 'user_uuid' to 'booking' table...")
            cursor.execute("ALTER TABLE booking ADD COLUMN user_uuid VARCHAR(36)")
            conn.commit()
            print("Column 'user_uuid' added successfully.")
        else:
            print("Column 'user_uuid' already exists.")
            
        # Check User table
        cursor.execute("PRAGMA table_info(user)")
        user_columns = [info[1] for info in cursor.fetchall()]
        
        if 'credit_limit' not in user_columns:
             print("Adding missing column 'credit_limit' to 'user' table...")
             cursor.execute("ALTER TABLE user ADD COLUMN credit_limit FLOAT DEFAULT 0.0")
             conn.commit()
             print("Column 'credit_limit' added successfully.")
        else:
             print("Column 'credit_limit' already exists.")

    except Exception as e:
        print(f"SQLite Error: {e}")
    finally:
        conn.close()

if __name__ == "__main__":
    db_url = get_database_url()
    if db_url and "postgres" in db_url:
        fix_postgres(db_url)
    else:
        # Fallback to sqlite if no url or not postgres
        fix_sqlite()
