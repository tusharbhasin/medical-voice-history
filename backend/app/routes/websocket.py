import os
import json
import base64
import asyncio
import sounddevice as sd
import wave
import numpy as np
import websockets
from dotenv import load_dotenv

# Load OpenAI API key
load_dotenv()
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

# Configuration
SAMPLE_RATE = 24000  # 24kHz for OpenAI
CHUNK_DURATION = 0.2  # 200ms per chunk
CHUNK_SIZE = int(SAMPLE_RATE * CHUNK_DURATION)
OUTPUT_FILE = "response.wav"

def save_audio(audio_data, filename):
    """Save PCM audio data to a WAV file."""
    try:
        with wave.open(filename, 'wb') as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)  # 16-bit PCM
            wf.setframerate(SAMPLE_RATE)
            wf.writeframes(audio_data)
        print(f"✅ Audio saved to: {filename}")
    except Exception as e:
        print(f"❌ Failed to save audio: {e}")

async def main():
    print("🔄 Connecting to OpenAI WebSocket...")

    try:
        # Connect to OpenAI WebSocket
        async with websockets.connect(
            "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01",
            additional_headers={
                "Authorization": f"Bearer {OPENAI_API_KEY}",
                "OpenAI-Beta": "realtime=v1"
            }
        ) as ws:
            print("✅ Successfully connected to OpenAI WebSocket")

            # Configure the session for audio responses
            await ws.send(json.dumps({
                "type": "session.update",
                "session": {
                    "modalities": ["audio"],
                    "voice": "alloy",
                    "input_audio_format": "pcm16",
                    "output_audio_format": "pcm16"
                }
            }))
            response = await ws.recv()
            print(f"🛠️ Session configuration response: {response}")

            print("🎤 Start speaking... (Ctrl+C to stop)")

            # Send and receive tasks
            audio_chunks = []
            stop_event = asyncio.Event()

            async def send_audio():
                """Stream user audio to OpenAI."""
                try:
                    with sd.InputStream(samplerate=SAMPLE_RATE, channels=1, dtype="int16") as stream:
                        while not stop_event.is_set():
                            audio_data, _ = stream.read(CHUNK_SIZE)
                            audio_bytes = audio_data.tobytes()
                            await ws.send(json.dumps({
                                "type": "conversation.audio",
                                "audio": base64.b64encode(audio_bytes).decode("utf-8")
                            }))
                except asyncio.CancelledError:
                    pass  # Graceful exit when stopping

            async def receive_audio():
                """Process AI audio responses."""
                try:
                    while not stop_event.is_set():
                        message = await ws.recv()
                        data = json.loads(message)

                        if data.get("type") == "response.audio.delta":
                            audio_chunk = base64.b64decode(data["delta"])
                            audio_chunks.append(audio_chunk)
                            sd.play(np.frombuffer(audio_chunk, dtype="int16"), samplerate=SAMPLE_RATE)

                        elif data.get("type") == "response.audio.done":
                            print("🔊 AI audio response complete!")
                            if audio_chunks:
                                complete_audio = b''.join(audio_chunks)
                                save_audio(complete_audio, OUTPUT_FILE)
                                audio_chunks.clear()
                except asyncio.CancelledError:
                    pass  # Graceful cleanup

            # Run tasks and handle interruptions
            send_task = asyncio.create_task(send_audio())
            receive_task = asyncio.create_task(receive_audio())

            try:
                await asyncio.gather(send_task, receive_task)
            except KeyboardInterrupt:
                print("\n👋 Gracefully stopping...")
                stop_event.set()
                await asyncio.gather(send_task, receive_task, return_exceptions=True)

    except Exception as e:
        print(f"❌ Connection error: {e}")

if __name__ == "__main__":
    asyncio.run(main())
