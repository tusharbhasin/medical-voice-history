class VoiceRecorder {
    constructor() {
        this.recordButton = document.getElementById('recordButton');
        this.statusDisplay = document.getElementById('status');
        this.isRecording = false;
        
        this.initializeEventListeners();
    }

    initializeEventListeners() {
        this.recordButton.addEventListener('click', () => {
            if (!this.isRecording) {
                this.startRecording();
            } else {
                this.stopRecording();
            }
        });
    }

    startRecording() {
        this.isRecording = true;
        this.recordButton.textContent = 'Stop Recording';
        this.recordButton.classList.add('recording');
        this.statusDisplay.textContent = 'Recording...';
    }

    stopRecording() {
        this.isRecording = false;
        this.recordButton.textContent = 'Start Recording';
        this.recordButton.classList.remove('recording');
        this.statusDisplay.textContent = 'Ready to record';
    }
}

// Initialize when the page loads
document.addEventListener('DOMContentLoaded', () => {
    const recorder = new VoiceRecorder();
});