const express = require('express');
const axios = require('axios');
const qs = require('qs');
const dotenv = require('dotenv');
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Function to get App Access Token
async function getAppAccessToken() {
    const data = qs.stringify({
        grant_type: 'client_credentials',
        client_id: process.env.KICK_CLIENT_ID,
        client_secret: process.env.KICK_CLIENT_SECRET,
    });

    try {
        const response = await axios.post('https://id.kick.com/oauth/token', data, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            }
        });

        const { access_token } = response.data;
        return access_token;
    } catch (error) {
        console.error('Error fetching App Access Token:', error);
        throw error;
    }
}

// Route to get Kick profile data by slug
app.get('/kick-profile', async (req, res) => {
    const { slug } = req.query;

    if (!slug) {
        return res.status(400).json({ error: 'Slug (username) is required.' });
    }

    try {
        // Step 1: Get the App Access Token
        const accessToken = await getAppAccessToken();

        // Step 2: Call the Kick public API to fetch profile data by slug
        const response = await axios.get(`https://api.kick.com/public/v2/channels/${slug}`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,  // Use the Bearer token
                'Accept': '*/*',
            }
        });

        const data = response.data.data[0];  // Get the first item from the response data

        // Step 3: Extract relevant fields and send the response
        res.json({
            banner_picture: data.banner_picture || null,
            broadcaster_user_id: data.broadcaster_user_id || null,
            category: {
                id: data.category?.id || null,
                name: data.category?.name || null,
                thumbnail: data.category?.thumbnail || null
            },
            channel_description: data.channel_description || null,
            slug: data.slug || null,
            stream: {
                is_live: data.stream?.is_live || false,
                is_mature: data.stream?.is_mature || false,
                viewer_count: data.stream?.viewer_count || 0,
                stream_title: data.stream_title || null,
                url: data.stream?.url || null,
                thumbnail: data.stream?.thumbnail || null,
                start_time: data.stream?.start_time || null,
                language: data.stream?.language || null
            }
        });
    } catch (error) {
        console.error('Error fetching profile:', error);
        res.status(500).json({ error: 'Failed to fetch profile.' });
    }
});

// Root route to confirm the server is running
app.get('/', (req, res) => {
    res.send('Kick Backend is up and running!');
});

// Start the server
app.listen(port, () => {
    console.log(`Kick API backend running on port ${port}`);
});
