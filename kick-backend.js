// Import required packages
const express = require('express');
const axios = require('axios');
const dotenv = require('dotenv');
const qs = require('qs');  // For encoding request data

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Kick API URLs
const KICK_AUTH_URL = 'https://kick.com/oauth/authorize';
const KICK_TOKEN_URL = 'https://kick.com/oauth/token';
const KICK_API_URL = 'https://api.kick.com/v1/channels';

// Step 1: Root route (optional) to check if the server is running
app.get('/', (req, res) => {
    res.send('Kick Backend is up and running!');
});

// Step 2: Redirect user to the Kick authorization page
app.get('/auth', (req, res) => {
    const authUrl = `${KICK_AUTH_URL}?client_id=${process.env.KICK_CLIENT_ID}&redirect_uri=${process.env.KICK_REDIRECT_URI}&response_type=code&scope=channel_read`;
    res.redirect(authUrl);
});

// Step 3: Callback endpoint to handle the authorization code
app.get('/callback', async (req, res) => {
    const { code } = req.query;  // Authorization code from Kick
    if (!code) {
        return res.status(400).send('No authorization code received.');
    }

    try {
        // Step 4: Exchange authorization code for access token
        const response = await axios.post(KICK_TOKEN_URL, qs.stringify({
            client_id: process.env.KICK_CLIENT_ID,
            client_secret: process.env.KICK_CLIENT_SECRET,
            code: code,
            redirect_uri: process.env.KICK_REDIRECT_URI,
            grant_type: 'authorization_code'
        }), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        // Step 5: Store the access token and refresh token
        const { access_token, refresh_token } = response.data;
        // Store these tokens securely (e.g., in memory or a database)
        res.json({ access_token, refresh_token });
    } catch (error) {
        console.error('Error fetching access token:', error);
        res.status(500).send('Failed to exchange authorization code for access token.');
    }
});

// Step 6: Use the access token to fetch the channel data
app.get('/kick-profile', async (req, res) => {
    const { access_token, broadcaster_user_id, slug } = req.query;

    if (!access_token) {
        return res.status(400).json({ error: 'Access token is required.' });
    }

    if (!broadcaster_user_id && !slug) {
        return res.status(400).json({ error: 'Either broadcaster_user_id or slug is required.' });
    }

    try {
        const response = await axios.get(KICK_API_URL, {
            params: { broadcaster_user_id, slug },
            headers: { 'Authorization': `Bearer ${access_token}` }
        });

        const data = response.data;
        res.json({
            profile_image: data.profile_image_url,
            follower_count: data.follower_count,
            channel_created: data.created_at,
            verification_status: data.is_verified,
            banned_status: data.is_banned,
            channel_slug: data.slug
        });
    } catch (error) {
        console.error('Error fetching profile:', error);
        res.status(500).json({ error: 'Failed to fetch profile.' });
    }
});

// Start the server
app.listen(port, () => {
    console.log(`Kick API backend running on port ${port}`);
});
