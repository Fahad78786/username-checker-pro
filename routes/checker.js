const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const puppeteer = require('puppeteer');
const supabase = require('../supabase');

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

// Singleton browser instance, reused across requests to save memory/startup time
let browserPromise = null;
function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process',
        `--proxy-server=${process.env.PROXY_HOST}:${process.env.PROXY_PORT}`
      ]
    }).catch(err => {
      console.error('[BROWSER LAUNCH FAILED]', err.message);
      browserPromise = null;
      throw err;
    });
  }
  return browserPromise;
}

function extractDisplayName(body, username) {
  try {
    const titleMatch = body.match(/<title>(.*?)<\/title>/i);
    if (titleMatch && titleMatch[1]) {
      const nameMatch = titleMatch[1].match(/^(.*?)\s*\(@/);
      if (nameMatch && nameMatch[1]) return nameMatch[1].trim();
    }
  } catch (e) {}
  return null;
}

// Real check using a real headless browser (bypasses simple bot-detection better than raw HTTP)
async function checkOnePlatform(platform, username) {
  const urls = {
    instagram: `https://www.instagram.com/${username}/`,
    threads: `https://www.threads.net/@${username}`,
  };
  const url = urls[platform];
  if (!url) return { status: 'unknown', displayName: null };

  let page = null;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();

    await page.authenticate({
      username: process.env.PROXY_USERNAME,
      password: process.env.PROXY_PASSWORD
    });

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 800 });

    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await new Promise(r => setTimeout(r, 1500)); // let JS settle a bit

    const status = response ? response.status() : 0;
    const body = await page.content();
    const bodyLower = body.toLowerCase();

    console.log(`[PUPPETEER CHECK] ${platform}/${username} status=${status} bodyLen=${body.length} has_challenge=${bodyLower.includes('challenge')} title=${(body.match(/<title>(.*?)<\/title>/i) || [])[1] || 'NONE'}`);

    await page.close();

    if (status === 404 || body.includes("Sorry, this page") || bodyLower.includes("isn't available") || bodyLower.includes('page not found')) {
      return { status: 'available', displayName: null };
    }

    if (bodyLower.includes('account has been disabled') || bodyLower.includes('account suspended') || bodyLower.includes('account has been restricted')) {
      return { status: 'suspended', displayName: null };
    }

    const hasProfileMarkers =
      body.includes('"is_private"') ||
      body.includes('edge_followed_by') ||
      body.includes('"profile_pic_url"') ||
      (body.includes('og:title') && body.includes(`(@${username})`));

    if (status === 200 && hasProfileMarkers) {
      return { status: 'active', displayName: extractDisplayName(body, username) };
    }

    return { status: 'unknown', displayName: null };
  } catch (err) {
    console.error(`[PUPPETEER ERROR] ${platform}/${username}: ${err.message}`);
    if (page) { try { await page.close(); } catch (e) {} }
    return { status: 'unknown', displayName: null, error: err.message };
  }
}

async function checkUsernameAllPlatforms(username, platforms) {
  const result = { username };
  // Sequential, not parallel — real browser tabs are memory-heavy on free tier
  for (const p of platforms) {
    const r = await checkOnePlatform(p, username);
    result[p] = r.status;
    result[p + '_name'] = r.displayName;
  }
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

    // Cap batch size hard — real browser checks are slow (5-15s each), avoid request timeouts
    const MAX_PER_REQUEST = 15;
    const usernamesToProcess = usernames.slice(0, Math.min(affordableCount, MAX_PER_REQUEST));

    const results = [];
    for (const u of usernamesToProcess) {
      results.push(await checkUsernameAllPlatforms(u, validPlatforms));
    }

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
      requestedCount: usernames.length,
      note: usernames.length > MAX_PER_REQUEST ? `Only ${MAX_PER_REQUEST} processed per request due to browser check speed. Run again for more.` : undefined
    });

  } catch (err) {
    res.json({ success: false, message: 'Server error: ' + err.message });
  }
});

module.exports = router;
