from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import os

# Load environment variables
load_dotenv()
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

app = FastAPI()

# CORS setup for frontend communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Update this with your frontend URL in production
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/token")
def get_openai_token():
    """
    Provide a secure token for the frontend.
    """
    return {"token": OPENAI_API_KEY}
