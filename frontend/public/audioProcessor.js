class AudioProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        // Core audio configuration
        this.sampleRate = 24000;
        this.minBufferSize = this.sampleRate * 0.1;  // 100ms minimum buffer
        this.maxBufferSize = this.sampleRate * 0.5;  // 500ms maximum
        
        // Initialize buffer and state
        this.buffer = new Float32Array();
        this.isProcessing = false;
        this.silenceThreshold = 0.01;
        this.silenceCounter = 0;
        this.maxSilenceFrames = 1000;
        
        console.debug("AudioProcessor initialized:", {
            sampleRate: this.sampleRate,
            minBufferSize: this.minBufferSize,
            maxBufferSize: this.maxBufferSize,
            timestamp: new Date().toISOString()
        });
    }

    convertToInt16(float32Array) {
        const int16Array = new Int16Array(float32Array.length);
        for (let i = 0; i < float32Array.length; i++) {
            const s = Math.max(-1, Math.min(1, float32Array[i]));
            int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        return int16Array;
    }

    hasSound(audioData) {
        for (let i = 0; i < audioData.length; i++) {
            if (Math.abs(audioData[i]) > this.silenceThreshold) {
                return true;
            }
        }
        return false;
    }

    process(inputs) {
        const input = inputs[0];
        if (!input || !input[0]) {
            return true;
        }

        const inputData = input[0];
        const hasSoundInFrame = this.hasSound(inputData);
        
        // Log audio frame metrics
        console.debug('Audio frame metrics:', {
            frameSize: inputData.length,
            hasSoundInFrame,
            timestamp: new Date().toISOString()
        });

        if (hasSoundInFrame) {
            this.silenceCounter = 0;
            this.isProcessing = true;
        } else if (this.isProcessing) {
            this.silenceCounter++;
        }

        if (this.isProcessing) {
            // Create new buffer with combined data
            const newBuffer = new Float32Array(this.buffer.length + inputData.length);
            newBuffer.set(this.buffer);
            newBuffer.set(inputData, this.buffer.length);
            this.buffer = newBuffer;

            const shouldSend = 
                this.buffer.length >= this.minBufferSize || 
                (this.silenceCounter >= this.maxSilenceFrames && this.buffer.length > 0);

            if (shouldSend) {
                try {
                    // Convert and send buffer
                    const int16Data = this.convertToInt16(this.buffer);
                    const durationMs = (int16Data.length / this.sampleRate) * 1000;
                    
                    // Detailed buffer metrics logging
                    console.debug('Audio buffer metrics:', {
                        bufferSize: int16Data.length,
                        durationMs: durationMs.toFixed(2),
                        sampleRate: this.sampleRate,
                        silenceCounter: this.silenceCounter,
                        timestamp: new Date().toISOString(),
                        totalSamples: int16Data.length,
                        avgAmplitude: this.calculateAvgAmplitude(int16Data)
                    });

                    // Transfer the buffer to the main thread
                    this.port.postMessage(
                        {
                            audioData: int16Data.buffer,
                            sampleCount: int16Data.length,
                            durationMs: durationMs,
                            timestamp: new Date().toISOString()
                        }, 
                        [int16Data.buffer]
                    );

                    // Reset state if silence detected
                    if (this.silenceCounter >= this.maxSilenceFrames) {
                        console.debug('Silence detected, resetting buffer');
                        this.isProcessing = false;
                        this.silenceCounter = 0;
                    }
                    
                    this.buffer = new Float32Array();
                    
                } catch (error) {
                    console.error("Error processing audio buffer:", {
                        error: error.message,
                        stack: error.stack,
                        timestamp: new Date().toISOString()
                    });
                }
            }
        }

        return true;
    }

    calculateAvgAmplitude(int16Data) {
        let sum = 0;
        for (let i = 0; i < int16Data.length; i++) {
            sum += Math.abs(int16Data[i]);
        }
        return (sum / int16Data.length).toFixed(2);
    }
}

registerProcessor('audio-processor', AudioProcessor);