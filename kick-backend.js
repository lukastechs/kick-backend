// kick-backend.js
// Fully working hybrid implementation that combines Kick's **public API** (v1)
// and Kick's **website API** (v2) so you get verified status, followers,
// proper description, and a reliable channel creation date.
//
// Key points:
// - Uses OAuth2.1 client_credentials to call `https://api.kick.com/public/v1/channels` (official docs)
// - Also calls `https://kick.com/api/v2/channels/{slug}` (public JSON used by the site)
// - Channel creation date is derived from `v2.chatroom.created_at` (what community tools show)
// - Works with either `slug` or `broadcaster_user_id`
// - Caches responses on disk for 48 hours
// - Gracefully degrades if the v1 call fails (still returns the v2 fields)

const express = require('express');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// -------------------------------
// Configuration
// -------------------------------
const cacheDir = path.join(__dirname, 'cache', 'kick');
const ttlSeconds = 60 * 60 * 48; // 48 hours

// -------------------------------
// Middleware
// -------------------------------
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

// Kick docs say slugs are max 25 chars. Allow letters, numbers, underscore, hyphen
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
  // If we already have a valid token, reuse it
  if (tokenCache.accessToken && Date.now() < tokenCache.expiresAt) {
    return tokenCache.accessToken;
  }

  // If env vars are missing, skip token fetching (the v2 path will still work)
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

    // Set expiry with a 60s safety buffer
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
    // Return null so the caller can still continue with v2 only
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
    if (
      json && json.timestamp && Math.floor(Date.now() / 1000) - json.timestamp < ttlSeconds
    ) {
      return json.data;
    }
    // stale
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
  if (!token) return null; // No token? Skip

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
    const resp = await axios.get(`https://kick.com/api/v2/channels/${encodeURIComponent(slug)}` , {
      timeout: 7000,
    });
    return resp.data || null;
  } catch (error) {
    // 404 or other
    if (error.response?.status === 404) return null;
    console.error('v2 /channels/{slug} error:', {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message,
    });
    return null;
  }
}

// -------------------------------
// Core handler
// -------------------------------
async function handleKickRequest(req, res) {
  const { slug: rawSlug, broadcaster_user_id: rawBroadcasterUserId } = req.query;

  // Basic validation
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

    // Determine the cache key (prefer slug if present)
    const cacheKey = (slug || broadcasterUserId).toLowerCase();

    // Check cache first
    const cached = await readCache(cacheKey);
    if (cached) {
      return res.json({ data: cached, cached: true });
    }

    // Step 1: Get OAuth token for v1 (may be null if env not set or endpoint down)
    const token = await getKickAccessToken();

    // Step 2: If we only have broadcaster_user_id, resolve slug with v1
    let resolvedSlug = slug || null;
    let v1 = null;

    if (!resolvedSlug && broadcasterUserId) {
      v1 = await fetchChannelPublicV1({ slug: null, broadcasterUserId, token });
      if (!v1 || !v1.slug) {
        return res.status(404).json({ error: `User ${broadcasterUserId} not found` });
      }
      resolvedSlug = v1.slug;
    }

    // Step 3: Call v2 with slug to get verified/followers/description/created_at etc.
    if (!resolvedSlug) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    const v2 = await fetchChannelV2BySlug(resolvedSlug);

    if (!v1) {
      // If we already didn't call v1 above, try to call it now (non-fatal if it fails)
      v1 = await fetchChannelPublicV1({ slug: resolvedSlug, broadcasterUserId: null, token });
    }

    // If both v1 and v2 failed, bail out
    if (!v2 && !v1) {
      return res.status(404).json({ error: `User ${resolvedSlug} not found` });
    }

    // Extract fields
    const createdAt = v2?.chatroom?.created_at || null;
    const ageDays = calculateAgeDays(createdAt);

    const data = {
      // Identifiers
      slug: resolvedSlug,
      channel_id: v2?.id ?? null,
      user_id: v2?.user_id ?? null,

      // Core display fields
      username: v2?.user?.username ?? resolvedSlug,
      description: v2?.user?.bio ?? v1?.channel_description ?? null,
      avatar: v2?.user?.profile_pic ?? null,

      // Status & metrics
      verified: v2?.verified === true,
      followers: typeof v2?.followers_count === 'number' ? v2.followers_count : null,
      is_banned: v2?.is_banned === true,

      // Live + category
      category: v1?.category?.name ?? (Array.isArray(v2?.recent_categories) && v2.recent_categories.length ? v2.recent_categories[0].name : null),
      is_live: typeof v1?.stream?.is_live === 'boolean' ? v1.stream.is_live : Boolean(v2?.livestream),
      stream_title: v1?.stream_title ?? v2?.livestream?.session_title ?? null,

      // Creation & age
      channel_created_at: createdAt, // raw ISO string from v2.chatroom.created_at
      estimated_creation_date: toLocalDateString(createdAt),
      account_age: calculateAccountAge(createdAt),
      age_days: ageDays,
      estimation_confidence: createdAt ? 'High (derived from chatroom.created_at)' : 'Unknown',
      accuracy_range: createdAt ? 'Exact (channel chatroom creation)' : 'Unknown',

      // Convenience link
      visit_profile: `https://kick.com/${resolvedSlug}`,
    };

    // Save to cache and return
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

// Path parameter route: /api/kick/:username
app.get('/api/kick/:username', async (req, res) => {
  const username = String(req.params.username || '').trim();
  if (!username) return res.status(400).json({ error: 'Missing username' });
  if (!isValidSlug(username)) return res.status(400).json({ error: 'Invalid username format' });
  req.query.slug = username; // forward as query to the shared handler
  return handleKickRequest(req, res);
});

// Query parameter route: /api/kick?slug=username or /api/kick?broadcaster_user_id=123
app.get('/api/kick', (req, res) => handleKickRequest(req, res));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.listen(port, () => {
  console.log(`Kick Server running on port ${port}`);
});
