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
  // M5 business details. The Privacy and Terms pages fill these in; while any is empty they show a visible "not ready to publish" banner.
  business: { name: '', email: '', jurisdiction: 'Nigeria', effectiveDate: '', whatsapp: '' },
  // Optional hosted payment links (e.g. a Paystack payment page). Empty = the pricing buttons say "Join the pilot" instead.
  payLinks: { pro: '' },
  supabaseUrl: '',      // e.g. 'https://xxxxx.supabase.co'
  supabaseAnonKey: '',  // the "anon public" key from Project Settings > API

  // Live calling (call.html) needs a signaling server — see server/README.md
  // to deploy one (free options included). Leave empty and Live calling
  // stays visibly disabled rather than pretending to connect to nothing.
  signalingUrl: 'wss://genesis-signaling.onrender.com',

  // OPTIONAL experimental AI re-render of a RECORDED clip (server/render-relay.js, docs/LEVEL3_EXPERIMENT.md).
  // Empty = the button is hidden and nothing is ever uploaded. If set, the clip leaves the device only after the user confirms.
  // renderRelayToken is visible to every visitor (static site): use it only as a speed bump, rely on the relay's daily cap.
  renderRelayUrl: '',
  renderRelayToken: '',

  // Powers real file transcription (Projects → Transcribe) via Groq's
  // free-tier Whisper API. Get a free key at console.groq.com/keys and
  // paste it here — set once by you, not typed in by each user.
  // IMPORTANT: this is still a client-side static site with no backend,
  // so anything in this file ships to every visitor's browser and is
  // readable via view-source/devtools. Don't treat this as a secret the
  // way you would on a server — a free/low-tier key is fine here, but
  // don't reuse a key you use elsewhere for anything sensitive.
  groqApiKey: '',

  // Powers "Create a world" (AI environment generation) via Pollinations'
  // current Unified API. Their older no-key endpoint (image.pollinations.ai)
  // is now marked legacy/deprecated in their own docs and has grown
  // unreliable — this is the actively-maintained replacement.
  // Get a key from the "Secrets" section (not "Apps") at enter.pollinations.ai/keys —
  // it'll start with sk_. The "Apps" pk_ keys are OAuth client IDs for login
  // flows, not generation, and raw legacy pk_ keys are rate-limited to
  // 1 image/hour and often blocked from specific models.
  // Same client-side caveat as the Groq key above: this ships to every
  // visitor's browser and isn't truly hidden/secret. Fine for a low-stakes
  // free-tier project; don't reuse this key anywhere sensitive.
  pollinationsApiKey: ''
};
