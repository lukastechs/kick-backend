const express = require('express');
const axios = require('axios');
const qs = require('qs');
const moment = require('moment');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

const KICK_OAUTH_URL = 'https://id.kick.com/oauth/token';
const KICK_API_URL = 'https://api.kick.com/public/v1/channels';

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
        console.log('Access Token:', access_token);
        if (!access_token) {
            throw new Error('No access token received');
        }
        return access_token;
    } catch (error) {
        console.error('Error fetching App Access Token:', error.response?.data || error.message);
        throw error;
    }
}

async function getChannelProfile(slug) {
    const access_token = await getAppAccessToken();

    try {
        // Try v1 endpoint first
        let response = await axios.get(KICK_API_URL, {
            params: { slug: slug },
            headers: {
                'Authorization': `Bearer ${access_token}`,
                'Accept': 'application/json'
            }
        });

        let channelData = response.data;
        console.log('v1 Channel Data:', JSON.stringify(channelData, null, 2));

        // If verified or followers_count are missing, try v2 endpoint
        if (!channelData.data[0]?.verified && !channelData.data[0]?.followers_count) {
            console.log('Trying v2 endpoint for additional fields...');
            response = await axios.get(`${KICK_API_URL_V2}${slug}`, {
                headers: {
                    'Authorization': `Bearer ${access_token}`,
                    'Accept': 'application/json'
                }
            });
            channelData = response.data;
            console.log('v2 Channel Data:', JSON.stringify(channelData, null, 2));
        }

        return channelData;
    } catch (error) {
        console.error('Error fetching channel data:', error.response?.data || error.message);
        throw error;
    }
}

app.get('/kick-profile', async (req, res) => {
    const { slug } = req.query;

    if (!slug) {
        return res.status(400).json({ error: 'Slug (username) is required.' });
    }

    try {
        const channelData = await getChannelProfile(slug);
        const channel = channelData.data && channelData.data.length > 0 ? channelData.data[0] : null;

        if (!channel) {
            return res.status(404).json({ error: 'Channel not found.', details: `No channel found for slug: ${slug}` });
        }

        // Calculate account age (assuming channel_created exists; fallback to start_time)
        let createdDate = channel.created_at || channel.stream?.start_time;
        let accountAge = null;
        let formattedCreatedDate = null;

        if (createdDate && createdDate !== '0001-01-01T00:00:00Z') {
            const createdMoment = moment(createdDate);
            formattedCreatedDate = createdMoment.format('MMMM D, YYYY');
            const now = moment();
            const years = now.diff(createdMoment, 'years');
            now.subtract(years, 'years');
            const months = now.diff(createdMoment, 'months');
            accountAge = years > 0 ? `${years} year${years > 1 ? 's' : ''}${months > 0 ? `, ${months} month${months > 1 ? 's' : ''}` : ''}` : `${months} month${months > 1 ? 's' : ''}`;
        }

        // Format start_time
        const startTime = channel.stream?.start_time && channel.stream.start_time !== '0001-01-01T00:00:00Z'
            ? moment(channel.stream.start_time).format('MMMM D, YYYY')
            : null;

        res.json({
            profile_image: channel.banner_picture || null,
            follower_count: channel.followers_count || null,
            channel_created: formattedCreatedDate || null,
            account_age: accountAge || null,
            verification_status: channel.verified || false,
            banned_status: channel.is_banned || false,
            channel_slug: channel.slug || slug,
            channel_description: channel.channel_description || null,
            broadcaster_user_id: channel.broadcaster_user_id || null,
            stream_title: channel.stream_title || null,
            is_live: channel.stream?.is_live || false,
            is_mature: channel.stream?.is_mature || false,
            viewer_count: channel.stream?.viewer_count || null,
            stream_start_time: startTime || null
        });
    } catch (error) {
        res.status(error.response?.status || 500).json({
            error: 'Failed to fetch profile.',
            details: error.response?.data?.error || error.message,
            reference: error.response?.data?.reference || 'N/A'
        });
    }
});

app.listen(port, () => {
    console.log(`Kick API backend running on port ${port}`);
});
