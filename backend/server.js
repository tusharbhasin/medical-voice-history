import express from 'express';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();
const port = process.env.PORT || 4000;

// Directory path resolution
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Enable CORS for frontend at http://localhost:3000
app.use(cors());

// Middleware to parse JSON bodies for application/json content type
app.use(express.json());

// Serve static files
app.use(express.static('public'));



// Proxy endpoint for OpenAI API (if needed)
app.post('/api/openai', async (req, res) => {
    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
            },
            body: JSON.stringify(req.body),
        });

        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('Error communicating with OpenAI:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// WebRTC SDP Offer/Answer Endpoint
app.post('/offer', express.text({ type: 'application/sdp' }), async (req, res) => {
    try {
        const sdpOffer = req.body; // The SDP offer as plain text

        console.log('Received SDP Offer:', sdpOffer); // Log the SDP Offer for debugging

        // Send the SDP offer to OpenAI's Realtime API
        const response = await fetch('https://api.openai.com/v1/realtime', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/sdp', // Set the correct content type
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
            },
            body: sdpOffer, // Send the SDP offer as plain text
        });

        const sdpAnswer = await response.text(); // Get the SDP answer as plain text

        console.log('SDP Answer Response:', sdpAnswer); // Log OpenAI's response

        // Set Content-Type header and send the SDP answer back to the frontend
        res.setHeader('Content-Type', 'application/sdp');
        res.send(sdpAnswer);
    } catch (error) {
        console.error('Error handling /offer request:', error);
        res.status(500).send('Failed to process SDP offer');
    }
});

// 404 Fallback
app.use((req, res) => {
    res.status(404).send('Endpoint Not Found');
});

// Start the server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
