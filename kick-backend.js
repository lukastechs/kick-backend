// kick-backend.js
// CommonJS version, ready for Render

const express = require("express");
const axios = require("axios");
const cors = require("cors");
const fs = require("fs").promises;
const path = require("path");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;

// === Config ===
const cacheDir = path.join(__dirname, "cache", "kick");
const ttlSeconds = 172800; // 48h
const TOKEN_SAFETY_BUFFER_MS = 60 * 1000; // refresh 60s early

// === Middleware ===
app.use(cors());
app.use(express.json());

// === Utils ===
async function ensureCacheDir() {
  await fs.mkdir(cacheDir, { recursive: true });
}

function sanitizeFilename(s) {
  return String(s).replace(/[^a-zA-Z0-9_-]/g, "");
}

function isValidUsername(s) {
  return /^[a-zA-Z0-9_-]{1,25}$/.test(String(s)); // Kick docs: slug up to 25 chars
}

function humanAge(createdAt) {
  if (!createdAt) return "Unknown";
  const now = new Date();
  const created = new Date(createdAt);
  const diffMs = now - created;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const years = Math.floor(diffDays / 365);
  const months = Math.floor((diffDays % 365) / 30);
  return years > 0 ? `${years} years, ${months} months` : `${months} months`;
}

function ageDays(createdAt) {
  if (!createdAt) return null;
  const now = new Date();
  const created = new Date(createdAt);
  return Math.floor((now - created) / (1000 * 60 * 60 * 24));
}

// Serialize arrays as repeated keys: slug=mrbeast&slug=another
function serializeParams(params) {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (Array.isArray(v)) v.forEach((item) => usp.append(k, item));
    else if (v !== undefined && v !== null) usp.append(k, String(v));
  }
  return usp.toString();
}

// === Simple file cache for channel summaries ===
async function checkCache(key) {
  const file = path.join(cacheDir, `${sanitizeFilename(key)}.json`);
  try {
    await fs.access(file);
    const raw = await fs.readFile(file, "utf-8");
    const parsed = JSON.parse(raw);
    const nowSec = Math.floor(Date.now() / 1000);
    if (parsed?.timestamp && nowSec - parsed.timestamp < ttlSeconds) {
      return { hit: true, data: parsed.data };
    }
    // stale
    await fs.unlink(file).catch(() => {});
  } catch (_) {
    // miss
  }
  return { hit: false };
}

async function saveCache(key, data) {
  const file = path.join(cacheDir, `${sanitizeFilename(key)}.json`);
  const payload = { timestamp: Math.floor(Date.now() / 1000), data };
  await fs.writeFile(file, JSON.stringify(payload, null, 2));
}

// === OAuth token cache (in-memory) ===
let tokenCache = { token: null, expiresAt: 0 };

async function getAppAccessToken() {
  const now = Date.now();
  if (tokenCache.token && now < tokenCache.expiresAt - TOKEN_SAFETY_BUFFER_MS) {
    return tokenCache.token;
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: process.env.KICK_CLIENT_ID || "",
    client_secret: process.env.KICK_CLIENT_SECRET || "",
  });

  try {
    const resp = await axios.post("https://id.kick.com/oauth/token", body, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 8000,
    });
    const { access_token, expires_in } = resp.data || {};
    if (!access_token) throw new Error("No access_token in response");
    tokenCache = {
      token: access_token,
      expiresAt: now + (Number(expires_in) || 3600) * 1000,
    };
    return access_token;
  } catch (err) {
    console.error("OAuth Error:", {
      status: err.response?.status,
      data: err.response?.data,
      message: err.message,
    });
    throw new Error("Failed to obtain Kick App Access Token");
  }
}

// === Core handler ===
async function handleKickRequest(req, res) {
  const { slug, broadcaster_user_id } = req.query;

  // Validate mutually exclusive
  if ((slug && broadcaster_user_id) || (!slug && !broadcaster_user_id)) {
    return res.status(400).json({
      error:
        "Provide either ?slug=<slug> or ?broadcaster_user_id=<id> (but not both).",
    });
  }

  try {
    await ensureCacheDir();

    // Build cache key
    const cacheKey = slug ? String(slug).toLowerCase() : String(broadcaster_user_id);
    const cached = await checkCache(cacheKey);
    if (cached.hit) return res.json({ data: cached.data, cached: true });

    // Token
    const token = await getAppAccessToken();

    // Prepare params as arrays per docs
    const params = slug
      ? { slug: [String(slug)] }
      : { broadcaster_user_id: [String(broadcaster_user_id)] };

    // 1) Get channel via /public/v1/channels
    let channelResp;
    try {
      channelResp = await axios.get("https://api.kick.com/public/v1/channels", {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "*/*",
        },
        params,
        paramsSerializer: serializeParams,
        timeout: 8000,
      });
    } catch (err) {
      if (err.response?.status === 401) {
        return res.status(401).json({ error: "Unauthorized (Bearer token invalid or missing)" });
      }
      if (err.response?.status === 403) {
        return res.status(403).json({ error: "Forbidden (insufficient scope or access)" });
      }
      if (err.response?.status === 400) {
        return res.status(400).json({ error: "Invalid parameters for channels endpoint" });
      }
      throw err;
    }

    const channel = channelResp?.data?.data?.[0];
    if (!channel) {
      return res.status(404).json({
        error: `User ${slug || broadcaster_user_id} not found`,
      });
    }

    const bUid = channel.broadcaster_user_id;
    let userCreatedAt = null;
    let profilePic = null;
    let displayName = null;

    // 2) Fetch user (optional) for created_at & profile fields
    try {
      const userResp = await axios.get("https://api.kick.com/public/v1/users", {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "*/*",
        },
        params: { id: [String(bUid)] },
        paramsSerializer: serializeParams,
        timeout: 8000,
      });

      const user = userResp?.data?.data?.[0];
      if (user) {
        // Different environments might expose different shapes; try common ones.
        userCreatedAt =
          user.created_at || user.createdAt || user.created || null;
        profilePic =
          user.profile_picture || user.profilepic || user.avatar || null;
        displayName = user.name || user.display_name || null;
      }
    } catch (err) {
      // Non-fatal if user lookup fails; we can still return channel data
      console.warn("Users API warning:", {
        status: err.response?.status,
        data: err.response?.data,
        message: err.message,
      });
    }

    // Compose response
    const computed = {
      username: channel.slug || (slug || `${bUid}`),
      nickname: displayName || channel.slug || (slug || `${bUid}`),
      estimated_creation_date: userCreatedAt
        ? new Date(userCreatedAt).toLocaleDateString()
        : "Unknown",
      account_age: humanAge(userCreatedAt),
      age_days: ageDays(userCreatedAt),
      followers: channel.followers_count ?? 0,
      verified: channel.verified ? "Yes" : "No",
      description: channel.channel_description || "N/A",
      user_id: bUid || "N/A",
      avatar:
        profilePic ||
        channel.banner_picture ||
        "https://via.placeholder.com/50",
      estimation_confidence: userCreatedAt ? "High" : "Unknown",
      accuracy_range: userCreatedAt ? "Exact" : "Unknown",
      visit_profile: `https://kick.com/${channel.slug || slug || bUid}`,
      category: channel.category?.name || null,
      is_live: Boolean(channel.stream?.is_live),
      stream_title: channel.stream_title || null,
    };

    await saveCache(cacheKey, computed);
    return res.json({ data: computed, cached: false });
  } catch (error) {
    console.error("Kick API Error:", {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message,
    });

    if (error.response?.status === 429) {
      return res.status(429).json({
        error: "Rate limit exceeded. Please try again shortly.",
      });
    }

    return res.status(error.response?.status || 500).json({
      error: "Failed to fetch Kick data",
      details: error.message || "Unknown error",
    });
  }
}

// === Routes ===
app.get("/", (_req, res) => {
  res.send("Kick Account Age Checker API is running");
});

// Path param: /api/kick/:username  -> treated as slug
app.get("/api/kick/:username", (req, res) => {
  const username = String(req.params.username || "");
  if (!isValidUsername(username)) {
    return res.status(400).json({ error: "Invalid username format" });
  }
  req.query.slug = username;
  return handleKickRequest(req, res);
});

// Query form:
//   /api/kick?slug=mrbeast
//   /api/kick?broadcaster_user_id=123
app.get("/api/kick", (req, res) => handleKickRequest(req, res));

// Health
app.get("/health", (_req, res) => {
  res.json({ status: "healthy", timestamp: new Date().toISOString() });
});

// Start
app.listen(port, () => {
  console.log(`Kick Server running on port ${port}`);
});
