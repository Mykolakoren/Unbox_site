import sys
import os

# Add the 'backend' directory to sys.path so 'import app' works
# (because internal code uses 'from app...' absolute imports)
# Add the 'backend' directory to sys.path so 'import app' works
# We use os.getcwd() because Vercel/Lambda root is typically reliable
sys.path.append(os.path.join(os.getcwd(), 'backend'))

try:
    from app.main import app
    print("Successfully imported app.main")
except Exception as e:
    import traceback
    print("CRITICAL ERROR IMPORTING APP:")
    print(f"Current Directory: {os.getcwd()}")
    print(f"Directory Contents: {os.listdir(os.getcwd())}")
    if os.path.exists(os.path.join(os.getcwd(), 'backend')):
         print(f"Backend Directory Contents: {os.listdir(os.path.join(os.getcwd(), 'backend'))}")
    print(f"Sys Path: {sys.path}")
    print(traceback.format_exc())
    raise e

# Vercel needs a 'handler' or 'app' object exposed
# It automatically detects 'app' variable if it's a FastAPI instance
