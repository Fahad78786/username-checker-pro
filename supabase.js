const WebSocket = require('ws');
global.WebSocket = WebSocket;

const { createClient } = require('@supabase/supabase-js');
const https = require('https');

const customFetch = (url, options = {}) => {
  return fetch(url, {
    ...options,
    // Force IPv4 to avoid Render's IPv6 issue
    agent: undefined
  });
};

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
  {
    auth: { persistSession: false },
    realtime: { enabled: false },
    global: {
      fetch: (...args) => fetch(...args)
    }
  }
);

module.exports = supabase;