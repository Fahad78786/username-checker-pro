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

// RapidAPI se real check
async function checkUsernameRapidAPI(username) {
  try {
    const response = await axios.get(
      `https://osint-username-availability-brand-checker-api.p.rapidapi.com/check?username=${encodeURIComponent(username)}`,
      {
        headers: {
          'Content-Type': 'application/json',
          'x-rapidapi-host': 'osint-username-availability-brand-checker-api.p.rapidapi.com',
          'x-rapidapi-key': process.env.RAPIDAPI_KEY
        },
        timeout: 15000
      }
    );

    const data = response.data;
    // Parse response - API returns platform availability
    return { username, data, success: true };
  } catch (err) {
    return { username, success: false, error: err.message };
  }
}

// BULK CHECK with RapidAPI
router.post('/bulk', userAuth, async (req, res) => {
  try {
    const { usernames, platform } = req.body;
    if (!usernames || !Array.isArray(usernames) || usernames.length === 0)
      return res.json({ success: false, message: 'Usernames list empty hai' });

    const { data: user } = await supabase.from('users').select('*').eq('id', req.userId).single();
    if (!user) return res.json({ success: false, message: 'User nahi mila' });
    if (user.is_blocked) return res.json({ success: false, message: 'Account block hai' });
    if (user.points < 1) return res.json({ success: false, message: 'Points khatam! Admin se contact karo.' });

    const results = [];

    // Check one by one (RapidAPI rate limit)
    for (const username of usernames) {
      const apiResult = await checkUsernameRapidAPI(username);

      if (apiResult.success && apiResult.data) {
        const platformData = apiResult.data;

        // Map platform name to API response key
        const platformMap = {
          instagram: 'instagram',
          facebook: 'facebook',
          twitter: 'twitter',
          threads: 'threads'
        };

        const key = platformMap[platform] || platform;
        let available = null;

        // API typically returns {instagram: true/false, facebook: true/false, ...}
        if (platformData[key] !== undefined) {
          available = platformData[key] === true || platformData[key] === 'available';
        } else if (platformData.available !== undefined) {
          available = platformData.available;
        } else if (typeof platformData === 'object') {
          // Try to find platform in response
          const keys = Object.keys(platformData);
          const matchKey = keys.find(k => k.toLowerCase().includes(key));
          if (matchKey) available = platformData[matchKey] === true || platformData[matchKey] === 'available';
        }

        results.push({ username, available });
      } else {
        results.push({ username, available: null });
      }

      // Small delay to respect rate limits
      await new Promise(r => setTimeout(r, 200));
    }

    // Deduct points only for available usernames found
    const availableFound = results.filter(r => r.available === true).length;
    const ptsToDeduct = Math.floor(availableFound / 20); // 50 pts = 1000 available
    const newPoints = Math.max(0, user.points - ptsToDeduct);
    const newChecked = (user.total_checked || 0) + usernames.length;

    await supabase.from('users').update({
      points: ptsToDeduct > 0 ? newPoints : user.points,
      total_checked: newChecked
    }).eq('id', req.userId);

    res.json({
      success: true,
      results,
      remainingPoints: ptsToDeduct > 0 ? newPoints : user.points
    });

  } catch (err) {
    res.json({ success: false, message: 'Server error: ' + err.message });
  }
});

module.exports = router;
