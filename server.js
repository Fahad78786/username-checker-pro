const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/check', require('./routes/checker'));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/signup', (req, res) => res.sendFile(path.join(__dirname, 'public', 'signup.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.get('/api/test', async (req, res) => {
  const result = {
    supabase_url: process.env.SUPABASE_URL ? 'SET' : 'NOT SET',
    supabase_key: process.env.SUPABASE_KEY ? 'SET' : 'NOT SET',
    jwt: process.env.JWT_SECRET ? 'SET' : 'NOT SET',
    node_version: process.version
  };
  try {
    const supabase = require('./supabase');
    const { data, error } = await supabase.from('users').select('id').limit(1);
    result.supabase_connection = error ? ('ERROR: ' + error.message) : 'OK';
  } catch (e) {
    result.supabase_connection = 'EXCEPTION: ' + e.message;
  }
  res.json(result);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Node version: ${process.version}`);
});
