const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const supabase = require('../supabase');

// Get country from IP
async function getCountry(ip) {
  try {
    const cleanIp = ip.replace('::ffff:', '').split(',')[0].trim();
    const res = await axios.get(`http://ip-api.com/json/${cleanIp}`, { timeout: 3000 });
    if (res.data.status === 'success') {
      return { country: res.data.country, countryCode: res.data.countryCode };
    }
  } catch (e) {}
  return { country: 'Unknown', countryCode: '' };
}

// SIGNUP
router.post('/signup', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password)
      return res.json({ success: false, message: 'Sab fields fill karo' });

    if (password.length < 6)
      return res.json({ success: false, message: 'Password kam az kam 6 characters ka hona chahiye' });

    // Check existing
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .or(`email.eq.${email},username.eq.${username}`)
      .limit(1);

    if (existing && existing.length > 0)
      return res.json({ success: false, message: 'Username ya email pehle se registered hai' });

    const hashedPassword = await bcrypt.hash(password, 10);

    // Get IP and country
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress || '';
    const { country, countryCode } = await getCountry(ip);

    const { data: user, error } = await supabase
      .from('users')
      .insert([{
        username,
        email,
        password: hashedPassword,
        points: 0,
        is_blocked: false,
        country,
        country_code: countryCode,
        ip,
        total_checked: 0
      }])
      .select()
      .single();

    if (error) return res.json({ success: false, message: 'Error: ' + error.message });

    const token = jwt.sign({ id: user.id, isAdmin: false }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.json({
      success: true,
      message: 'Account ban gaya! Admin se points lene ke liye contact karo.',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        points: user.points,
        country: user.country
      }
    });
  } catch (err) {
    res.json({ success: false, message: 'Server error: ' + err.message });
  }
});

// LOGIN
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Admin login
    if (email === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
      const token = jwt.sign({ isAdmin: true }, process.env.JWT_SECRET, { expiresIn: '7d' });
      return res.json({ success: true, isAdmin: true, token });
    }

    const { data: users } = await supabase
      .from('users')
      .select('*')
      .or(`email.eq.${email},username.eq.${email}`)
      .limit(1);

    if (!users || users.length === 0)
      return res.json({ success: false, message: 'User nahi mila' });

    const user = users[0];

    if (user.is_blocked)
      return res.json({ success: false, message: 'Aapka account block hai. Admin se contact karo.' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch)
      return res.json({ success: false, message: 'Password galat hai' });

    // Update last login
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress || '';
    const { country, countryCode } = await getCountry(ip);

    await supabase
      .from('users')
      .update({ last_login: new Date(), ip, country, country_code: countryCode })
      .eq('id', user.id);

    const token = jwt.sign({ id: user.id, isAdmin: false }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.json({
      success: true,
      isAdmin: false,
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        points: user.points,
        country: user.country
      }
    });
  } catch (err) {
    res.json({ success: false, message: 'Server error: ' + err.message });
  }
});

// GET USER INFO
router.get('/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.json({ success: false, message: 'Token nahi hai' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const { data: user } = await supabase
      .from('users')
      .select('id, username, email, points, country, total_checked, is_blocked')
      .eq('id', decoded.id)
      .single();

    if (!user) return res.json({ success: false, message: 'User nahi mila' });

    res.json({ success: true, user });
  } catch (err) {
    res.json({ success: false, message: 'Invalid token' });
  }
});

module.exports = router;
