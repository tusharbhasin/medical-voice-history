#main.py file
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routes import websocket

app = FastAPI()

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include our WebSocket router
app.include_router(websocket.router)

@app.get("/")
async def root():
    return {"status": "online", "service": "Medical History Voice Collection API"}