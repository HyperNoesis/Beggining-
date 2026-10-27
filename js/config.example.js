/**
 * App configuration.
 *
 * Leave both fields empty to keep using local-device-only accounts
 * (js/providers/auth-provider.js -> LocalAuthProvider) — nothing to set up,
 * works offline, no cost.
 *
 * Fill both in once you've created a Supabase project (see docs/DEPLOY.md)
 * to switch to real, cross-device accounts backed by Postgres + Supabase
 * Auth. No other file needs to change — this is the one switch.
 */
window.VS = window.VS || {};
window.VS.config = {
  business: { name: '', email: '', jurisdiction: 'Nigeria', effectiveDate: '', whatsapp: '' },   // fills Privacy/Terms pages + pilot contact
  payLinks: { pro: '' },                                                                          // optional hosted payment link
  supabaseUrl: '',      // e.g. 'https://xxxxx.supabase.co'
  supabaseAnonKey: ''   // the "anon public" key from Project Settings > API
};
