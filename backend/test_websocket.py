import asyncio
import websockets
from urllib.parse import urlencode
import json
import os
from dotenv import load_dotenv

# Load API key from .env
load_dotenv()
api_key = os.getenv("OPENAI_API_KEY")

async def test_connection():
    try:
        # Build URL with query parameters
        params = {
            'model': 'gpt-4o-realtime-preview-2024-10-01'
        }
        base_url = "wss://api.openai.com/v1/realtime"
        url = f"{base_url}?{urlencode(params)}"
        
        print(f"Connecting to: {url}")
        
        # Basic websocket connection
        async with websockets.connect(
            url,
            origin="https://api.openai.com",
            additional_headers={
                "Authorization": f"Bearer {api_key}",
                "OpenAI-Beta": "realtime=v1"
            }
        ) as websocket:
            print("Connected!")
            
            # Send initial session configuration
            await websocket.send(json.dumps({
                "type": "session.update",
                "session": {
                    "modalities": ["text", "audio"],
                    "voice": "alloy",
                    "input_audio_transcription": {"model": "whisper-1"},
                    "turn_detection": {"type": "server_vad"}
                }
            }))
            
            print("Sent session configuration")
            
            # Wait for response
            response = await websocket.recv()
            print(f"Received: {response}")
            
            # Keep connection open for a moment
            await asyncio.sleep(2)
            
    except websockets.exceptions.ConnectionClosedError as e:
        print(f"Connection closed with error: {str(e)}")
        print(f"Error code: {e.code}")
        print(f"Error reason: {e.reason}")
    except Exception as e:
        print(f"Other error: {str(e)}")
        print(f"Error type: {type(e)}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")

if __name__ == "__main__":
    asyncio.run(test_connection())