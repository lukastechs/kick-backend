const express = require('express');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Configuration
const cacheDir = path.join(__dirname, 'cache', 'kick');
const ttl = 172800; // 48 hours in seconds
const clientId = process.env.KICK_CLIENT_ID || '01K2NS71Z9WNS3VK0C18XS5S1Q';
const clientSecret = process.env.KICK_CLIENT_SECRET || '08d2dd793f06e740656003612f903408610e7637f2f21d9cf7f6ef930b163b23';

// Middleware
app.use(cors());
app.use(express.json());

// Ensure cache directory exists
async function ensureCacheDir() {
    try {
        await fs.mkdir(cacheDir, { recursive: true });
    } catch (error) {
        console.error('Failed to create cache directory:', error.message);
        throw new Error('Internal server error');
    }
}

// Sanitize filename
function sanitizeFilename(username) {
    return username.replace(/[^a-zA-Z0-9_-]/g, '');
}

// Validate username format
function isValidUsername(username) {
    return /^[a-zA-Z0-9_-]{1,20}$/.test(username);
}

// Calculate account age
function calculateAccountAge(createdAt) {
    const now = new Date();
    const created = new Date(createdAt);
    const diffMs = now - created;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const years = Math.floor(diffDays / 365);
    const months = Math.floor((diffDays % 365) / 30);
    return years > 0 ? `${years} years, ${months} months` : `${months} months`;
}

// Calculate age in days
function calculateAgeDays(createdAt) {
    const now = new Date();
    const created = new Date(createdAt);
    const diffMs = now - created;
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

// Generate Kick Access Token
async function getKickAccessToken() {
    try {
        const response = await axios.post('https://kick.com/api/v1/auth/refresh', {
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: 'client_credentials'
        }, {
            headers: { 
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'application/json',
                'Origin': 'https://kick.com',
                'Referer': 'https://kick.com/'
            },
            timeout: 5000
        });

        return response.data.access_token;
    } catch (error) {
        console.error('Kick Token Error:', error.response?.data || error.message);
        throw new Error('Failed to generate Kick access token');
    }
}

// Check cache
async function checkCache(username) {
    const cacheFile = path.join(cacheDir, `${sanitizeFilename(username)}.json`);
    try {
        if (await fs.access(cacheFile).then(() => true).catch(() => false)) {
            const cacheContent = await fs.readFile(cacheFile, 'utf-8');
            const cacheData = JSON.parse(cacheContent);
            if (cacheData && cacheData.timestamp && (Math.floor(Date.now() / 1000) - cacheData.timestamp < ttl) {
                return { data: cacheData.data, cached: true };
            }
            await fs.unlink(cacheFile);
        }
    } catch (error) {
        console.error(`Cache check error: ${error.message}`);
    }
    return { cached: false };
}

// Save to cache
async function saveToCache(username, data) {
    const cacheFile = path.join(cacheDir, `${sanitizeFilename(username)}.json`);
    try {
        await fs.writeFile(cacheFile, JSON.stringify({
            timestamp: Math.floor(Date.now() / 1000),
            data
        }, null, 2));
    } catch (error) {
        console.error(`Failed to save cache: ${error.message}`);
    }
}

// Kick age checker endpoint
app.get('/api/kick/:username', async (req, res) => {
    const { username } = req.params;
    
    if (!username || !isValidUsername(username)) {
        return res.status(400).json({ error: 'Invalid username format' });
    }

    try {
        await ensureCacheDir();
        const cacheResult = await checkCache(username.toLowerCase());
        if (cacheResult.cached) {
            return res.json({ data: cacheResult.data, cached: true });
        }

        const token = await getKickAccessToken();
        
        const response = await axios.get('https://api.kick.com/public/v1/channels', {
            params: { slug: username },
            headers: {
                'Client-ID': clientId,
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            },
            timeout: 5000
        });

        if (!response.data.data || response.data.data.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const user = response.data.data[0];
        const kickData = {
            username: user.slug,
            nickname: user.user?.username || user.slug,
            estimated_creation_date: new Date(user.created_at).toLocaleDateString(),
            account_age: calculateAccountAge(user.created_at),
            age_days: calculateAgeDays(user.created_at),
            followers: user.followers_count || 0,
            verified: user.verified ? 'Yes' : 'No',
            description: user.bio || 'N/A',
            user_id: user.id || 'N/A',
            avatar: user.profile_pic || 'https://via.placeholder.com/50',
            visit_profile: `https://kick.com/${user.slug}`
        };

        await saveToCache(username.toLowerCase(), kickData);
        res.json({ data: kickData, cached: false });

    } catch (error) {
        console.error('API Error:', error.message);
        
        if (error.response?.status === 404) {
            return res.status(404).json({ error: 'User not found' });
        }
        if (error.response?.status === 429) {
            return res.status(429).json({ error: 'Rate limit exceeded' });
        }
        
        res.status(500).json({ 
            error: 'Failed to fetch data',
            details: error.response?.data?.error || error.message 
        });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
