import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Get API key
api_key = os.getenv("OPENAI_API_KEY")

if api_key:
    print("API key found!")
else:
    print("API key not found. Check your .env file.")