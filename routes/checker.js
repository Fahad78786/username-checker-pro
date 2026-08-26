const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const supabase = require('../supabase');

// Webshare rotating proxy - automatically rotates across all proxies in the account
let proxyAgent = null;
let proxyError = null;
try {
  const PROXY_URL = `http://${process.env.PROXY_USERNAME}:${process.env.PROXY_PASSWORD}@${process.env.PROXY_HOST}:${process.env.PROXY_PORT}`;
  proxyAgent = new HttpsProxyAgent(PROXY_URL);
  console.log('Proxy agent created successfully');
} catch (e) {
  proxyError = e.message;
  console.error('FAILED TO CREATE PROXY AGENT:', e.message);
}

function userAuth(req, res, next) {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.json({ success: false, message: 'Please login first' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch (err) {
    res.json({ success: false, message: 'Invalid token' });
  }
}

// Try to extract the public display name from the page's <title> or meta tags
function extractDisplayName(platform, body) {
  try {
    if (platform === 'instagram' || platform === 'threads') {
      const titleMatch = body.match(/<title>(.*?)<\/title>/i);
      if (titleMatch && titleMatch[1]) {
        const raw = titleMatch[1];
        const nameMatch = raw.match(/^(.*?)\s*\(@/);
        if (nameMatch && nameMatch[1]) return nameMatch[1].trim();
      }
      const ogMatch = body.match(/<meta property="og:title" content="(.*?)"/i);
      if (ogMatch && ogMatch[1]) {
        const nameMatch = ogMatch[1].match(/^(.*?)\s*\(@/);
        if (nameMatch && nameMatch[1]) return nameMatch[1].trim();
      }
    }
  } catch (e) {}
  return null;
}

// Returns { status: 'available'|'active'|'suspended'|'unknown', displayName: string|null }
async function checkOnePlatform(platform, username) {
  const urls = {
    instagram: `https://www.instagram.com/${username}/`,
    threads: `https://www.threads.net/@${username}`,
  };
  const url = urls[platform];
  if (!url) return { status: 'unknown', displayName: null };
  if (!proxyAgent) return { status: 'unknown', displayName: null, error: 'Proxy not configured: ' + proxyError };

  console.log(`[CHECK START] platform=${platform} username=${username}`);

  try {
    const response = await axios.get(url, {
      timeout: 15000,
      maxRedirects: 5,
      httpsAgent: proxyAgent,
      proxy: false, // disable axios's own proxy handling, we use the agent instead
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Cache-Control': 'no-cache',
      },
      validateStatus: () => true
    });

    console.log(`[CHECK DONE] platform=${platform} username=${username} status=${response.status} bodyLen=${response.data?.toString().length || 0}`);

    const status = response.status;
    const body = response.data?.toString() || '';
    const bodyLower = body.toLowerCase();

    if (platform === 'instagram') {
      if (status === 404 || body.includes("Sorry, this page") || body.includes("isn't available"))
        return { status: 'available', displayName: null };

      // Strong signals of a suspended/disabled/removed account
      if (
        bodyLower.includes('account has been disabled') ||
        bodyLower.includes('account suspended') ||
        bodyLower.includes('account has been restricted') ||
        bodyLower.includes('page not found') ||
        bodyLower.includes("content isn't available right now") ||
        bodyLower.includes('unable to load')
      ) {
        return { status: 'suspended', displayName: null };
      }

      // Strong signals of a genuine active profile: profile-specific meta/JSON markers
      const hasProfileMarkers =
        body.includes('"is_private"') ||
        body.includes('edge_followed_by') ||
        body.includes('"profile_pic_url"') ||
        body.includes('property="og:type" content="profile"') ||
        (body.includes('og:title') && body.includes(`(@${username})`));

      if (status === 200 && hasProfileMarkers) {
        return { status: 'active', displayName: extractDisplayName('instagram', body) };
      }

      return { status: 'unknown', displayName: null };
    }

    if (platform === 'threads') {
      if (status === 404 || body.includes("isn't available"))
        return { status: 'available', displayName: null };

      if (
        bodyLower.includes('account has been disabled') ||
        bodyLower.includes('account suspended') ||
        bodyLower.includes('page not found')
      ) {
        return { status: 'suspended', displayName: null };
      }

      const hasProfileMarkers =
        body.includes('"is_private"') ||
        body.includes('"profile_pic_url"') ||
        (body.includes('og:title') && body.includes(`(@${username})`));

      if (status === 200 && hasProfileMarkers) {
        return { status: 'active', displayName: extractDisplayName('threads', body) };
      }

      return { status: 'unknown', displayName: null };
    }

    return { status: 'unknown', displayName: null };
  } catch (err) {
    console.error(`[CHECK ERROR] platform=${platform} username=${username} message=${err.message} code=${err.code}`);
    return { status: 'unknown', displayName: null, error: err.message };
  }
}

async function checkUsernameAllPlatforms(username, platforms) {
  const result = { username };
  await Promise.all(platforms.map(async (p) => {
    const r = await checkOnePlatform(p, username);
    result[p] = r.status;
    result[p + '_name'] = r.displayName;
  }));
  return result;
}

// BULK CHECK — 1 point per platform per username
router.post('/bulk', userAuth, async (req, res) => {
  try {
    const { usernames, platforms } = req.body;

    if (!usernames || !Array.isArray(usernames) || usernames.length === 0)
      return res.json({ success: false, message: 'Username list is empty' });

    if (!platforms || !Array.isArray(platforms) || platforms.length === 0)
      return res.json({ success: false, message: 'Select at least one platform' });

    const validPlatforms = platforms.filter(p => ['instagram', 'threads'].includes(p));
    if (validPlatforms.length === 0)
      return res.json({ success: false, message: 'Invalid platform selection' });

    const { data: user, error: userErr } = await supabase.from('users').select('*').eq('id', req.userId).single();
    if (userErr || !user) return res.json({ success: false, message: 'User not found' });
    if (user.is_blocked) return res.json({ success: false, message: 'Your account is blocked' });

    const costPerUsername = validPlatforms.length;
    const affordableCount = Math.floor(user.points / costPerUsername);

    if (affordableCount === 0)
      return res.json({ success: false, message: 'Not enough points. Contact admin.' });

    const usernamesToProcess = usernames.slice(0, affordableCount);

    const results = await Promise.all(
      usernamesToProcess.map(u => checkUsernameAllPlatforms(u, validPlatforms))
    );

    const totalCost = usernamesToProcess.length * costPerUsername;
    const newPoints = Math.max(0, user.points - totalCost);
    const newChecked = (user.total_checked || 0) + usernamesToProcess.length;

    const { data: updated, error: updateErr } = await supabase
      .from('users')
      .update({ points: newPoints, total_checked: newChecked })
      .eq('id', req.userId)
      .select();

    if (updateErr || !updated || updated.length === 0)
      return res.json({ success: false, message: 'Failed to update points' });

    res.json({
      success: true,
      results,
      remainingPoints: newPoints,
      processedCount: usernamesToProcess.length,
      requestedCount: usernames.length
    });

  } catch (err) {
    res.json({ success: false, message: 'Server error: ' + err.message });
  }
});

// Diagnostic route - shows raw response for debugging (uses proxy too)
router.get('/debug/:platform/:username', userAuth, async (req, res) => {
  try {
    const { platform, username } = req.params;
    const urls = {
      instagram: `https://www.instagram.com/${username}/`,
      threads: `https://www.threads.net/@${username}`,
    };
    const url = urls[platform];
    if (!url) return res.json({ error: 'invalid platform' });

    const response = await axios.get(url, {
      timeout: 15000,
      maxRedirects: 5,
      httpsAgent: proxyAgent,
      proxy: false,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Cache-Control': 'no-cache',
      },
      validateStatus: () => true
    });

    const body = response.data?.toString() || '';
    res.json({
      status: response.status,
      bodyLength: body.length,
      bodySnippet: body.slice(0, 1500),
    });
  } catch (err) {
    res.json({ error: err.message });
  }
});

module.exports = router;

// Diagnostic: check for whitespace issues in proxy env vars without exposing secrets
router.get('/debug-env', userAuth, (req, res) => {
  const check = (name, val) => ({
    exists: val !== undefined,
    length: val ? val.length : 0,
    hasLeadingSpace: val ? val !== val.trimStart() : false,
    hasTrailingSpace: val ? val !== val.trimEnd() : false,
    hasNewline: val ? /[\r\n]/.test(val) : false,
  });
  res.json({
    PROXY_HOST: check('PROXY_HOST', process.env.PROXY_HOST),
    PROXY_PORT: check('PROXY_PORT', process.env.PROXY_PORT),
    PROXY_USERNAME: check('PROXY_USERNAME', process.env.PROXY_USERNAME),
    PROXY_PASSWORD: check('PROXY_PASSWORD', process.env.PROXY_PASSWORD),
  });
});
