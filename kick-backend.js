const express = require('express');
const axios = require('axios');
const cloudscraper = require('cloudscraper');
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
const KICK_API_URL_V2 = 'https://kick.com/api/v2/channels/';

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
    // Try v1 first for baseline data
    const v1Response = await axios.get(KICK_API_URL, {
      params: { slug: slug },
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Accept': 'application/json'
      }
    });

    let channelData = v1Response.data;
    console.log('v1 Channel Data:', JSON.stringify(channelData, null, 2));

    // Try v2 with cloudscraper to bypass security policy
    console.log('Trying v2 endpoint for additional fields...');
    const v2Response = await cloudscraper.get(`${KICK_API_URL_V2}${slug}`, {
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://kick.com/',
        'Origin': 'https://kick.com'
      }
    });

    const v2Data = JSON.parse(v2Response);
    console.log('v2 Channel Data:', JSON.stringify(v2Data, null, 2));
    // Log specific fields from v2
    console.log('Checked created_at from v2:', v2Data?.created_at || 'Not found');
    console.log('Checked followers_count from v2:', v2Data?.followers_count || 'Not found');

    // Merge v1 and v2 data, prioritizing v2 for created_at and followers_count
    const mergedData = {
      ...channelData.data[0],
      ...(v2Data || {})
    };

    return { data: [mergedData] };
  } catch (error) {
    console.error('Error fetching channel data:', error.response?.data || error.message);
    if (error.response?.status === 403 || error.response?.status === 404) {
      console.log('v2 failed, falling back to v1 data');
      return channelData; // Return v1 data if v2 is blocked
    }
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
