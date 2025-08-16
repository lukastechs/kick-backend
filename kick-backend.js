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
const ttlSeconds = 60 * 60 * 48; // 48 hours

// Middleware
app.use(cors());
app.use(express.json());

// -------------------------------
// Utilities
// -------------------------------
async function ensureCacheDir() {
  try {
    await fs.mkdir(cacheDir, { recursive: true });
  } catch (error) {
    console.error('Failed to create cache directory:', error.message);
    throw new Error('Internal server error');
  }
}

function sanitizeFilename(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '');
}

function isValidSlug(value) {
  return /^[a-zA-Z0-9_-]{1,25}$/.test(String(value));
}

function calculateAccountAge(createdAt) {
  if (!createdAt) return 'Unknown';
  const now = new Date();
  const created = new Date(createdAt);
  if (isNaN(created.getTime())) return 'Unknown';
  const diffMs = now - created;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const years = Math.floor(diffDays / 365);
  const months = Math.floor((diffDays % 365) / 30);
  return years > 0 ? `${years} years, ${months} months` : `${months} months`;
}

function calculateAgeDays(createdAt) {
  if (!createdAt) return null;
  const now = new Date();
  const created = new Date(createdAt);
  if (isNaN(created.getTime())) return null;
  const diffMs = now - created;
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

function toLocalDateString(dateLike) {
  if (!dateLike) return 'Unknown';
  const d = new Date(dateLike);
  if (isNaN(d.getTime())) return 'Unknown';
  return d.toLocaleDateString();
}

// -------------------------------
// Token cache for Kick OAuth (v1 API)
// -------------------------------
let tokenCache = {
  accessToken: null,
  expiresAt: 0,
};

async function getKickAccessToken() {
  if (tokenCache.accessToken && Date.now() < tokenCache.expiresAt) {
    return tokenCache.accessToken;
  }

  if (!process.env.KICK_CLIENT_ID || !process.env.KICK_CLIENT_SECRET) {
    console.warn('KICK_CLIENT_ID or KICK_CLIENT_SECRET missing. v1 calls will be skipped.');
    return null;
  }

  try {
    const form = new URLSearchParams();
    form.append('client_id', process.env.KICK_CLIENT_ID);
    form.append('client_secret', process.env.KICK_CLIENT_SECRET);
    form.append('grant_type', 'client_credentials');

    const resp = await axios.post('https://id.kick.com/oauth/token', form.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 7000,
    });

    const { access_token, expires_in } = resp.data || {};
    if (!access_token) throw new Error('No access_token in OAuth response');

    tokenCache.accessToken = access_token;
    tokenCache.expiresAt = Date.now() + Math.max(0, (Number(expires_in) - 60)) * 1000;

    console.log('Fetched new Kick access token');
    return tokenCache.accessToken;
  } catch (error) {
    console.error('Kick OAuth Error:', {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message,
    });
    return null;
  }
}

// -------------------------------
// Disk cache helpers
// -------------------------------
async function readCache(key) {
  const file = path.join(cacheDir, `${sanitizeFilename(key)}.json`);
  try {
    const exists = await fs.access(file).then(() => true).catch(() => false);
    if (!exists) return null;
    const raw = await fs.readFile(file, 'utf8');
    const json = JSON.parse(raw);
    if (json && json.timestamp && Math.floor(Date.now() / 1000) - json.timestamp < ttlSeconds) {
      return json.data;
    }
    await fs.unlink(file).catch(() => {});
    return null;
  } catch (err) {
    console.error('readCache error:', err.message);
    return null;
  }
}

async function writeCache(key, data) {
  const file = path.join(cacheDir, `${sanitizeFilename(key)}.json`);
  const payload = { timestamp: Math.floor(Date.now() / 1000), data };
  try {
    await fs.writeFile(file, JSON.stringify(payload, null, 2));
  } catch (err) {
    console.error('writeCache error:', err.message);
  }
}

// -------------------------------
// Kick API calls
// -------------------------------
async function fetchChannelPublicV1({ slug, broadcasterUserId, token }) {
  if (!token) return null;

  const params = {};
  if (slug) params.slug = slug;
  if (broadcasterUserId) params.broadcaster_user_id = broadcasterUserId;

  try {
    const resp = await axios.get('https://api.kick.com/public/v1/channels', {
      params,
      headers: { Authorization: `Bearer ${token}` },
      timeout: 7000,
    });
    const arr = resp.data?.data;
    return Array.isArray(arr) && arr.length ? arr[0] : null;
  } catch (error) {
    console.error('Public v1 /channels error:', {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message,
    });
    return null;
  }
}

async function fetchChannelV2BySlug(slug) {
  try {
    const res = await axios.get(`https://kick.com/api/v2/channels/${slug}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': `https://kick.com/${slug}`,
        'Origin': 'https://kick.com'
      },
      timeout: 7000
    });
    return res.data;
  } catch (err) {
    console.error("v2 /channels/{slug} error:", {
      status: err.response?.status,
      data: err.response?.data,
      message: err.message,
    });
    return null;
  }
}

// -------------------------------
// Core handler
// -------------------------------
async function handleKickRequest(req, res) {
  const { slug: rawSlug, broadcaster_user_id: rawBroadcasterUserId } = req.query;

  const slug = rawSlug ? String(rawSlug).trim() : null;
  const broadcasterUserId = rawBroadcasterUserId ? String(rawBroadcasterUserId).trim() : null;

  if (!slug && !broadcasterUserId) {
    return res.status(400).json({ error: 'Either slug or broadcaster_user_id is required' });
  }

  if (slug && !isValidSlug(slug)) {
    return res.status(400).json({ error: 'Invalid slug format' });
  }

  try {
    await ensureCacheDir();
    const cacheKey = (slug || broadcasterUserId).toLowerCase();
    const cached = await readCache(cacheKey);
    if (cached) {
      return res.json({ data: cached, cached: true });
    }

    const token = await getKickAccessToken();
    let resolvedSlug = slug || null;
    let v1 = null;

    if (!resolvedSlug && broadcasterUserId) {
      v1 = await fetchChannelPublicV1({ slug: null, broadcasterUserId, token });
      if (!v1 || !v1.slug) {
        return res.status(404).json({ error: `User ${broadcasterUserId} not found` });
      }
      resolvedSlug = v1.slug;
    }

    if (!resolvedSlug) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    const v2 = await fetchChannelV2BySlug(resolvedSlug);

    if (!v1) {
      v1 = await fetchChannelPublicV1({ slug: resolvedSlug, broadcasterUserId: null, token });
    }

    if (!v2 && !v1) {
      return res.status(404).json({ error: `User ${resolvedSlug} not found` });
    }

    const createdAt = v2?.chatroom?.created_at || null;
    const ageDays = calculateAgeDays(createdAt);

    const data = {
      slug: resolvedSlug,
      channel_id: v2?.id ?? null,
      user_id: v2?.user_id ?? null,
      username: v2?.user?.username ?? resolvedSlug,
      description: v2?.user?.bio ?? v1?.channel_description ?? null,
      avatar: v2?.user?.profile_pic ?? null,
      verified: v2?.verified === true,
      followers: typeof v2?.followers_count === 'number' ? v2.followers_count : null,
      is_banned: v2?.is_banned === true,
      category: v1?.category?.name ?? (Array.isArray(v2?.recent_categories) && v2.recent_categories.length ? v2.recent_categories[0].name : null),
      is_live: typeof v1?.stream?.is_live === 'boolean' ? v1.stream.is_live : Boolean(v2?.livestream),
      stream_title: v1?.stream_title ?? v2?.livestream?.session_title ?? null,
      channel_created_at: createdAt,
      estimated_creation_date: toLocalDateString(createdAt),
      account_age: calculateAccountAge(createdAt),
      age_days: ageDays,
      estimation_confidence: createdAt ? 'High (derived from chatroom.created_at)' : 'Unknown',
      accuracy_range: createdAt ? 'Exact (channel chatroom creation)' : 'Unknown',
      visit_profile: `https://kick.com/${resolvedSlug}`,
    };

    await writeCache(cacheKey, data);
    return res.json({ data, cached: false });
  } catch (error) {
    console.error('Kick API Error (handler):', {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message,
    });

    if (error.response?.status === 429) {
      return res.status(429).json({ error: 'Rate limit exceeded. Please wait a few minutes and try again.' });
    }
    if (error.response?.status === 401) {
      return res.status(401).json({ error: 'Invalid or missing API token' });
    }

    return res.status(500).json({ error: 'Failed to fetch Kick data', details: error.message || 'No additional details' });
  }
}

// -------------------------------
// Routes
// -------------------------------
app.get('/', (req, res) => {
  res.send('Kick Account Age Checker API is running');
});

app.get('/api/kick/:username', async (req, res) => {
  const username = String(req.params.username || '').trim();
  if (!username) return res.status(400).json({ error: 'Missing username' });
  if (!isValidSlug(username)) return res.status(400).json({ error: 'Invalid username format' });
  req.query.slug = username;
  return handleKickRequest(req, res);
});

app.get('/api/kick', (req, res) => handleKickRequest(req, res));

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.listen(port, () => {
  console.log(`Kick Server running on port ${port}`);
});
