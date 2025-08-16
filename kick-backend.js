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

// Sanitize filename (preserve case, remove invalid characters)
function sanitizeFilename(username) {
    return username.replace(/[^a-zA-Z0-9_-]/g, '');
}

// Validate username format (1-20 characters, letters, numbers, underscores, hyphens)
function isValidUsername(username) {
    return /^[a-zA-Z0-9_-]{1,20}$/.test(username);
}

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
        const response = await axios.post('https://id.kick.com/oauth/token', {
            client_id: process.env.KICK_CLIENT_ID,
            client_secret: process.env.KICK_CLIENT_SECRET,
            grant_type: 'client_credentials'
        }, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 5000
        });

        const { access_token, expires_in } = response.data;
        console.log('Fetched new Kick access token');
        return access_token;
    } catch (error) {
        console.error('Kick Token Error:', {
            status: error.response?.status,
            data: error.response?.data,
            message: error.message,
            headers: error.config?.headers,
            url: error.config?.url
        });
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
            if (cacheData && cacheData.timestamp && (Math.floor(Date.now() / 1000) - cacheData.timestamp) < ttl) {
                console.log(`Cache hit for username: ${username}`);
                return { data: cacheData.data, cached: true };
            } else {
                console.log(`Cache expired or invalid for username: ${username}`);
                await fs.unlink(cacheFile).catch(err => console.error(`Failed to delete expired cache file: ${cacheFile}`, err.message));
            }
        }
    } catch (error) {
        console.error(`Cache check error for username: ${username}`, error.message);
    }
    return { cached: false };
}

// Save to cache
async function saveToCache(username, data) {
    const cacheFile = path.join(cacheDir, `${sanitizeFilename(username)}.json`);
    const cacheData = {
        timestamp: Math.floor(Date.now() / 1000),
        data
    };
    try {
        await fs.writeFile(cacheFile, JSON.stringify(cacheData, null, 2));
        console.log(`Cache file saved for username: ${username}`);
    } catch (error) {
        console.error(`Failed to save cache file: ${cacheFile}`, error.message);
    }
}

// Root endpoint
app.get('/', (req, res) => {
    res.send('Kick Account Age Checker API is running');
});

/ This handles the path parameter format: /api/kick/username
app.get('/api/kick/:username', async (req, res) => {
    const username = req.params.username;
    
    // Validate username
    if (!isValidUsername(username)) {
        return res.status(400).json({ error: 'Invalid username format' });
    }
    
    // Redirect to the main handler with slug as query parameter
    req.query.slug = username;
    return handleKickRequest(req, res);
});

// Refactor your existing /api/kick route to use a shared handler
app.get('/api/kick', (req, res) => {
    return handleKickRequest(req, res);
});

// Shared handler function (extract your existing logic into this function)
async function handleKickRequest(req, res) {
    const { slug, broadcaster_user_id } = req.query;
    if (!slug && !broadcaster_user_id) {
        return res.status(400).json({ error: 'Either slug or broadcaster_user_id is required' });
    }

    try {
        await ensureCacheDir();

        // Check cache
        const cacheKey = slug ? slug.toLowerCase() : broadcaster_user_id;
        const cacheResult = await checkCache(cacheKey);
        if (cacheResult.cached) {
            return res.json({ data: cacheResult.data, cached: true });
        }

        // Fetch access token
        const token = await getKickAccessToken();

        // Fetch from Kick API
        let response;
        const params = {};
        if (slug) params.slug = slug;
        if (broadcaster_user_id) params.broadcaster_user_id = broadcaster_user_id;

        try {
            response = await axios.get('https://api.kick.com/public/v1/channels', {
                headers: {
                    'Client-ID': process.env.KICK_CLIENT_ID,
                    'Authorization': `Bearer ${token}`,
                    'Accept': '*/*'
                },
                params: params,
                timeout: 5000
            });
        } catch (error) {
            if (error.response?.status === 404) {
                return res.status(404).json({ error: `User ${slug || broadcaster_user_id} not found` });
            }
            throw error;
        }

        const user = response.data.data[0]; // Assuming the response returns an array under 'data'
        if (!user || !user.created_at) {
            return res.status(404).json({ error: `User ${slug || broadcaster_user_id} not found` });
        }

        const kickData = {
            username: user.user?.username || (slug || broadcaster_user_id),
            nickname: user.user?.display_name || user.user?.username || (slug || broadcaster_user_id),
            estimated_creation_date: new Date(user.created_at).toLocaleDateString(),
            account_age: calculateAccountAge(user.created_at),
            age_days: calculateAgeDays(user.created_at),
            followers: user.followers_count || 0,
            verified: user.verified ? 'Yes' : 'No',
            description: user.bio || 'N/A',
            user_id: user.id || user.user?.id || 'N/A',
            avatar: user.profilepic || 'https://via.placeholder.com/50',
            estimation_confidence: 'High',
            accuracy_range: 'Exact',
            visit_profile: `https://kick.com/${slug || broadcaster_user_id}`
        };

        // Save to cache
        await saveToCache(cacheKey, kickData);

        res.json({ data: kickData, cached: false });
    } catch (error) {
        console.error('Kick API Error:', {
            slug,
            broadcaster_user_id,
            status: error.response?.status,
            data: error.response?.data,
            message: error.message
        });
        if (error.response?.status === 404) {
            return res.status(404).json({ error: `User ${slug || broadcaster_user_id} not found` });
        }
        if (error.response?.status === 429) {
            return res.status(429).json({ error: 'Rate limit exceeded. Please wait a few minutes and try again.' });
        }
        if (error.response?.status === 401) {
            return res.status(401).json({ error: 'Invalid or missing API token' });
        }
        res.status(error.response?.status || 500).json({
            error: 'Failed to fetch Kick data',
            details: error.message || 'No additional details'
        });
    }
}

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.listen(port, () => {
    console.log(`Kick Server running on port ${port}`);
});
