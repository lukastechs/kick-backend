const express = require('express');
const axios = require('axios');
const dotenv = require('dotenv');
const qs = require('qs');

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

const KICK_AUTH_URL = 'https://kick.com/oauth/authorize';
const KICK_TOKEN_URL = 'https://kick.com/oauth/token';
const KICK_API_URL = 'https://api.kick.com/v1/channels';

// Store the access token (in a real application, use a secure store like a database)
let access_token = null;

// Step 1: Redirect user to Kick authorization page (to authenticate once)
app.get('/auth', (req, res) => {
    const authUrl = `${KICK_AUTH_URL}?client_id=${process.env.KICK_CLIENT_ID}&redirect_uri=${process.env.KICK_REDIRECT_URI}&response_type=code&scope=channel_read`;
    res.redirect(authUrl);
});

// Step 2: Callback endpoint to handle authorization code
app.get('/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) {
        return res.status(400).send('No authorization code received.');
    }

    try {
        const response = await axios.post(KICK_TOKEN_URL, qs.stringify({
            client_id: process.env.KICK_CLIENT_ID,
            client_secret: process.env.KICK_CLIENT_SECRET,
            code: code,
            redirect_uri: process.env.KICK_REDIRECT_URI,
            grant_type: 'authorization_code'
        }), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        // Store the access token
        access_token = response.data.access_token;

        // Respond with the access token (store it securely)
        res.json({ access_token });
    } catch (error) {
        console.error('Error fetching access token:', error);
        res.status(500).send('Failed to exchange authorization code for access token.');
    }
});

// Step 3: Use access token to fetch any profile (by slug)
app.get('/kick-profile', async (req, res) => {
    const { slug } = req.query;

    if (!access_token) {
        return res.status(400).json({ error: 'Access token is not available. Please authenticate first.' });
    }

    if (!slug) {
        return res.status(400).json({ error: 'Slug (username) is required.' });
    }

    try {
        const response = await axios.get(KICK_API_URL, {
            params: { slug },
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

app.listen(port, () => {
    console.log(`Kick API backend running on port ${port}`);
});
