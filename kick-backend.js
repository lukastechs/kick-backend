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

// Shared handler function for Kick API requests
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

        // Try different Kick API endpoints
        let response;
        let user;

        try {
            // First, try the direct channel endpoint with slug
            if (slug) {
                console.log(`Trying direct channel endpoint for slug: ${slug}`);
                response = await axios.get(`https://kick.com/api/v2/channels/${slug}`, {
                    headers: {
                        'Accept': 'application/json',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                        'Referer': 'https://kick.com/',
                        'Origin': 'https://kick.com'
                    },
                    timeout: 10000
                });
                user = response.data;
            } else if (broadcaster_user_id) {
                // If we have broadcaster_user_id, we need to find the channel first
                console.log(`Trying to find channel for broadcaster_user_id: ${broadcaster_user_id}`);
                response = await axios.get(`https://kick.com/api/v1/channels/${broadcaster_user_id}`, {
                    headers: {
                        'Accept': 'application/json',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                        'Referer': 'https://kick.com/',
                        'Origin': 'https://kick.com'
                    },
                    timeout: 10000
                });
                user = response.data;
            }
        } catch (firstError) {
            console.log('First attempt failed, trying fallback endpoints:', firstError.message);
            
            try {
                // Fallback: Try the private API endpoint (sometimes works without auth)
                if (slug) {
                    console.log(`Trying private API endpoint for slug: ${slug}`);
                    response = await axios.get(`https://api.kick.com/private/v1/channels/${slug}`, {
                        headers: {
                            'Accept': 'application/json',
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                            'Referer': 'https://kick.com/',
                            'Origin': 'https://kick.com'
                        },
                        timeout: 10000
                    });
                    user = response.data;
                }
            } catch (secondError) {
                console.log('Second attempt failed, trying final fallback:', secondError.message);
                
                try {
                    // Final fallback: Try scraping the page directly
                    console.log(`Trying page scraping for slug: ${slug || broadcaster_user_id}`);
                    response = await axios.get(`https://kick.com/${slug || broadcaster_user_id}`, {
                        headers: {
                            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                        },
                        timeout: 10000
                    });
                    
                    // Extract channel data from HTML
                    const htmlContent = response.data;
                    const channelDataMatch = htmlContent.match(/window\.__INITIAL_STATE__\s*=\s*({.*?});/s);
                    
                    if (channelDataMatch) {
                        const initialState = JSON.parse(channelDataMatch[1]);
                        user = initialState.channel?.data || initialState.channel;
                    } else {
                        throw new Error('Could not extract channel data from page');
                    }
                } catch (finalError) {
                    if (finalError.response?.status === 404) {
                        return res.status(404).json({ error: `User ${slug || broadcaster_user_id} not found` });
                    }
                    throw finalError;
                }
            }
        }
        } catch (error) {
            if (error.response?.status === 404) {
                return res.status(404).json({ error: `User ${slug || broadcaster_user_id} not found` });
            }
            throw error;
        }

        // Handle the response data structure
        if (!user) {
            return res.status(404).json({ error: `User ${slug || broadcaster_user_id} not found` });
        }

        // Ensure we have the created_at field
        if (!user.created_at && !user.user?.created_at) {
            return res.status(404).json({ error: `Account creation date not available for ${slug || broadcaster_user_id}` });
        }

        const createdAt = user.created_at || user.user?.created_at;

        const kickData = {
            username: user.user?.username || user.slug || (slug || broadcaster_user_id),
            nickname: user.user?.display_name || user.user?.username || user.slug || (slug || broadcaster_user_id),
            estimated_creation_date: new Date(createdAt).toLocaleDateString(),
            account_age: calculateAccountAge(createdAt),
            age_days: calculateAgeDays(createdAt),
            followers: user.followers_count || 0,
            verified: user.verified ? 'Yes' : 'No',
            description: user.bio || user.user?.bio || 'N/A',
            user_id: user.id || user.user?.id || 'N/A',
            avatar: user.profilepic || user.user?.profile_pic || 'https://via.placeholder.com/50',
            estimation_confidence: 'High',
            accuracy_range: 'Exact',
            visit_profile: `https://kick.com/${user.slug || slug || broadcaster_user_id}`
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
        res.status(error.response?.status || 500).json({
            error: 'Failed to fetch Kick data',
            details: error.message || 'No additional details'
        });
    }
}

// Root endpoint
app.get('/', (req, res) => {
    res.send('Kick Account Age Checker API is running');
});

// Path parameter route: /api/kick/username
app.get('/api/kick/:username', async (req, res) => {
    const username = req.params.username;
    
    // Validate username
    if (!isValidUsername(username)) {
        return res.status(400).json({ error: 'Invalid username format' });
    }
    
    // Set slug as query parameter and call the shared handler
    req.query.slug = username;
    return handleKickRequest(req, res);
});

// Query parameter route: /api/kick?slug=username or /api/kick?broadcaster_user_id=123
app.get('/api/kick', (req, res) => {
    return handleKickRequest(req, res);
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.listen(port, () => {
    console.log(`Kick Server running on port ${port}`);
});
