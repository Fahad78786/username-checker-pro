const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const axios = require('axios');
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

// Real availability check for a single platform
async function checkOnePlatform(platform, username) {
  const urls = {
    instagram: `https://www.instagram.com/${username}/`,
    threads: `https://www.threads.net/@${username}`,
  };
  const url = urls[platform];
  if (!url) return null;

  try {
    const response = await axios.get(url, {
      timeout: 10000,
      maxRedirects: 5,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Cache-Control': 'no-cache',
      },
      validateStatus: () => true
    });

    const status = response.status;
    const body = response.data?.toString() || '';

    if (platform === 'instagram') {
      if (status === 404 || body.includes("Sorry, this page") || body.includes("isn't available"))
        return true; // available
      if (status === 200 && body.length > 10000)
        return false; // taken
      return null; // unknown
    }

    if (platform === 'threads') {
      if (status === 404 || body.includes("isn't available"))
        return true;
      if (status === 200 && body.length > 5000)
        return false;
      return null;
    }

    return null;
  } catch (err) {
    return null;
  }
}

// Check one username across the requested platforms
async function checkUsernameAllPlatforms(username, platforms) {
  const result = { username };
  await Promise.all(platforms.map(async (p) => {
    result[p] = await checkOnePlatform(p, username);
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

// Single username check (kept for backward compatibility)
router.post('/username', userAuth, async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.json({ success: false, message: 'Enter a username' });

    const { data: user, error: userErr } = await supabase.from('users').select('*').eq('id', req.userId).single();
    if (userErr || !user) return res.json({ success: false, message: 'User not found' });
    if (user.is_blocked) return res.json({ success: false, message: 'Account is blocked' });
    if (user.points < 2) return res.json({ success: false, message: 'Not enough points' });

    const platforms = ['instagram', 'threads'];
    const result = await checkUsernameAllPlatforms(username, platforms);

    const newPoints = user.points - 2;
    await supabase.from('users').update({
      points: newPoints,
      total_checked: (user.total_checked || 0) + 1
    }).eq('id', req.userId);

    res.json({ success: true, username, result, remainingPoints: newPoints });
  } catch (err) {
    res.json({ success: false, message: 'Server error: ' + err.message });
  }
});

module.exports = router;
