const express = require('express');
const axios = require('axios');
const dotenv = require('dotenv');
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Public API endpoint for channel data by slug
const KICK_API_URL = 'https://kick.com/api/v1/channels/';

// Step 1: Root route (optional) to check if the server is running
app.get('/', (req, res) => {
    res.send('Kick Backend is up and running!');
});

// Step 2: Use the public API to fetch any profile (by slug)
app.get('/kick-profile', async (req, res) => {
    const { slug } = req.query;

    // Check if slug is provided
    if (!slug) {
        return res.status(400).json({ error: 'Slug (username) is required.' });
    }

    try {
        // Call the public Kick API to fetch the channel data by slug
        const response = await axios.get(`${KICK_API_URL}${slug}`, {
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });

        // Extract relevant fields based on the API response structure
        const data = response.data;

        // Respond with profile data
        res.json({
            profile_image: data.user?.profile_pic || data.banner_image?.url || null, // Profile pic if available, fallback to banner image
            follower_count: data.followers_count || null,
            channel_created: data.created_at || null, // May not be available, fallback to null
            verification_status: data.verified || false,
            banned_status: data.is_banned || false,
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
