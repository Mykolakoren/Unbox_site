import sys
import os

# Add the 'backend' directory to sys.path so 'import app' works
# (because internal code uses 'from app...' absolute imports)
# Add the 'backend' directory to sys.path so 'import app' works
# We use os.getcwd() because Vercel/Lambda root is typically reliable
sys.path.append(os.path.join(os.getcwd(), 'backend'))

from app.main import app

# Vercel needs a 'handler' or 'app' object exposed
# It automatically detects 'app' variable if it's a FastAPI instance
