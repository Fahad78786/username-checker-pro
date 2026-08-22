const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const axios = require('axios');
const supabase = require('../supabase');

function userAuth(req, res, next) {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.json({ success: false, message: 'Login karo pehle' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch (err) {
    res.json({ success: false, message: 'Invalid token' });
  }
}

async function checkPlatform(platform, username) {
  const urls = {
    instagram: `https://www.instagram.com/${username}/`,
    facebook: `https://www.facebook.com/${username}`,
    twitter: `https://www.x.com/${username}`,
    threads: `https://www.threads.net/@${username}`,
  };
  const url = urls[platform];
  if (!url) return { platform, username, available: null, status: '⚠️ Unknown' };
  try {
    const response = await axios.get(url, {
      timeout: 10000, maxRedirects: 5,
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
        return { platform, username, available: true, status: '✅ Available' };
      if (status === 200 && body.length > 10000)
        return { platform, username, available: false, status: '❌ Taken' };
    } else {
      if (status === 404) return { platform, username, available: true, status: '✅ Available' };
      if (status === 200) return { platform, username, available: false, status: '❌ Taken' };
    }
    return { platform, username, available: null, status: '⚠️ Unknown' };
  } catch (err) {
    return { platform, username, available: null, status: '⚠️ Check Failed' };
  }
}

router.post('/username', userAuth, async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.json({ success: false, message: 'Username daalo' });

    const { data: user } = await supabase.from('users').select('*').eq('id', req.userId).single();
    if (!user) return res.json({ success: false, message: 'User nahi mila' });
    if (user.is_blocked) return res.json({ success: false, message: 'Account block hai' });
    if (user.points < 1) return res.json({ success: false, message: 'Points khatam! Admin se contact karo.' });

    const platforms = ['instagram', 'facebook', 'twitter', 'threads'];
    const results = await Promise.all(platforms.map(p => checkPlatform(p, username)));

    const newPoints = user.points - 1;
    await supabase.from('users').update({ points: newPoints, total_checked: (user.total_checked || 0) + 1 }).eq('id', req.userId);

    res.json({ success: true, username, results, remainingPoints: newPoints });
  } catch (err) {
    res.json({ success: false, message: 'Server error: ' + err.message });
  }
});

router.post('/bulk', userAuth, async (req, res) => {
  try {
    const { usernames, platform } = req.body;
    if (!usernames || !Array.isArray(usernames) || usernames.length === 0)
      return res.json({ success: false, message: 'Usernames list empty hai' });

    const { data: user } = await supabase.from('users').select('*').eq('id', req.userId).single();
    if (!user) return res.json({ success: false, message: 'User nahi mila' });
    if (user.is_blocked) return res.json({ success: false, message: 'Account block hai' });
    if (user.points < 1) return res.json({ success: false, message: 'Points khatam! Admin se contact karo.' });

    const results = await Promise.all(usernames.map(u => checkPlatform(platform || 'instagram', u)));

    const availableFound = results.filter(r => r.available === true).length;
    const ptsToDeduct = Math.floor(availableFound / 20);
    const newPoints = Math.max(0, user.points - ptsToDeduct);

    await supabase.from('users').update({
      points: ptsToDeduct > 0 ? newPoints : user.points,
      total_checked: (user.total_checked || 0) + usernames.length
    }).eq('id', req.userId);

    res.json({ success: true, results, remainingPoints: ptsToDeduct > 0 ? newPoints : user.points });
  } catch (err) {
    res.json({ success: false, message: 'Server error: ' + err.message });
  }
});

module.exports = router;
