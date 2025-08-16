const express = require('express');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Configuration
const cacheDir = path.join(__dirname, 'cache', 'kick');
const ttl = 172800; // 48 hours in seconds

// Middleware
app.use(cors());
app.use(express.json());

// Helper Functions
async function ensureCacheDir() {
    try {
        await fs.mkdir(cacheDir, { recursive: true });
    } catch (error) {
        console.error('Failed to create cache directory:', error.message);
    }
}

function sanitizeFilename(username) {
    return username.replace(/[^a-zA-Z0-9_-]/g, '');
}

function isValidUsername(username) {
    return /^[a-zA-Z0-9_-]{1,20}$/.test(username);
}

function calculateAccountAge(createdAt) {
    const now = new Date();
    const created = new Date(createdAt);
    const diffMs = now - created;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const years = Math.floor(diffDays / 365);
    const months = Math.floor((diffDays % 365) / 30);
    return years > 0 ? `${years} years, ${months} months` : `${months} months`;
}

function calculateAgeDays(createdAt) {
    const now = new Date();
    const created = new Date(createdAt);
    const diffMs = now - created;
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

async function checkCache(username) {
    const cacheFile = path.join(cacheDir, `${sanitizeFilename(username)}.json`);
    try {
        if (await fs.access(cacheFile).then(() => true).catch(() => false)) {
            const cacheContent = await fs.readFile(cacheFile, 'utf-8');
            const cacheData = JSON.parse(cacheContent);
            if (cacheData && cacheData.timestamp && (Math.floor(Date.now() / 1000) - cacheData.timestamp < ttl)) {
                return { data: cacheData.data, cached: true };
            }
            await fs.unlink(cacheFile);
        }
    } catch (error) {
        console.error('Cache check error:', error.message);
    }
    return { cached: false };
}

async function saveToCache(username, data) {
    const cacheFile = path.join(cacheDir, `${sanitizeFilename(username)}.json`);
    try {
        await fs.writeFile(cacheFile, JSON.stringify({
            timestamp: Math.floor(Date.now() / 1000),
            data
        }, null, 2));
    } catch (error) {
        console.error('Failed to save cache:', error.message);
    }
}

// Routes
app.get('/', (req, res) => {
    res.send('Kick Account Age Checker API is running');
});

app.get('/api/kick', async (req, res) => {
    const { slug, broadcaster_user_id } = req.query;
    
    if (!slug && !broadcaster_user_id) {
        return res.status(400).json({ error: 'Either slug or broadcaster_user_id is required' });
    }

    try {
        await ensureCacheDir();
        const cacheKey = slug ? slug.toLowerCase() : broadcaster_user_id;
        const cacheResult = await checkCache(cacheKey);
        if (cacheResult.cached) {
            return res.json({ data: cacheResult.data, cached: true });
        }

        // Public API call - no authentication needed
        const response = await axios.get('https://api.kick.com/public/v1/channels', {
            params: {
                slug: slug || undefined,
                broadcaster_user_id: broadcaster_user_id || undefined
            },
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
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

        await saveToCache(cacheKey, kickData);
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
            details: error.message 
        });
    }
});

app.get('/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Start server
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    ensureCacheDir().catch(console.error);
});
