// DOM Elements
const startButton = document.getElementById("startButton");
const stopButton = document.getElementById("stopButton");
const heroSection = document.getElementById("heroSection");
const chatInterface = document.getElementById("chatInterface");
const transcriptDiv = document.getElementById("transcript");
const audioOutput = document.getElementById("audioOutput");
const statusDiv = document.getElementById("status");

let pc; // RTCPeerConnection instance
let micStream; // Microphone stream

// Function to initialize WebRTC session with OpenAI
async function createRealtimeSession(inStream, outEl) {
    try {
        // Create RTCPeerConnection instance
        pc = new RTCPeerConnection();

        // Handle incoming audio track and play it
        pc.ontrack = (event) => {
            console.log("Received audio stream");
            outEl.srcObject = event.streams[0];
        };

        // Add local microphone track to RTCPeerConnection
        const audioTrack = inStream.getTracks()[0];
        pc.addTrack(audioTrack, inStream);

        // Create and set local SDP offer
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        console.log("SDP Offer sent:", offer.sdp);

        // Send the SDP offer to the backend server
        const response = await fetch('http://localhost:4000/offer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/sdp' },
            body: offer.sdp, // Send SDP offer as plain text
        });

        // Receive the SDP answer from the server
        const sdpAnswer = await response.text();
        console.log("Received SDP Answer:", sdpAnswer);

        // Set the remote SDP answer on the RTCPeerConnection
        await pc.setRemoteDescription({ type: 'answer', sdp: sdpAnswer });
        console.log("SDP Answer set successfully");
    } catch (error) {
        console.error("Error creating WebRTC session:", error);
        statusDiv.textContent = "Failed to connect to AI. Please try again.";
    }
}

// Start the conversation
startButton.addEventListener("click", async () => {
    try {
        // UI transitions
        heroSection.classList.add("hidden");
        chatInterface.classList.remove("hidden");

        // Request microphone access
        statusDiv.textContent = "Requesting microphone access...";
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        console.log("Microphone access granted");

        // Start WebRTC session
        statusDiv.textContent = "Connecting to AI...";
        await createRealtimeSession(micStream, audioOutput);

        // Update UI to indicate readiness
        statusDiv.textContent = "You can start speaking now.";
    } catch (error) {
        console.error("Error starting session:", error);
        statusDiv.textContent = "Failed to start session. Please check your settings.";
    }
});

// Stop the conversation
stopButton.addEventListener("click", () => {
    try {
        // Close WebRTC connection
        if (pc) {
            pc.close();
            pc = null;
            console.log("WebRTC connection closed");
        }

        // Stop the microphone stream
        if (micStream) {
            micStream.getTracks().forEach((track) => track.stop());
            micStream = null;
            console.log("Microphone stream stopped");
        }

        // Reset UI
        statusDiv.textContent = "Conversation ended.";
        heroSection.classList.remove("hidden");
        chatInterface.classList.add("hidden");
    } catch (error) {
        console.error("Error stopping session:", error);
        statusDiv.textContent = "Error ending the session.";
    }
});
