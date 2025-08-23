const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware for CORS and JSON handling
app.use(express.json());

// Helper function to calculate account age in human-readable format
function calculateAccountAge(createdAt) {
  const now = new Date();
  const created = new Date(createdAt);
  const diffMs = now - created;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const years = Math.floor(diffDays / 365);
  const months = Math.floor((diffDays % 365) / 30);
  return years > 0 ? `${years} years, ${months} months` : `${months} months`;
}

// Helper function to format the creation date in "Month Day, Year" format
function formatDate(date) {
  const options = { year: 'numeric', month: 'long', day: 'numeric' };
  return new Date(date).toLocaleDateString('en-US', options);
}

// Route to handle Kick profile fetch by slug
app.get('/kick-profile', async (req, res) => {
  const { slug } = req.query;

  if (!slug) {
    return res.status(400).json({ error: 'Slug (username) is required.' });
  }

  try {
    // Make API call to get profile data from Kick API
    const response = await axios.get('https://api.kick.com/public/v1/channels', {
      params: { slug },
      headers: {
        'Authorization': `Bearer ${process.env.KICK_ACCESS_TOKEN}`,
        'Accept': '*/*'
      }
    });

    const data = response.data.data[0];

    if (!data) {
      return res.status(404).json({ error: `Profile for slug ${slug} not found.` });
    }

    // Extracting and formatting data
    res.json({
      profile_image: data.banner_picture || null,  // Profile image or banner
      channel_slug: data.slug,
      description: data.channel_description || 'N/A',
      stream_title: data.stream.stream_title || 'No Title',
      stream_is_live: data.stream.is_live ? 'Yes' : 'No',
      channel_created: formatDate(data.stream.start_time),  // Formatted creation date
      account_age: calculateAccountAge(data.stream.start_time),  // Account age in years and months
      followers: data.stream.viewer_count || 0,  // Follower count (viewers for now)
      verification_status: data.category.name || 'Not Verified',  // Assuming the category name indicates verification status
    });

  } catch (error) {
    console.error('Error fetching profile:', error);
    res.status(500).json({ error: 'Failed to fetch profile.', details: error.message });
  }
});

// Root endpoint for checking if the server is running
app.get('/', (req, res) => {
  res.send('Kick Profile Backend is up and running!');
});

// Start the server
app.listen(port, () => {
  console.log(`Kick Profile API backend running on port ${port}`);
});
