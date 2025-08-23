// kick-backend.js
const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// Get app access token
async function getAccessToken() {
  try {
    const response = await axios.post('https://id.kick.com/oauth/token', 
      `grant_type=client_credentials&client_id=${process.env.KICK_CLIENT_ID}&client_secret=${process.env.KICK_CLIENT_SECRET}`,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );
    
    return response.data.access_token;
  } catch (error) {
    console.error('Error getting access token:', error.response?.data || error.message);
    throw new Error('Failed to get access token');
  }
}

// Get channel information
app.get('/api/kick-user', async (req, res) => {
  try {
    const { slug } = req.query;
    
    if (!slug) {
      return res.status(400).json({ error: 'Slug parameter is required' });
    }

    // Get access token
    const accessToken = await getAccessToken();
    
    // Get channel info
    const response = await axios.get(`https://api.kick.com/public/v1/channels?slug=${slug}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      }
    });

    if (response.data && response.data.length > 0) {
      const channel = response.data[0];
      
      // Calculate account age
      const createdDate = new Date(channel.created_at);
      const currentDate = new Date();
      const accountAge = Math.floor((currentDate - createdDate) / (1000 * 60 * 60 * 24));
      
      // Prepare response
      const userInfo = {
        username: channel.user.username,
        slug: channel.slug,
        followers: channel.followers_count,
        profile_image: channel.user.profile_pic,
        banner_image: channel.user.banner_image,
        bio: channel.user.bio,
        channel_created: channel.created_at,
        account_age_days: accountAge,
        verified: channel.verified,
        is_banned: channel.user.is_banned,
        playback_url: channel.playback_url,
        livestream: channel.livestream
      };
      
      res.json(userInfo);
    } else {
      res.status(404).json({ error: 'User not found' });
    }
  } catch (error) {
    console.error('Error fetching Kick user data:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to fetch user data' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'Kick Age Checker API is running' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
