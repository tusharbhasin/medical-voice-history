class AudioProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.sampleRate = 24000;  // Match OpenAI's requirement
        this.minBufferSize = 5000;  // Slightly higher buffer threshold (~208ms)
        this.buffer = new Float32Array();
    }

    convertToInt16(float32Array) {
        const int16Array = new Int16Array(float32Array.length);
        for (let i = 0; i < float32Array.length; i++) {
            const s = Math.max(-1, Math.min(1, float32Array[i]));
            int16Array[i] = s * 32767;
        }
        return int16Array;
    }

    process(inputs) {
        const input = inputs[0];
        if (!input || !input[0]) return true;

        const inputData = input[0];
        const newBuffer = new Float32Array(this.buffer.length + inputData.length);
        newBuffer.set(this.buffer);
        newBuffer.set(inputData, this.buffer.length);
        this.buffer = newBuffer;

        // Send when enough data is accumulated
        if (this.buffer.length >= this.minBufferSize) {
            const int16Data = this.convertToInt16(this.buffer);
            this.port.postMessage({
                audioData: int16Data.buffer,
                sampleRate: this.sampleRate,
                bufferSize: int16Data.length,
            }, [int16Data.buffer]);
            this.buffer = new Float32Array();  // Clear buffer after sending
        }

        return true;
    }
}

registerProcessor('audio-processor', AudioProcessor);
