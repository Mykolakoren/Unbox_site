import sys
import os
from sqlalchemy import create_engine, text

from dotenv import load_dotenv
load_dotenv()

engine = create_engine(os.getenv("DATABASE_URL"))
with engine.connect() as conn:
    res = conn.execute(text("SELECT id, email, name FROM \"user\"")).fetchall()
    print("Users in DB:")
    for r in res:
        print(r)
