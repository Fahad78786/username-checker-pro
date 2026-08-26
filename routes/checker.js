const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const supabase = require('../supabase');

// ✅ Stealth Plugin
puppeteer.use(StealthPlugin());

// ✅ Proxy Credentials
const PROXY_USERNAME = process.env.PROXY_USERNAME || 'mtqroiwi-CH-11';
const PROXY_PASSWORD = process.env.PROXY_PASSWORD || 'dy77ui0vm9rk';
const PROXY_HOST = process.env.PROXY_HOST || 'p.webshare.io';
const PROXY_PORT = process.env.PROXY_PORT || '80';

// ✅ YEH LINE CHANGE KARO!
// Pehle: const auth = require('./routes/auth');
// Ab:
const auth = require('./auth');  // ✅ Sahih

const PROXY_URL = `http://${PROXY_USERNAME}:${PROXY_PASSWORD}@${PROXY_HOST}:${PROXY_PORT}`;

console.log('[PROXY] Using proxy:', PROXY_HOST, 'Port:', PROXY_PORT);

// ... baqi code aap ka waisa hi hai

console.log('[PROXY] Using proxy:', PROXY_HOST, 'Port:', PROXY_PORT);

// ✅ User Auth Middleware
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

// ✅ Browser Manager
let browserPromise = null;

async function getBrowser() {
  if (browserPromise) {
    try {
      const browser = await browserPromise;
      await browser.version();
      return browser;
    } catch (err) {
      console.log('[BROWSER] Crashed, creating new...');
      browserPromise = null;
    }
  }

  console.log('[BROWSER] Launching with proxy:', PROXY_HOST);

  browserPromise = puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      `--proxy-server=${PROXY_HOST}:${PROXY_PORT}`,
      '--window-size=1280,800'
    ]
  }).catch(err => {
    console.error('[BROWSER LAUNCH FAILED]', err.message);
    browserPromise = null;
    throw err;
  });

  return browserPromise;
}

// ✅ Extract Display Name
function extractDisplayName(body, username) {
  try {
    const jsonMatch = body.match(/"full_name":"([^"]+)"/);
    if (jsonMatch && jsonMatch[1]) return jsonMatch[1];

    const titleMatch = body.match(/<title>(.*?)<\/title>/i);
    if (titleMatch && titleMatch[1]) {
      const cleanTitle = titleMatch[1].replace(/\(@[^)]+\)/g, '').trim();
      if (cleanTitle && cleanTitle !== 'Instagram' && cleanTitle !== 'Threads') {
        return cleanTitle;
      }
    }

    const ogTitleMatch = body.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"[^>]*>/i);
    if (ogTitleMatch && ogTitleMatch[1]) {
      const clean = ogTitleMatch[1].replace(/\(@[^)]+\)/g, '').trim();
      if (clean && clean !== 'Instagram' && clean !== 'Threads') {
        return clean;
      }
    }

    return null;
  } catch (e) {
    return null;
  }
}

// ✅ Check One Platform
async function checkOnePlatform(platform, username) {
  const cleanUsername = username.replace('@', '').trim();
  if (!cleanUsername) return { status: 'invalid', displayName: null };

  const urls = {
    instagram: `https://www.instagram.com/${cleanUsername}/`,
    threads: `https://www.threads.net/@${cleanUsername}`,
  };

  const url = urls[platform];
  if (!url) return { status: 'unknown', displayName: null };

  let page = null;
  let retries = 2;

  while (retries > 0) {
    try {
      const browser = await getBrowser();
      page = await browser.newPage();

      await page.authenticate({
        username: PROXY_USERNAME,
        password: PROXY_PASSWORD
      });

      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');
      await page.setViewport({ width: 1280, height: 800 });

      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
      });

      console.log(`[CHECK] ${platform}/${cleanUsername} - Loading...`);

      const response = await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: 30000
      });

      await page.waitForTimeout(2000);

      const status = response ? response.status() : 0;
      const body = await page.content();
      const bodyLower = body.toLowerCase();

      console.log(`[CHECK] ${platform}/${cleanUsername} status=${status}`);

      await page.close();

      if (status === 404 ||
        bodyLower.includes("sorry, this page") ||
        bodyLower.includes("isn't available") ||
        bodyLower.includes("page not found") ||
        bodyLower.includes("couldn't find this account")) {
        return { status: 'available', displayName: null };
      }

      if (bodyLower.includes("account has been disabled") ||
        bodyLower.includes("account suspended") ||
        bodyLower.includes("account has been restricted")) {
        return { status: 'suspended', displayName: null };
      }

      if (bodyLower.includes("challenge") ||
        bodyLower.includes("verify your identity")) {
        return { status: 'challenge', displayName: null };
      }

      if (bodyLower.includes("login") && bodyLower.includes("log in")) {
        return { status: 'login_required', displayName: null };
      }

      const hasProfileMarkers =
        body.includes('"is_private"') ||
        body.includes('edge_followed_by') ||
        body.includes('"profile_pic_url"') ||
        body.includes('"biography"') ||
        body.includes('"full_name"') ||
        (body.includes('og:title') && body.includes(`@${cleanUsername}`));

      if (status === 200 && hasProfileMarkers) {
        const displayName = extractDisplayName(body, cleanUsername);
        return { status: 'active', displayName: displayName };
      }

      return { status: 'unknown', displayName: null };

    } catch (err) {
      console.error(`[ERROR] ${platform}/${cleanUsername}: ${err.message}`);
      if (page) {
        try { await page.close(); } catch (e) { }
      }

      retries--;
      if (retries > 0) {
        console.log(`[RETRY] ${platform}/${cleanUsername} (${retries} left)`);
        await new Promise(r => setTimeout(r, 3000));
      } else {
        return { status: 'error', displayName: null, error: err.message };
      }
    }
  }

  return { status: 'error', displayName: null };
}

// ✅ Check All Platforms
async function checkUsernameAllPlatforms(username, platforms) {
  const result = { username };

  for (const p of platforms) {
    const r = await checkOnePlatform(p, username);
    result[p] = r.status;
    result[p + '_name'] = r.displayName || null;
    if (r.error) result[p + '_error'] = r.error;
  }

  return result;
}

// ✅ Bulk Check API
router.post('/bulk', userAuth, async (req, res) => {
  try {
    const { usernames, platforms } = req.body;

    if (!usernames || !Array.isArray(usernames) || usernames.length === 0) {
      return res.json({ success: false, message: 'Username list is empty' });
    }

    if (!platforms || !Array.isArray(platforms) || platforms.length === 0) {
      return res.json({ success: false, message: 'Select at least one platform' });
    }

    const validPlatforms = platforms.filter(p => ['instagram', 'threads'].includes(p));
    if (validPlatforms.length === 0) {
      return res.json({ success: false, message: 'Invalid platform selection' });
    }

    const { data: user, error: userErr } = await supabase
      .from('users')
      .select('*')
      .eq('id', req.userId)
      .single();

    if (userErr || !user) {
      return res.json({ success: false, message: 'User not found' });
    }

    if (user.is_blocked) {
      return res.json({ success: false, message: 'Your account is blocked' });
    }

    const costPerUsername = validPlatforms.length;
    const affordableCount = Math.floor(user.points / costPerUsername);

    if (affordableCount === 0) {
      return res.json({ success: false, message: 'Not enough points. Contact admin.' });
    }

    const MAX_PER_REQUEST = 20;
    const usernamesToProcess = usernames
      .slice(0, Math.min(affordableCount, MAX_PER_REQUEST))
      .map(u => u.replace('@', '').trim())
      .filter(u => u.length > 0);

    if (usernamesToProcess.length === 0) {
      return res.json({ success: false, message: 'No valid usernames found' });
    }

    const results = [];
    for (const u of usernamesToProcess) {
      const result = await checkUsernameAllPlatforms(u, validPlatforms);
      results.push(result);
    }

    const totalCost = usernamesToProcess.length * costPerUsername;
    const newPoints = Math.max(0, user.points - totalCost);
    const newChecked = (user.total_checked || 0) + usernamesToProcess.length;

    const { data: updated, error: updateErr } = await supabase
      .from('users')
      .update({
        points: newPoints,
        total_checked: newChecked,
        last_check: new Date().toISOString()
      })
      .eq('id', req.userId)
      .select();

    if (updateErr || !updated || updated.length === 0) {
      return res.json({ success: false, message: 'Failed to update points' });
    }

    res.json({
      success: true,
      results: results,
      remainingPoints: newPoints,
      processedCount: usernamesToProcess.length,
      requestedCount: usernames.length,
      note: usernames.length > MAX_PER_REQUEST ?
        `Only ${MAX_PER_REQUEST} processed per request. Run again for more.` :
        undefined
    });

  } catch (err) {
    console.error('[BULK ERROR]', err);
    res.json({ success: false, message: 'Server error: ' + err.message });
  }
});

module.exports = router;