"""Create bonuses table."""
import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "unbox.db")

def migrate():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    cur.execute("""
        CREATE TABLE IF NOT EXISTS bonuses (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            type TEXT NOT NULL DEFAULT 'free_hour',
            description TEXT DEFAULT '',
            quantity REAL DEFAULT 1.0,
            status TEXT DEFAULT 'pending',
            granted_by_id TEXT DEFAULT '',
            granted_by_name TEXT DEFAULT '',
            approved_by_id TEXT,
            approved_by_name TEXT,
            reject_reason TEXT,
            expires_at TIMESTAMP,
            used_at TIMESTAMP,
            is_bulk BOOLEAN DEFAULT 0,
            bulk_id TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    cur.execute("CREATE INDEX IF NOT EXISTS ix_bonuses_user_id ON bonuses(user_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS ix_bonuses_status ON bonuses(status)")
    cur.execute("CREATE INDEX IF NOT EXISTS ix_bonuses_bulk_id ON bonuses(bulk_id)")

    conn.commit()
    conn.close()
    print("✅ Bonuses table created successfully")


if __name__ == "__main__":
    migrate()
