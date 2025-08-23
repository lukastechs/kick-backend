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
        client_id: process.env.KICK_CLIENT_ID,  // Add your client ID
        client_secret: process.env.KICK_CLIENT_SECRET,  // Add your client secret
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
        const response = await axios.get(`https://api.kick.com/public/v1/channels/${slug}`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,  // Use the Bearer token
                'Accept': '*/*',
            }
        });

        const data = response.data;

        // Step 3: Extract relevant fields and send the response
        res.json({
            profile_image: data.user?.profile_pic || data.banner_image?.url || null,  // Profile pic or fallback to banner
            follower_count: data.followers_count || null,
            channel_created: data.created_at || null,  // May not be available, fallback to null
            verification_status: data.verified || false,
            banned_status: data.is_banned || false,
            channel_slug: data.slug,
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
