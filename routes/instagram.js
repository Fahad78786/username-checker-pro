const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const supabase = require('../supabase');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

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

// ✅ Check Single Username
router.post('/check', userAuth, async (req, res) => {
  try {
    const { username } = req.body;
    
    if (!username || username.trim().length === 0) {
      return res.json({ success: false, message: 'Username is required' });
    }
    
    const cleanUsername = username.trim().replace('@', '');
    
    // ✅ Points check
    const { data: user, error: userErr } = await supabase
      .from('users')
      .select('points')
      .eq('id', req.userId)
      .single();
      
    if (userErr || !user) {
      return res.json({ success: false, message: 'User not found' });
    }
    
    if (user.points < 1) {
      return res.json({ success: false, message: 'Not enough points. Need 1 point per check.' });
    }
    
    // ✅ Deduct points
    const newPoints = user.points - 1;
    await supabase
      .from('users')
      .update({ points: newPoints })
      .eq('id', req.userId);
    
    // ✅ Python script call karo
    const scriptPath = path.join(__dirname, '../scripts/instagram_checker.py');
    
    exec(`python "${scriptPath}" "${cleanUsername}"`, { 
      timeout: 30000 
    }, async (error, stdout, stderr) => {
      
      if (error) {
        console.error('[PYTHON ERROR]', error);
        // Refund points on error
        await supabase
          .from('users')
          .update({ points: user.points })
          .eq('id', req.userId);
        return res.json({ success: false, message: 'Error checking username. Points refunded.' });
      }
      
      try {
        const result = JSON.parse(stdout);
        
        // ✅ Update total_checked
        const { data: userData } = await supabase
          .from('users')
          .select('total_checked')
          .eq('id', req.userId)
          .single();
        
        await supabase
          .from('users')
          .update({ 
            total_checked: (userData?.total_checked || 0) + 1 
          })
          .eq('id', req.userId);
        
        res.json({
          success: true,
          result: result,
          remainingPoints: newPoints
        });
        
      } catch (e) {
        // Refund points on parse error
        await supabase
          .from('users')
          .update({ points: user.points })
          .eq('id', req.userId);
        res.json({ success: false, message: 'Invalid response from checker' });
      }
    });
    
  } catch (err) {
    console.error('[INSTAGRAM CHECK ERROR]', err);
    res.json({ success: false, message: 'Server error: ' + err.message });
  }
});

// ✅ Check Multiple Usernames
router.post('/bulk', userAuth, async (req, res) => {
  try {
    const { usernames } = req.body;
    
    if (!usernames || !Array.isArray(usernames) || usernames.length === 0) {
      return res.json({ success: false, message: 'Usernames list is empty' });
    }
    
    const cleanUsernames = usernames
      .map(u => u.trim().replace('@', ''))
      .filter(u => u.length > 0)
      .slice(0, 20); // Max 20 per request
    
    if (cleanUsernames.length === 0) {
      return res.json({ success: false, message: 'No valid usernames' });
    }
    
    // ✅ Points check
    const { data: user, error: userErr } = await supabase
      .from('users')
      .select('points')
      .eq('id', req.userId)
      .single();
      
    if (userErr || !user) {
      return res.json({ success: false, message: 'User not found' });
    }
    
    const totalCost = cleanUsernames.length;
    if (user.points < totalCost) {
      return res.json({ success: false, message: `Need ${totalCost} points. You have ${user.points}` });
    }
    
    // ✅ Deduct points
    const newPoints = user.points - totalCost;
    await supabase
      .from('users')
      .update({ points: newPoints })
      .eq('id', req.userId);
    
    // ✅ Temp file mein usernames save karo
    const tempDir = path.join(__dirname, '../temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    const usernameFile = path.join(tempDir, 'bulk_usernames.txt');
    fs.writeFileSync(usernameFile, cleanUsernames.join('\n'));
    
    // ✅ Python bulk script call karo
    const scriptPath = path.join(__dirname, '../scripts/instagram_bulk_checker.py');
    
    exec(`python "${scriptPath}"`, { 
      timeout: 60000 
    }, async (error, stdout, stderr) => {
      
      if (error) {
        console.error('[PYTHON BULK ERROR]', error);
        await supabase
          .from('users')
          .update({ points: user.points })
          .eq('id', req.userId);
        return res.json({ success: false, message: 'Bulk check failed. Points refunded.' });
      }
      
      try {
        const results = JSON.parse(stdout);
        
        // ✅ Update total_checked
        const { data: userData } = await supabase
          .from('users')
          .select('total_checked')
          .eq('id', req.userId)
          .single();
        
        await supabase
          .from('users')
          .update({ 
            total_checked: (userData?.total_checked || 0) + cleanUsernames.length 
          })
          .eq('id', req.userId);
        
        res.json({
          success: true,
          results: results,
          remainingPoints: newPoints,
          totalChecked: cleanUsernames.length,
          availableCount: results.filter(r => r.success).length
        });
        
      } catch (e) {
        await supabase
          .from('users')
          .update({ points: user.points })
          .eq('id', req.userId);
        res.json({ success: false, message: 'Invalid response from bulk checker' });
      }
    });
    
  } catch (err) {
    console.error('[INSTAGRAM BULK ERROR]', err);
    res.json({ success: false, message: 'Server error: ' + err.message });
  }
});

module.exports = router;