const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Calculate account age in human-readable format
function calculateAccountAge(createdAt) {
  const now = new Date();
  const created = new Date(createdAt);
  const diffMs = now - created;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const years = Math.floor(diffDays / 365);
  const months = Math.floor((diffDays % 365) / 30);
  return years > 0 ? `${years} years, ${months} months` : `${months} months`;
}

// Format the channel's creation date as "February 14, 2023"
function formatCreationDate(createdAt) {
  const options = { year: 'numeric', month: 'long', day: 'numeric' };
  return new Date(createdAt).toLocaleDateString(undefined, options);
}

// Generate Kick App Access Token
async function getKickAccessToken() {
  try {
    const response = await axios.post('https://id.kick.com/oauth/token', null, {
      params: {
        client_id: process.env.KICK_CLIENT_ID,
        client_secret: process.env.KICK_CLIENT_SECRET,
        grant_type: 'client_credentials',
      },
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: 5000,
    });

    const { access_token } = response.data;
    console.log('Fetched new access token');
    return access_token;
  } catch (error) {
    console.error('Kick Token Error:', {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message,
    });
    throw new Error('Failed to generate Kick access token');
  }
}

// Root endpoint
app.get('/', (req, res) => {
  res.send('Kick Account Age Checker API is running');
});

// Kick age checker endpoint (GET)
app.get('/api/kick/:slug', async (req, res) => {
  const { slug } = req.params;
  if (!slug) {
    return res.status(400).json({ error: 'Slug is required' });
  }

  try {
    const token = await getKickAccessToken();
    const response = await axios.get(`https://api.kick.com/public/v1/channels`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
      params: { slug },
      timeout: 5000,
    });

    const channel = response.data.data[0];
    if (!channel) {
      return res.status(404).json({ error: `Channel ${slug} not found` });
    }

    res.json({
      username: channel.slug,
      channel_description: channel.channel_description || 'No description',
      banner_picture: channel.banner_picture || 'No banner',
      creation_date: formatCreationDate(channel.stream.start_time),
      account_age: calculateAccountAge(channel.stream.start_time),
      verification_status: channel.stream.is_live ? 'Verified' : 'Not Verified',
      followers: 'Visit Profile', // Placeholder, Kick API doesn't provide follower count publicly
      avatar: channel.stream.thumbnail || 'https://via.placeholder.com/50',
      stream_status: channel.stream.is_live ? 'Live' : 'Offline',
      category: channel.category.name || 'Uncategorized',
    });
  } catch (error) {
    console.error('Kick API Error:', {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message,
    });
    res.status(error.response?.status || 500).json({
      error: error.message || 'Failed to fetch Kick data',
      details: error.response?.data || 'No additional details',
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.listen(port, () => {
  console.log(`Kick Server running on port ${port}`);
});
