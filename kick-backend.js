const express = require('express');
const axios = require('axios');
const qs = require('qs');
const moment = require('moment'); // for formatting dates and calculating age
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

// Step 2: Fetch Channel Data and Calculate Account Age
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

        const channelData = response.data.data[0];  // Fetching the first channel data

        // Calculate account age (in years)
        const startTime = moment(channelData.stream.start_time);
        const currentTime = moment();
        const accountAge = currentTime.diff(startTime, 'years') > 0
            ? currentTime.diff(startTime, 'years') + ' years ago'
            : currentTime.diff(startTime, 'months') + ' months ago';

        // Format start time (channel creation date)
        const formattedStartTime = startTime.format('MMMM DD, YYYY');

        // Extract verification status and followers count
        const verificationStatus = channelData.stream.is_mature ? 'Verified' : 'Not Verified';
        const followerCount = channelData.stream.viewer_count || 'N/A';  // Assuming viewer_count is used for followers

        console.log('Channel Data:', channelData); // Log the channel data

        return {
            profile_image: channelData.banner_picture,
            channel_slug: channelData.slug,
            description: channelData.channel_description,
            stream_title: channelData.stream_title,
            account_age: accountAge,
            channel_creation_date: formattedStartTime,
            verification_status: verificationStatus,
            follower_count: followerCount
        };
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
