import sys
import os

# Add the project root to sys.path so we can import from 'backend'
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))

from backend.app.main import app

# Vercel needs a 'handler' or 'app' object exposed
# It automatically detects 'app' variable if it's a FastAPI instance
