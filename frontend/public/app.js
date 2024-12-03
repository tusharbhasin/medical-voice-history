class VoiceChat {
    constructor() {
        this.chatButton = document.getElementById('recordButton'); // we'll rename this element later
        this.statusDisplay = document.getElementById('status');
        this.isConversationActive = false;
        this.ws = null;
        
        this.initializeEventListeners();
    }

    initializeEventListeners() {
        this.chatButton.addEventListener('click', () => {
            if (!this.isConversationActive) {
                this.startConversation();
            } else {
                this.endConversation();
            }
        });
    }

    startConversation() {
        this.isConversationActive = true;
        this.updateStatus('Connecting to AI assistant...');
        this.updateButtonState(true);
        
        // Connect to our backend WebSocket
        this.ws = new WebSocket('ws://localhost:8000/ws');
        
        this.ws.onopen = () => {
            this.updateStatus('Connected! AI assistant will begin shortly...');
        };

        this.ws.onmessage = (event) => {
            // Handle messages from the AI
            const data = JSON.parse(event.data);
            console.log('Received message:', data);
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            this.updateStatus('Error connecting to AI assistant');
            this.endConversation();
        };

        this.ws.onclose = () => {
            this.updateStatus('Connection closed');
            this.endConversation();
        };
    }

    endConversation() {
        this.isConversationActive = false;
        this.updateButtonState(false);
        if (this.ws) {
            this.ws.close();
        }
        this.updateStatus('Conversation ended');
    }

    updateStatus(message) {
        this.statusDisplay.textContent = message;
    }

    updateButtonState(isActive) {
        this.chatButton.textContent = isActive ? 'End Conversation' : 'Start Chatting';
        this.chatButton.classList.toggle('active', isActive);
    }
}

// Initialize when the page loads
document.addEventListener('DOMContentLoaded', () => {
    const voiceChat = new VoiceChat();
});