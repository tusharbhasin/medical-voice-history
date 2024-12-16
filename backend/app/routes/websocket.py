import os
import json
import asyncio
import websockets
from fastapi import APIRouter, WebSocket
from fastapi.websockets import WebSocketDisconnect
from dotenv import load_dotenv
from urllib.parse import urlencode
import base64
import logging
import logging.handlers
from typing import Optional, Dict, Any
import time
import backoff  

# Load environment variables and setup logging
load_dotenv()
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Enhanced logging setup
def setup_logging():
    logger = logging.getLogger(__name__)
    logger.setLevel(logging.DEBUG)
    
    # Console handler
    console_handler = logging.StreamHandler()
    console_handler.setLevel(logging.DEBUG)
    formatter = logging.Formatter('%(asctime)s - %(levelname)s - [%(filename)s:%(lineno)d] - %(message)s')
    console_handler.setFormatter(formatter)
    
    # File handler
    file_handler = logging.handlers.RotatingFileHandler(
        'openai_ws.log', 
        maxBytes=10485760,  # 10MB
        backupCount=5
    )
    file_handler.setLevel(logging.DEBUG)
    file_handler.setFormatter(formatter)
    
    logger.addHandler(console_handler)
    logger.addHandler(file_handler)
    return logger

logger = setup_logging()

class OpenAIWebSocket:
    def __init__(self):
        self.ws: Optional[websockets.WebSocketClientProtocol] = None
        self.is_connected = False
        self.buffer = bytearray()
        self.sample_rate = 24000
        self.min_buffer_duration_ms = 100  # OpenAI requires minimum 100ms
        self.min_buffer_size = int(self.sample_rate * self.min_buffer_duration_ms / 1000) * 2  # *2 for 16-bit samples
        self.last_audio_time = 0
        self.audio_queue = []
        self.conversation_started = False

    @backoff.on_exception(
        backoff.expo,
        (websockets.exceptions.WebSocketException, ConnectionError),
        max_tries=3,
        max_time=30
    )

    async def connect_to_openai(self):
        try:
            params = {
                'model': 'gpt-4o-realtime-preview-2024-10-01'
            }
            base_url = "wss://api.openai.com/v1/realtime"
            url = f"{base_url}?{urlencode(params)}"
            
            logger.info(f"Attempting OpenAI connection to: {url}")
            logger.debug("Connecting with headers: Authorization: Bearer <truncated>, OpenAI-Beta: realtime=v1")
            
            self.ws = await websockets.connect(
                url,
                ping_interval=15,  # More frequent ping to maintain connection
                ping_timeout=10,
                additional_headers={
                    "Authorization": f"Bearer {OPENAI_API_KEY}",
                    "OpenAI-Beta": "realtime=v1"
                }
            )

            logger.info("WebSocket connection established, sending session config")
            
            # Initial session configuration
            session_config = {
                "type": "session.update",
                "session": {
                    "modalities": ["audio", "text"],
                    "voice": "alloy",
                    "input_audio_format": "pcm16",
                    "output_audio_format": "pcm16",
                    "input_audio_transcription": {"model": "whisper-1"},
                    "turn_detection": {
                        "type": "server_vad",
                        "threshold": 0.5,
                        "prefix_padding_ms": 300,
                        "silence_duration_ms": 500,
                        "create_response": True
                    },
                    "instructions": "You are a helpful medical assistant. Answer the user's questions in English or Hindi. Keep responses concise and clear. Respond in the same language as the user's query."
                }
            }
            
            await self.ws.send(json.dumps(session_config))
            logger.debug("Session config sent, awaiting response")

            # Wait for session creation response
            response = await self.ws.recv()
            response_data = json.loads(response)

            logger.debug(f"Received session response: {response_data}")
            
            if response_data.get("type") == "session.created":
                logger.info("OpenAI session successfully initialized")
                self.is_connected = True
                self.last_audio_time = time.time()
                return True
            else:
                logger.error(f"Unexpected session response: {response_data}")
                return False
            
        except websockets.exceptions.WebSocketException as e:
            logger.error(f"WebSocket connection error: {str(e)}")
            raise
        except Exception as e:
            logger.error(f"OpenAI connection error: {str(e)}")
            return False

    async def handle_audio_stream(self, audio_data: bytes, client_ws: WebSocket) -> None:
        try:
            if not self.is_connected:
                logger.error("Attempted to handle audio stream without OpenAI connection")
                raise ConnectionError("Not connected to OpenAI")

            current_time = time.time()
            buffer_size = len(audio_data)
            duration_ms = (buffer_size / 2) / self.sample_rate * 1000  # /2 because 16-bit samples

            logger.debug(f"Received audio chunk: {buffer_size} bytes ({duration_ms:.2f}ms)")
            
            # Add to buffer
            self.buffer.extend(audio_data)
            total_buffer_size = len(self.buffer)
            total_duration_ms = (total_buffer_size / 2) / self.sample_rate * 1000

            logger.debug(f"Total buffer: {total_buffer_size} bytes ({total_duration_ms:.2f}ms)")

            if total_duration_ms >= self.min_buffer_duration_ms:
                try:
                    logger.debug(f"Sending buffer of {total_duration_ms:.2f}ms to OpenAI")
                    # Send audio buffer
                    audio_base64 = base64.b64encode(bytes(self.buffer)).decode('utf-8')
                    await self.ws.send(json.dumps({
                        "type": "input_audio_buffer.append",
                        "audio": audio_base64
                    }))

                    # Send commit message
                    await self.ws.send(json.dumps({
                        "type": "input_audio_buffer.commit"
                    }))

                    logger.debug(f"Sent audio buffer: {total_duration_ms:.2f}ms")
                    self.buffer = bytearray()
                    self.last_audio_time = current_time

                    # Process OpenAI responses
                    async for response in self.process_openai_responses():
                        if response:
                            if isinstance(response, bytes):
                                await client_ws.send_bytes(response)
                            else:
                                await client_ws.send_text(json.dumps(response))

                except Exception as e:
                    logger.error(f"Error sending audio to OpenAI: {str(e)}")
                    raise

        except Exception as e:
            logger.error(f"Error in handle_audio_stream: {str(e)}")
            raise

    async def process_openai_responses(self):
        try:
            while True:
                response = await self.ws.recv()
                
                if isinstance(response, str):
                    try:
                        response_data = json.loads(response)
                        response_type = response_data.get("type")
                        
                        logger.debug(f"Processing response type: {response_type}")
                        
                        if response_type == "error":
                            error_msg = response_data.get("error", {}).get("message", "Unknown error")
                            logger.error(f"OpenAI error: {error_msg}")
                            yield {"type": "error", "message": error_msg}
                            break

                        elif response_type == "response.audio.delta":
                            if 'delta' in response_data:
                                try:
                                    audio_bytes = base64.b64decode(response_data['delta'])
                                    yield audio_bytes
                                except Exception as e:
                                    logger.error(f"Error decoding audio delta: {e}")
                                    continue

                        elif response_type == "input_audio_buffer.speech_started":
                            logger.info("Speech detected")
                            continue

                        elif response_type == "input_audio_buffer.speech_stopped":
                            logger.info("Speech ended")
                            continue

                        elif response_type == "response.audio.done":
                            logger.debug("Audio response complete")
                            break

                        else:
                            # Pass through other message types
                            yield response_data

                    except json.JSONDecodeError:
                        logger.error("Failed to decode JSON response")
                        continue
                        
                elif isinstance(response, bytes):
                    yield response

        except websockets.exceptions.ConnectionClosed:
            logger.error("OpenAI WebSocket connection closed")
            raise
        except Exception as e:
            logger.error(f"Error processing OpenAI responses: {str(e)}")
            raise

    async def close(self):
        if self.ws:
            try:
                if self.buffer:
                    # Send any remaining audio data
                    audio_base64 = base64.b64encode(bytes(self.buffer)).decode('utf-8')
                    await self.ws.send(json.dumps({
                        "type": "input_audio_buffer.append",
                        "audio": audio_base64
                    }))
                    await self.ws.send(json.dumps({
                        "type": "input_audio_buffer.commit"
                    }))
            except Exception as e:
                logger.error(f"Error during cleanup: {str(e)}")
            finally:
                await self.ws.close()
                self.is_connected = False
                self.buffer = bytearray()

router = APIRouter()

@router.websocket("/ws/audio")
async def audio_websocket_endpoint(websocket: WebSocket):
    openai_ws = None
    connection_attempts = 0
    max_attempts = 3

    
    try:
        await websocket.accept()
        logger.info("Client WebSocket connection accepted")

        # Send initial connection status
        await websocket.send_text(json.dumps({
            "type": "connection_status",
            "status": "websocket_connected"
        }))

        # Initialize OpenAI WebSocket
        openai_ws = OpenAIWebSocket()
        while connection_attempts < max_attempts:
            try:
                success = await openai_ws.connect_to_openai()
                if success:
                    break
                connection_attempts += 1
                if connection_attempts < max_attempts:
                    logger.info(f"Retrying OpenAI connection (attempt {connection_attempts + 1}/{max_attempts})")
                    await asyncio.sleep(2 * connection_attempts)  # Exponential backoff
            except Exception as e:
                logger.error(f"Connection attempt {connection_attempts + 1} failed: {str(e)}")
                if connection_attempts >= max_attempts:
                    raise

        if not success:
            raise Exception("Failed to connect to OpenAI after multiple attempts")


        success = await openai_ws.connect_to_openai()

        if not success:
            raise Exception("Failed to connect to OpenAI")

        # Send ready status
        await websocket.send_text(json.dumps({
            "type": "connection_status",
            "status": "ready"
        }))

        while True:
            try:
                data = await websocket.receive()
                
                if "bytes" in data:
                    audio_data = data["bytes"]
                    if len(audio_data) == 0:
                        continue

                    await openai_ws.handle_audio_stream(audio_data, websocket)
                    
                elif "text" in data:
                    message = json.loads(data["text"])
                    if message.get("type") == "ping":
                        await websocket.send_text(json.dumps({"type": "pong"}))

            except WebSocketDisconnect:
                logger.info("Client disconnected")
                break
            except Exception as e:
                logger.error(f"Error in processing loop: {str(e)}")
                await websocket.send_text(json.dumps({
                    "type": "error",
                    "message": str(e)
                }))
                break

    except WebSocketDisconnect:
        logger.info("Client disconnected during setup")
    except Exception as e:
        logger.error(f"Setup error: {str(e)}")
        try:
            await websocket.send_text(json.dumps({
                "type": "error",
                "message": str(e)
            }))
        except:
            pass
    finally:
        if openai_ws:
            await openai_ws.close()