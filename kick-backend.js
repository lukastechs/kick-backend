const express = require('express');
const axios = require('axios');
const qs = require('qs');
require('dotenv').config(); // to load client ID and client secret from .env

const app = express();
const port = process.env.PORT || 3000;

const KICK_OAUTH_URL = 'https://id.kick.com/oauth/token';
const KICK_API_URL = 'https://api.kick.com/public/v1/channels';

// Step 1: Request App Access Token
async function getAppAccessToken() {
    try {
        const response = await axios.post(KICK_OAUTH_URL, qs.stringify({
            grant_type: 'client_credentials',
            client_id: process.env.KICK_CLIENT_ID,
            client_secret: process.env.KICK_CLIENT_SECRET
        }), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const access_token = response.data.access_token;
        console.log('Access Token:', access_token); // Log or store it securely for future use
        return access_token; // Return the access token
    } catch (error) {
        console.error('Error fetching App Access Token:', error);
        throw error;
    }
}

// Step 2: Fetch Channel Data
async function getChannelProfile(slug) {
    const access_token = await getAppAccessToken(); // Get the App Access Token

    try {
        const response = await axios.get(KICK_API_URL, {
            params: { slug: slug },  // Query parameters
            headers: {
                'Authorization': `Bearer ${access_token}`,  // Authorization header
                'Accept': 'application/json'
            }
        });

        const channelData = response.data;
        console.log('Channel Data:', channelData); // Log the channel data
        return channelData;
    } catch (error) {
        console.error('Error fetching channel data:', error);
        throw error;
    }
}

// Set up a basic route to test the API
app.get('/kick-profile', async (req, res) => {
    const { slug } = req.query;

    if (!slug) {
        return res.status(400).json({ error: 'Slug (username) is required.' });
    }

    try {
        const channelData = await getChannelProfile(slug); // Fetch the channel data
        res.json(channelData);  // Send the channel data as the response
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch profile.' });
    }
});

app.listen(port, () => {
    console.log(`Kick API backend running on port ${port}`);
});
