// GET /api/config — public values the admin login page needs (the anon key is designed to be public;
// all data access is enforced by Row Level Security + the admin allowlist). No secrets here.
'use strict';

const { SUPABASE_URL, ANON_KEY, configured, send, handle, allowMethods } = require('./_lib/supabase');

module.exports = handle(async (req, res) => {
  allowMethods(req, ['GET']);
  send(res, 200, {
    ok: configured(),
    supabaseUrl: SUPABASE_URL || null,
    supabaseAnonKey: ANON_KEY || null,
  }, { 'Cache-Control': 'no-store' });
});
