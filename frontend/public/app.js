class AudioHandler {
    constructor() {
        this.socket = null;
        this.audioContext = null;
        this.microphoneStream = null;
        this.processor = null;
        this.analyser = null;
        this.isMuted = false;
        this.pingInterval = null;
        this.conversationActive = false;
        this.audioQueue = [];
        this.isPlaying = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 3;
        this.audioBuffers = [];  // For accumulating audio response chunks
    }

    static STATUS = {
        INITIAL: "Ready to start conversation",
        REQUESTING_MIC: "Requesting microphone access...",
        CONNECTING: "Connecting to AI assistant...",
        ACTIVE: "AI Assistant is listening",
        MUTED: "Microphone paused - Click to resume",
        ERROR: "Error connecting - Please try again",
        ENDED: "Conversation ended"
    }

    async setupMicrophone() {
        try {
            console.log("Requesting microphone permission...");
            this.updateStatus(AudioHandler.STATUS.REQUESTING_MIC);
            
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    sampleRate: 24000,
                    channelCount: 1,
                    sampleSize: 16,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });
            
            const audioTrack = stream.getAudioTracks()[0];
            const settings = audioTrack.getSettings();
            console.log('Microphone settings:', settings);
            
            this.audioContext = new AudioContext({
                sampleRate: 24000,
                latencyHint: 'interactive'
            });
            
            this.microphoneStream = stream;
            return stream;
        } catch (err) {
            console.error("Microphone setup error:", err);
            this.handleError(err);
            throw err;
        }
    }

    async connect() {
        const heartbeatInterval = setInterval(() => {
            if (this.socket?.readyState === WebSocket.OPEN) {
                console.debug('WebSocket connection health check: OK');
            } else {
                console.warn('WebSocket connection health check: Not connected');
            }
        }, 5000);

        try {
            console.log("Creating WebSocket connection...");
            this.socket = new WebSocket('ws://127.0.0.1:8000/ws/audio');

            // Connection timeout
            const connectionTimeout = setTimeout(() => {
                if (this.socket.readyState !== WebSocket.OPEN) {
                    console.error('WebSocket connection timeout');
                    this.updateStatus("Connection timeout - please try again");
                    this.socket.close();
                }
            }, 5000);

            // Keepalive ping
            this.pingInterval = setInterval(() => {
                if (this.socket?.readyState === WebSocket.OPEN) {
                    this.socket.send(JSON.stringify({ type: 'ping' }));
                }
            }, 15000); // Reduced from 30s to 15s for more reliable connection

            this.socket.onopen = () => {
                console.log('WebSocket connection established');
                clearTimeout(connectionTimeout);
                this.updateStatus(AudioHandler.STATUS.CONNECTING);
                this.reconnectAttempts = 0;
            };

            this.socket.onmessage = async (event) => {
                try {
                    if (event.data instanceof Blob) {
                        const arrayBuffer = await event.data.arrayBuffer();
                        await this.handleAudioResponse(arrayBuffer);
                    } else {
                        await this.handleTextMessage(event.data);
                    }
                } catch (error) {
                    console.error('Error handling message:', error);
                }
            };

            this.socket.onerror = (error) => {
                console.error('WebSocket Error:', error);
                this.handleError(error);
            };

            this.socket.onclose = () => {
                clearInterval(heartbeatInterval);
                this.socket.onclose = this.handleWebSocketClose.bind(this);
            };
            

            // Wait for connection
            await new Promise((resolve, reject) => {
                const checkConnection = () => {
                    if (this.socket.readyState === WebSocket.OPEN) {
                        resolve();
                    } else if (this.socket.readyState === WebSocket.CLOSED || 
                             this.socket.readyState === WebSocket.CLOSING) {
                        reject(new Error('WebSocket connection failed'));
                    } else {
                        setTimeout(checkConnection, 100);
                    }
                };
                checkConnection();
            });

        } catch (err) {
            console.error('Connection error:', err);
            this.handleError(err);
            throw err;
        }
    }

    async handleAudioResponse(arrayBuffer) {
        try {
            const audioData = new Int16Array(arrayBuffer);
            const audioBuffer = this.audioContext.createBuffer(1, audioData.length, 24000);
            const channelData = audioBuffer.getChannelData(0);
            
            // Convert Int16 to Float32
            for (let i = 0; i < audioData.length; i++) {
                channelData[i] = audioData[i] / 32768.0;
            }
            
            // Queue the audio for playing
            this.audioBuffers.push(audioBuffer);
            
            // Start playing if not already playing
            if (!this.isPlaying) {
                await this.playNextAudioBuffer();
            }
        } catch (error) {
            console.error('Error processing audio response:', error);
        }
    }

    async playNextAudioBuffer() {
        if (this.audioBuffers.length === 0) {
            this.isPlaying = false;
            return;
        }

        this.isPlaying = true;
        const audioBuffer = this.audioBuffers.shift();
        const source = this.audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(this.audioContext.destination);
        
        source.onended = () => {
            this.playNextAudioBuffer();
        };
        
        source.start(0);
    }

    async handleTextMessage(message) {
        try {
            const data = JSON.parse(message);
            console.log('Received message:', data);

            switch (data.type) {
                case 'connection_status':
                    this.updateStatus(data.status);
                    break;
                    
                case 'transcript':
                    this.updateTranscript(data.text);
                    break;
                    
                case 'error':
                    console.error('Server error:', data.message);
                    this.handleError(new Error(data.message));
                    break;
                    
                default:
                    console.log('Unknown message type:', data.type);
            }
        } catch (error) {
            console.error('Error parsing message:', error);
        }
    }

    handleWebSocketClose(event) {
        console.log('WebSocket connection closed', event.code, event.reason);
        clearInterval(this.pingInterval);
        
        if (event.wasClean) {
            console.log('Connection closed cleanly');
            this.updateStatus(AudioHandler.STATUS.ENDED);
        } else {
            console.error('Connection died');
            if (this.reconnectAttempts < this.maxReconnectAttempts && this.conversationActive) {
                this.reconnectAttempts++;
                console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
                setTimeout(() => this.connect(), 1000 * this.reconnectAttempts);
            } else {
                this.updateStatus("Connection lost - please try again");
            }
        }
    }

    async initializeAudio() {
        try {
            if (!this.microphoneStream) {
                throw new Error("No microphone stream available");
            }

            const sourceNode = this.audioContext.createMediaStreamSource(this.microphoneStream);
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 2048;
            sourceNode.connect(this.analyser);

            await this.audioContext.audioWorklet.addModule('./audioProcessor.js');
            
            this.processor = new AudioWorkletNode(this.audioContext, 'audio-processor', {
                numberOfInputs: 1,
                numberOfOutputs: 0,
                channelCount: 1,
                processorOptions: {
                    sampleRate: 24000
                }
            });

            this.processor.port.onmessage = (event) => {
                if (!this.isMuted && this.socket?.readyState === WebSocket.OPEN) {
                    const { audioData, sampleCount, durationMs } = event.data;
                    if (audioData && sampleCount > 0) {
                        this.socket.send(audioData);
                        this.updateVisualization();
                    }
                }
            };

            sourceNode.connect(this.processor);
            console.log("Audio processing initialized");
            
        } catch (err) {
            console.error("Audio initialization error:", err);
            throw err;
        }
    }

    async startConversation() {
        try {
            await this.setupMicrophone();
            
            if (!this.audioContext) {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                    sampleRate: 24000
                });
                await this.audioContext.resume();
            }
            
            this.updateStatus(AudioHandler.STATUS.CONNECTING);
            await this.connect();
            await this.initializeAudio();
            
            this.conversationActive = true;
            this.updateStatus(AudioHandler.STATUS.ACTIVE);
            
        } catch (err) {
            console.error("Error in startConversation:", err);
            this.handleError(err);
            throw err;
        }
    }

    updateVisualization() {
        if (!this.analyser) return;
        
        const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
        this.analyser.getByteFrequencyData(dataArray);
        
        const average = dataArray.reduce((acc, val) => acc + val, 0) / dataArray.length;
        const normalizedLevel = average / 256;
        
        const indicator = document.querySelector('.voice-indicator');
        if (indicator) {
            const scale = 1 + (normalizedLevel * 0.3);
            indicator.style.transform = `scale(${scale})`;
            indicator.style.opacity = this.isMuted ? '0.4' : '0.8';
        }
    }

    toggleMute() {
        this.isMuted = !this.isMuted;
        const micButton = document.getElementById('micButton');
        
        if (this.isMuted) {
            this.updateStatus(AudioHandler.STATUS.MUTED);
            micButton.classList.add('muted');
        } else {
            this.updateStatus(AudioHandler.STATUS.ACTIVE);
            micButton.classList.remove('muted');
        }
    }

    endConversation() {
        this.conversationActive = false;
        
        if (this.microphoneStream) {
            this.microphoneStream.getTracks().forEach(track => track.stop());
        }
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.close();
        }
        if (this.audioContext) {
            this.audioContext.close();
        }
        
        clearInterval(this.pingInterval);
        
        this.microphoneStream = null;
        this.processor = null;
        this.analyser = null;
        this.audioBuffers = [];
        this.isPlaying = false;
        
        this.updateStatus(AudioHandler.STATUS.ENDED);
    }

    updateStatus(status) {
        const statusElement = document.getElementById('status');
        if (statusElement) {
            statusElement.textContent = status;
        }
    }

    updateTranscript(text) {
        const transcriptElement = document.getElementById('transcript');
        if (transcriptElement) {
            const timestamp = new Date().toLocaleTimeString();
            const formattedMessage = `[${timestamp}] ${text}`;
            
            if (transcriptElement.textContent) {
                transcriptElement.textContent += "\n\n" + formattedMessage;
            } else {
                transcriptElement.textContent = formattedMessage;
            }

            transcriptElement.classList.add('has-content');
            transcriptElement.scrollTop = transcriptElement.scrollHeight;
        }
    }

    handleError(error) {
        console.error('Error:', error);
        let message = AudioHandler.STATUS.ERROR;
        
        if (error.name === 'NotAllowedError') {
            message = "Please allow microphone access to continue";
        } else if (error instanceof Error) {
            message = `Error: ${error.message}`;
        }
        
        this.updateStatus(message);
    }
}

// Event Listeners Setup
document.addEventListener('DOMContentLoaded', () => {
    const audioHandler = new AudioHandler();
    const heroSection = document.getElementById('heroSection');
    const chatInterface = document.getElementById('chatInterface');
    const startButton = document.getElementById('recordButton');
    const micButton = document.getElementById('micButton');
    const endButton = document.getElementById('endButton');

    startButton.addEventListener('click', async () => {
        try {
            // Transition UI first
            heroSection.classList.add('compact');
            setTimeout(() => {
                chatInterface.classList.remove('hidden');
                chatInterface.classList.add('visible');
            }, 500);

            // Start conversation flow
            await audioHandler.startConversation();
            
        } catch (err) {
            console.error("Failed to start conversation:", err);
            // Revert UI if there's an error
            chatInterface.classList.remove('visible');
            setTimeout(() => {
                heroSection.classList.remove('compact');
                chatInterface.classList.add('hidden');
            }, 500);
        }
    });

    micButton.addEventListener('click', () => {
        if (audioHandler.conversationActive) {
            audioHandler.toggleMute();
        }
    });

    endButton.addEventListener('click', async () => {
        await audioHandler.endConversation();
        chatInterface.classList.remove('visible');
        setTimeout(() => {
            heroSection.classList.remove('compact');
            chatInterface.classList.add('hidden');
        }, 500);
    });
});