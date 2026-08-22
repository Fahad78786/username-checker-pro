const { createClient } = require('@supabase/supabase-js');

let supabase;

function getSupabase() {
  if (!supabase) {
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_KEY
    );
  }
  return supabase;
}

module.exports = getSupabase();