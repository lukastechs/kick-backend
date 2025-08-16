const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Enhanced API fetcher with proper headers
async function fetchKickUserData(slug) {
    try {
        // First try the new API endpoint
        const apiResponse = await axios.get(`https://kick.com/api/v2/channels/${slug}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
                'Accept': 'application/json',
                'Referer': `https://kick.com/${slug}`,
                'Origin': 'https://kick.com'
            },
            timeout: 5000
        });

        const userData = apiResponse.data;
        
        // If we got good data, return it
        if (userData && userData.user) {
            return {
                id: userData.id,
                user_id: userData.user.id,
                username: userData.slug,
                display_name: userData.user.username,
                description: userData.user.bio,
                avatar: userData.user.profile_pic,
                verified: userData.verified,
                followers: userData.followers_count,
                is_banned: userData.is_banned,
                created_at: userData.chatroom?.created_at,
                livestream: userData.livestream
            };
        }

        // Fallback to the legacy API if needed
        const legacyResponse = await axios.get(`https://kick.com/api/v1/channels/${slug}`);
        if (legacyResponse.data) {
            return {
                id: legacyResponse.data.id,
                user_id: legacyResponse.data.user_id,
                username: legacyResponse.data.slug,
                display_name: legacyResponse.data.user?.username,
                description: legacyResponse.data.user?.bio,
                avatar: legacyResponse.data.user?.profile_pic,
                verified: legacyResponse.data.verified,
                followers: legacyResponse.data.followers_count,
                is_banned: legacyResponse.data.is_banned,
                created_at: legacyResponse.data.created_at
            };
        }

        return null;
    } catch (error) {
        console.error('Error fetching Kick data:', error.message);
        return null;
    }
}

// Improved date formatting
function formatCreationDate(dateString) {
    if (!dateString) return 'Unknown';
    const date = new Date(dateString);
    return isNaN(date.getTime()) ? 'Unknown' : date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

// Main API endpoint
app.get('/api/kick', async (req, res) => {
    const { slug } = req.query;
    
    if (!slug) {
        return res.status(400).json({ error: 'Slug parameter is required' });
    }

    try {
        const userData = await fetchKickUserData(slug);
        
        if (!userData) {
            return res.status(404).json({ error: 'User not found' });
        }

        const responseData = {
            username: userData.username,
            display_name: userData.display_name || userData.username,
            description: userData.description || 'No description',
            avatar: userData.avatar || 'https://via.placeholder.com/150',
            verified: userData.verified === true,
            followers: userData.followers || 0,
            channel_id: userData.id,
            user_id: userData.user_id,
            is_banned: userData.is_banned === true,
            channel_created: formatCreationDate(userData.created_at),
            age_days: userData.created_at ? 
                Math.floor((new Date() - new Date(userData.created_at)) / (1000 * 60 * 60 * 24)) : 
                null,
            is_live: !!userData.livestream,
            stream_title: userData.livestream?.session_title || null,
            visit_profile: `https://kick.com/${userData.username}`
        };

        res.json(responseData);
    } catch (error) {
        console.error('API Error:', error.message);
        res.status(500).json({ 
            error: 'Failed to fetch data',
            details: error.message 
        });
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
