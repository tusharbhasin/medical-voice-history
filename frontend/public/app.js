class VoiceChat {
    constructor() {
        this.chatButton = document.getElementById('recordButton');
        this.statusDisplay = document.getElementById('status');
        this.heroSection = document.getElementById('heroSection');
        this.chatInterface = document.getElementById('chatInterface');
        this.endButton = document.getElementById('endButton');
        this.isConversationActive = false;
        
        this.initializeEventListeners();
    }

    initializeEventListeners() {
        this.chatButton.addEventListener('click', () => {
            this.startConversation();
        });

        this.endButton.addEventListener('click', () => {
            this.endConversation();
        });
    }

    startConversation() {
        // Animate hero section
        this.heroSection.classList.add('compact');
        
        // Show chat interface after a small delay
        setTimeout(() => {
            this.chatInterface.classList.remove('hidden');
            requestAnimationFrame(() => {
                this.chatInterface.classList.add('visible');
            });
        }, 500);

        this.isConversationActive = true;
    }

    endConversation() {
        this.isConversationActive = false;
        
        // Hide chat interface
        this.chatInterface.classList.remove('visible');
        
        // Reset hero section
        setTimeout(() => {
            this.heroSection.classList.remove('compact');
            this.chatInterface.classList.add('hidden');
        }, 500);
    }
}

// Initialize when the page loads
document.addEventListener('DOMContentLoaded', () => {
    const voiceChat = new VoiceChat();
});