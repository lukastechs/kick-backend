const express = require('express');
const axios = require('axios');
const dotenv = require('dotenv');
const qs = require('querystring');

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

const KICK_API_URL = 'https://api.kick.com/public/v1/channels/'; // Try v1 first
// const KICK_API_URL = 'https://kick.com/api/v2/channels/'; // Fallback if v1 fails
const KICK_OAUTH_URL = 'https://id.kick.com/oauth/token';

async function getAppAccessToken() {
    try {
        const response = await axios.post(KICK_OAUTH_URL, qs.stringify({
            grant_type: 'client_credentials',
            client_id: process.env.KICK_CLIENT_ID || 'YOUR_CLIENT_ID_HERE',
            client_secret: process.env.KICK_CLIENT_SECRET || 'YOUR_CLIENT_SECRET_HERE'
        }), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });

        const data = response.data;
        console.log('Access Token:', data.access_token); // Debug token
        if (!data.access_token) {
            throw new Error('No access token received');
        }
        return data.access_token;
    } catch (error) {
        console.error('Error fetching App Access Token:', error.response?.data || error.message);
        throw error;
    }
}

app.get('/', (req, res) => {
    res.send('Kick Backend is up and running!');
});

app.get('/kick-profile', async (req, res) => {
    const { slug } = req.query;

    if (!slug) {
        return res.status(400).json({ error: 'Slug (username) is required.' });
    }

    try {
        const accessToken = await getAppAccessToken();
        const response = await axios.get(`${KICK_API_URL}${slug}`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Accept': '*/*',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://kick.com/',
                'Origin': 'https://kick.com'
            }
        });

        const data = response.data.data[0]; // Access first item in data array
        console.log('API Response:', data); // Debug response
        res.json({
            profile_image: data.banner_picture || null,
            follower_count: data.followers_count || null,
            channel_created: data.created_at || null,
            verification_status: data.verified || false,
            banned_status: data.is_banned || false,
            channel_slug: data.slug || slug,
            channel_description: data.channel_description || null,
            broadcaster_user_id: data.broadcaster_user_id || null,
            stream_title: data.stream_title || null,
            is_live: data.stream?.is_live || false,
            is_mature: data.stream?.is_mature || false,
            viewer_count: data.stream?.viewer_count || null
        });
    } catch (error) {
        console.error('Error fetching profile:', error.response?.data || error.message);
        res.status(500).json({
            error: 'Failed to fetch profile.',
            details: error.response?.data?.error || error.message,
            reference: error.response?.data?.reference || 'N/A'
        });
    }
});

app.listen(port, () => {
    console.log(`Kick API backend running on port ${port}`);
});
