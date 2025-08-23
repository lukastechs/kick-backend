const express = require('express');
const axios = require('axios');
const qs = require('qs');
const moment = require('moment');
const cors = require('cors');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const KICK_OAUTH_URL = 'https://id.kick.com/oauth/token';
const KICK_API_URL = 'https://api.kick.com/public/v1/channels';

// Calculate account age in human-readable format
function calculateAccountAge(createdAt) {
  if (!createdAt || createdAt === '0001-01-01T00:00:00Z') return null;
  const now = moment();
  const created = moment(createdAt);
  const years = now.diff(created, 'years');
  now.subtract(years, 'years');
  const months = now.diff(created, 'months');
  return years > 0 ? `${years} year${years > 1 ? 's' : ''}${months > 0 ? `, ${months} month${months > 1 ? 's' : ''}` : ''}` : `${months} month${months > 1 ? 's' : ''}`;
}

// Calculate age in days
function calculateAgeDays(createdAt) {
  if (!createdAt || createdAt === '0001-01-01T00:00:00Z') return null;
  const now = moment();
  const created = moment(createdAt);
  return Math.floor(now.diff(created, 'days'));
}

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
    const response = await axios.get(KICK_API_URL, {
      params: { slug: slug },
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Accept': 'application/json'
      }
    });

    const channelData = response.data;
    console.log('Channel Data:', JSON.stringify(channelData, null, 2));
    // Log specific fields to check their presence
    const channel = channelData.data[0];
    console.log('Checked created_at:', channel?.created_at || 'Not found');
    console.log('Checked followers_count:', channel?.followers_count || 'Not found');

    return channelData;
  } catch (error) {
    console.error('Error fetching channel data:', error.response?.data || error.message);
    throw error;
  }
}

app.get('/', (req, res) => {
  res.send('Kick Account Age Checker API is running');
});

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

    // Calculate account age and dates
    const createdAt = channel.created_at || channel.stream?.start_time;
    const formattedCreatedDate = createdAt && createdAt !== '0001-01-01T00:00:00Z'
      ? moment(createdAt).format('MMMM D, YYYY')
      : null;
    const accountAge = calculateAccountAge(createdAt);
    const ageDays = calculateAgeDays(createdAt);

    res.json({
      profile_image: channel.banner_picture || null,
      follower_count: channel.followers_count || null,
      channel_created: formattedCreatedDate,
      account_age: accountAge,
      age_days: ageDays,
      verification_status: channel.verified || false,
      banned_status: channel.is_banned || false,
      channel_slug: channel.slug || slug,
      channel_description: channel.channel_description || null,
      broadcaster_user_id: channel.broadcaster_user_id || null,
      stream_title: channel.stream_title || null,
      is_live: channel.stream?.is_live || false,
      is_mature: channel.stream?.is_mature || false,
      viewer_count: channel.stream?.viewer_count || null,
      stream_start_time: channel.stream?.start_time && channel.stream.start_time !== '0001-01-01T00:00:00Z'
        ? moment(channel.stream.start_time).format('MMMM D, YYYY')
        : null
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
