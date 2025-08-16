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

// Debug environment variables
console.log('Environment:', { clientId, clientSecret, port });

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
            client_id: clientId,
            client_secret: clientSecret,
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

// Kick age checker endpoint
app.get('/api/kick/:username', async (req, res) => {
    const { username } = req.params;
    if (!username) {
        return res.status(400).json({ error: 'Username is required' });
    }
    if (!isValidUsername(username)) {
        return res.status(400).json({ 
            error: 'Invalid username format. Use 1-20 characters (letters, numbers, underscores, or hyphens)' 
        });
    }

    try {
        await ensureCacheDir();

        // Check cache
        const cacheResult = await checkCache(username.toLowerCase()); // Normalize to lowercase for cache
        if (cacheResult.cached) {
            return res.json({ data: cacheResult.data, cached: true });
        }

        // Fetch access token
        const token = await getKickAccessToken();

        // Fetch from Kick API (try original case first)
        let response;
        try {
            response = await axios.get(`https://api.kick.com/public/v1/channels/${encodeURIComponent(username)}`, {
                headers: {
                    'Client-ID': clientId,
                    'Authorization': `Bearer ${token}`,
                    'Accept': '*/*'
                },
                timeout: 5000
            });
        } catch (error) {
            if (error.response?.status === 404) {
                // Retry with lowercase username
                console.log(`Retrying with lowercase username: ${username.toLowerCase()}`);
                response = await axios.get(`https://api.kick.com/public/v1/channels/${encodeURIComponent(username.toLowerCase())}`, {
                    headers: {
                        'Client-ID': clientId,
                        'Authorization': `Bearer ${token}`,
                        'Accept': '*/*'
                    },
                    timeout: 5000
                });
            } else {
                throw error; // Rethrow non-404 errors
            }
        }

        const user = response.data;
        if (!user || !user.created_at) {
            return res.status(404).json({ error: `User ${username} not found` });
        }

        const kickData = {
            username: user.user?.username || username,
            nickname: user.user?.display_name || user.user?.username || username,
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
            visit_profile: `https://kick.com/${username}`
        };

        // Save to cache (use lowercase username for consistency)
        await saveToCache(username.toLowerCase(), kickData);

        res.json({ data: kickData, cached: false });
    } catch (error) {
        console.error('Kick API Error:', {
            username,
            status: error.response?.status,
            data: error.response?.data,
            message: error.message,
            headers: error.config?.headers,
            url: error.config?.url
        });
        if (error.response?.status === 404) {
            return res.status(404).json({ error: `User ${username} not found` });
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
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.listen(port, () => {
    console.log(`Kick Server running on port ${port}`);
});
