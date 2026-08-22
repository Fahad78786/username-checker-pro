const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
}

function adminAuth(req, res, next) {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.json({ success: false, message: 'Token nahi hai' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded.isAdmin) return res.json({ success: false, message: 'Admin access nahi hai' });
    next();
  } catch (err) {
    res.json({ success: false, message: 'Invalid token' });
  }
}

router.get('/users', adminAuth, async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data: users, error } = await supabase.from('users')
      .select('id, username, email, points, is_blocked, country, country_code, ip, total_checked, created_at, last_login')
      .eq('is_admin', false).order('created_at', { ascending: false });
    if (error) return res.json({ success: false, message: error.message });
    res.json({ success: true, users });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

router.post('/users/add', adminAuth, async (req, res) => {
  try {
    const supabase = getSupabase();
    const { username, email, password, points } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const { data: user, error } = await supabase.from('users')
      .insert([{ username, email, password: hashedPassword, points: parseInt(points) || 0 }])
      .select().single();
    if (error) return res.json({ success: false, message: error.message });
    res.json({ success: true, message: 'User add ho gaya', user });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

router.delete('/users/:id', adminAuth, async (req, res) => {
  try {
    const supabase = getSupabase();
    await supabase.from('users').delete().eq('id', req.params.id);
    res.json({ success: true, message: 'User delete ho gaya' });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

router.put('/users/:id/block', adminAuth, async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data: user } = await supabase.from('users').select('is_blocked').eq('id', req.params.id).single();
    const newStatus = !user.is_blocked;
    await supabase.from('users').update({ is_blocked: newStatus }).eq('id', req.params.id);
    res.json({ success: true, message: newStatus ? 'User block ho gaya' : 'User unblock ho gaya', isBlocked: newStatus });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

router.put('/users/:id/points/add', adminAuth, async (req, res) => {
  try {
    const supabase = getSupabase();
    const { points } = req.body;
    const { data: user } = await supabase.from('users').select('points').eq('id', req.params.id).single();
    const newPoints = user.points + parseInt(points);
    await supabase.from('users').update({ points: newPoints }).eq('id', req.params.id);
    res.json({ success: true, message: `${points} points add ho gaye`, points: newPoints });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

router.put('/users/:id/points/remove', adminAuth, async (req, res) => {
  try {
    const supabase = getSupabase();
    const { points } = req.body;
    const { data: user } = await supabase.from('users').select('points').eq('id', req.params.id).single();
    const newPoints = Math.max(0, user.points - parseInt(points));
    await supabase.from('users').update({ points: newPoints }).eq('id', req.params.id);
    res.json({ success: true, message: `${points} points remove ho gaye`, points: newPoints });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

router.get('/stats', adminAuth, async (req, res) => {
  try {
    const supabase = getSupabase();
    const { count: totalUsers } = await supabase.from('users').select('*', { count: 'exact', head: true }).eq('is_admin', false);
    const { count: blockedUsers } = await supabase.from('users').select('*', { count: 'exact', head: true }).eq('is_blocked', true);
    const { data: pointsData } = await supabase.from('users').select('points');
    const { data: checkedData } = await supabase.from('users').select('total_checked');
    const totalPoints = pointsData?.reduce((sum, u) => sum + u.points, 0) || 0;
    const totalChecked = checkedData?.reduce((sum, u) => sum + u.total_checked, 0) || 0;
    res.json({ success: true, stats: { totalUsers, blockedUsers, totalPoints, totalChecked } });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

module.exports = router;