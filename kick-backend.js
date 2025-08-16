const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Enhanced fetcher with both user and channel endpoints
async function fetchKickUserData(slug) {
    try {
        // First get the user ID from channel endpoint
        const channelRes = await axios.get(`https://api.kick.com/public/v1/channels/${slug}`);
        const channelData = channelRes.data;
        
        if (!channelData || !channelData.user) {
            throw new Error('Channel not found');
        }

        // Then get detailed user info
        const userRes = await axios.get(`https://api.kick.com/public/v1/users/${channelData.user.id}`);
        const userData = userRes.data;

        return {
            // From channel endpoint
            username: channelData.slug,
            display_name: channelData.user.username,
            followers: channelData.followers_count,
            is_live: channelData.livestream?.is_live || false,
            stream_title: channelData.livestream?.session_title || null,
            created_at: channelData.created_at,
            
            // From user endpoint
            description: userData.bio,
            verified: userData.verified,
            avatar: userData.profile_pic,
            user_id: userData.id,
            is_banned: userData.is_banned
        };

    } catch (error) {
        console.error('API Error:', error.message);
        return null;
    }
}

// Main endpoint
app.get('/api/kick', async (req, res) => {
    const { slug } = req.query;
    
    if (!slug) {
        return res.status(400).json({ error: 'Slug parameter is required' });
    }

    try {
        const data = await fetchKickUserData(slug);
        
        if (!data) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({
            username: data.username,
            display_name: data.display_name,
            description: data.description || 'No description',
            avatar: data.avatar || 'https://via.placeholder.com/150',
            verified: data.verified,
            followers: data.followers || 0,
            user_id: data.user_id,
            channel_created: data.created_at ? new Date(data.created_at).toISOString() : null,
            age_days: data.created_at ? 
                Math.floor((new Date() - new Date(data.created_at)) / (1000 * 60 * 60 * 24)) : 
                null,
            is_live: data.is_live,
            stream_title: data.stream_title,
            visit_profile: `https://kick.com/${data.username}`
        });

    } catch (error) {
        res.status(500).json({ 
            error: 'Failed to fetch data',
            details: error.message 
        });
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
