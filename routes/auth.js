const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const supabase = require('../supabase');

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

router.post('/signup', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    console.log('[SIGNUP] Attempting to create user:', username, email);
    
    if (!username || !email || !password) {
      return res.json({ success: false, message: 'Sab fields fill karo' });
    }
    if (password.length < 6) {
      return res.json({ success: false, message: 'Password 6 characters ka hona chahiye' });
    }

    // Check if user exists
    const { data: existing, error: existErr } = await supabase
      .from('users')
      .select('id')
      .or(`email.eq.${email},username.eq.${username}`)
      .limit(1);
      
    if (existErr) {
      console.error('[SIGNUP] DB Error:', existErr);
      return res.json({ success: false, message: 'DB Error: ' + existErr.message });
    }
    if (existing && existing.length > 0) {
      return res.json({ success: false, message: 'Username ya email pehle se registered hai' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
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

    if (error) {
      console.error('[SIGNUP] Insert Error:', error);
      return res.json({ success: false, message: 'Insert Error: ' + error.message });
    }

    console.log('[SIGNUP] User created successfully:', user.id);

    const token = jwt.sign({ id: user.id, isAdmin: false }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({
      success: true,
      message: 'Account ban gaya!',
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
    console.error('[SIGNUP] Server Error:', err);
    res.json({ success: false, message: 'Server error: ' + err.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log('[LOGIN] Attempting login for:', email);

    if (email === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
      const token = jwt.sign({ isAdmin: true }, process.env.JWT_SECRET, { expiresIn: '7d' });
      return res.json({ success: true, isAdmin: true, token });
    }

    const { data: users, error } = await supabase
      .from('users')
      .select('*')
      .or(`email.eq.${email},username.eq.${email}`)
      .limit(1);
      
    if (error) {
      console.error('[LOGIN] DB Error:', error);
      return res.json({ success: false, message: 'DB Error: ' + error.message });
    }
    if (!users || users.length === 0) {
      return res.json({ success: false, message: 'User nahi mila' });
    }

    const user = users[0];
    if (user.is_blocked) {
      return res.json({ success: false, message: 'Account block hai. Admin se contact karo.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.json({ success: false, message: 'Password galat hai' });
    }

    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress || '';
    const { country, countryCode } = await getCountry(ip);
    await supabase
      .from('users')
      .update({ last_login: new Date(), ip, country, country_code: countryCode })
      .eq('id', user.id);

    console.log('[LOGIN] User logged in successfully:', user.id);

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
    console.error('[LOGIN] Server Error:', err);
    res.json({ success: false, message: 'Server error: ' + err.message });
  }
});

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