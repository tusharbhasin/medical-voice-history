import os
import json
import asyncio
import websockets
from fastapi import APIRouter, WebSocket
from fastapi.websockets import WebSocketDisconnect
from dotenv import load_dotenv
from urllib.parse import urlencode
import base64

load_dotenv()
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

class OpenAIWebSocket:
    def __init__(self):
        self.ws = None
        self.client_ws = None

    async def connect_to_openai(self):
        try:
            # Build URL with query parameters
            params = {
                'model': 'gpt-4o-realtime-preview-2024-10-01'
            }
            base_url = "wss://api.openai.com/v1/realtime"
            url = f"{base_url}?{urlencode(params)}"
            
            print(f"Connecting to OpenAI: {url}")
            
            self.ws = await websockets.connect(
                url,
                origin="https://api.openai.com",
                additional_headers={
                    "Authorization": f"Bearer {OPENAI_API_KEY}",
                    "OpenAI-Beta": "realtime=v1"
                }
            )
            
            # Initialize session
            await self.ws.send(json.dumps({
                "type": "session.update",
                "session": {
                    "modalities": ["text", "audio"],
                    "voice": "alloy",
                    "input_audio_transcription": {"model": "whisper-1"},
                    "turn_detection": {"type": "server_vad"}
                }
            }))
            
            # Get session response
            response = await self.ws.recv()
            print(f"Session initialized: {response}")
            return True
            
        except Exception as e:
            print(f"OpenAI connection error: {str(e)}")
            return False
        
    async def handle_audio_stream(self, audio_data):
        try:
            # Send audio data
            await self.ws.send(json.dumps({
                "type": "input_audio_buffer.append",
                "audio": base64.b64encode(audio_data).decode('utf-8')
            }))
            
            # Get response from OpenAI
            response = await self.ws.recv()
            return response
        
        except Exception as e:
            print(f"Error handling audio stream: {str(e)}")
            return None

    async def close(self):
        if self.ws:
            await self.ws.close()

router = APIRouter()

@router.websocket("/ws/audio")
async def audio_websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    print("Audio WebSocket connection accepted")
    
    openai_ws = OpenAIWebSocket()
    try:
        success = await openai_ws.connect_to_openai()
        if success:
            while True:
                # Receive audio data from client
                audio_data = await websocket.receive_bytes()
                
                # Process through OpenAI
                response = await openai_ws.handle_audio_stream(audio_data)
                
                if response:
                    response_data = json.loads(response)
                    # Handle different types of responses
                    if response_data.get("type") == "response.output.audio":
                        audio_bytes = base64.b64decode(response_data["audio"])
                        await websocket.send_bytes(audio_bytes)
                    elif response_data.get("type") == "response.output.text":
                        await websocket.send_text(json.dumps({
                            "type": "transcript",
                            "text": response_data["text"]
                        }))
    except WebSocketDisconnect:
        print("Client disconnected")
    finally:
        await openai_ws.close()
        

@router.websocket("/ws/test")
async def test_websocket_endpoint(websocket: WebSocket):
    print("Test endpoint: New connection request")
    await websocket.accept()
    print("Test endpoint: Connection accepted")

    openai_ws = OpenAIWebSocket()
    try:
        success = await openai_ws.connect_to_openai()
        
        if success:
            await websocket.send_text(json.dumps({
                "status": "connected",
                "message": "Connected to OpenAI successfully"
            }))

            while True:
                # Handle messages from the client
                data = await websocket.receive_text()
                print(f"Received from client: {data}")
                
                # Send to OpenAI and get response
                await openai_ws.ws.send(data)
                response = await openai_ws.ws.recv()
                
                # Send response back to client
                await websocket.send_text(response)

        else:
            await websocket.send_text(json.dumps({
                "status": "error",
                "message": "Failed to connect to OpenAI"
            }))

    except WebSocketDisconnect:
        print("Client disconnected")
    except Exception as e:
        print(f"Error in websocket endpoint: {str(e)}")
        await websocket.send_text(json.dumps({
            "status": "error",
            "message": str(e)
        }))
    finally:
        await openai_ws.close()