const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Root route - Essential for Render health checks
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    message: 'Kick API Backend is running',
    endpoints: {
      userLookup: '/api/kick?slug=USERNAME',
      example: '/api/kick?slug=mrbeast'
    }
  });
});

// Health check route
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Main API endpoint
app.get('/api/kick', async (req, res) => {
  const { slug } = req.query;
  
  if (!slug) {
    return res.status(400).json({ 
      error: 'Slug parameter is required',
      example: '/api/kick?slug=mrbeast'
    });
  }

  try {
    // First try the v2 API
    const v2Response = await axios.get(`https://kick.com/api/v2/channels/${slug}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      },
      timeout: 5000
    });

    const userData = v2Response.data;
    
    if (!userData || !userData.user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      username: userData.slug,
      display_name: userData.user.username,
      description: userData.user.bio || 'No description',
      avatar: userData.user.profile_pic || 'https://via.placeholder.com/150',
      verified: userData.verified === true,
      followers: userData.followers_count || 0,
      user_id: userData.user.id,
      channel_id: userData.id,
      created_at: userData.chatroom?.created_at || null,
      age_days: userData.chatroom?.created_at ? 
        Math.floor((new Date() - new Date(userData.chatroom.created_at)) / (1000 * 60 * 60 * 24)) : 
        null,
      is_live: !!userData.livestream,
      stream_title: userData.livestream?.session_title || null,
      is_banned: userData.is_banned === true,
      visit_profile: `https://kick.com/${userData.slug}`
    });

  } catch (error) {
    console.error('API Error:', error.message);
    res.status(500).json({ 
      error: 'Failed to fetch data',
      details: error.response?.data || error.message 
    });
  }
});

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`Try: http://localhost:${port}/api/kick?slug=mrbeast`);
});
