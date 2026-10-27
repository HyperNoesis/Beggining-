# Privacy Policy

**[PLACEHOLDER: Effective date]**

This policy describes what Genesis does with your data. It's written to
match what the code actually does — not boilerplate. If a future feature
changes what leaves your device, this file must be updated in the same
change (see MASTER_ROADMAP.md's standing cleanup items).

Genesis is operated by **[PLACEHOLDER: legal entity / your name]**,
based in **[PLACEHOLDER: jurisdiction, e.g. Nigeria]**. Contact:
**[PLACEHOLDER: contact email]**.

## What stays on your device

- Your camera and microphone feed. All background removal, compositing,
  and recording happens locally in your browser. Your video is never
  uploaded anywhere unless you explicitly hit Record → cloud sync (see
  below) or Go Live.
- Recordings, templates, and brand-kit settings, by default — stored in
  your browser's local storage / IndexedDB, on this device only, unless
  you've set up a real account (see "Cloud accounts" below).

## What leaves your device, and when

- **Live streaming (Go Live):** your composited video/audio stream is
  sent to whatever WHIP ingest URL or RTMP relay you provide. You choose
  the destination; Genesis has no server in this path.
- **File transcription (Editor → Transcribe):** the audio/video file you
  choose to transcribe is sent directly to Groq's API using your own
  Groq API key, which is stored only in this browser's local storage.
  Never sent anywhere except Groq, and only when you transcribe.
- **AI environment generation (Create a world):** the text prompt you
  type is sent directly to Pollinations.ai to generate an image. No
  other data about you or your session is sent. Pollinations is a
  third-party, unmoderated API — see the Content Moderation note below.
- **Cloud accounts (optional, Supabase):** if the app has been configured
  with a real Supabase backend, creating an account sends your name,
  email, and (hashed, never plaintext) password to Supabase's servers to
  enable cross-device sign-in. Recordings and templates you explicitly
  sync are stored in Supabase Storage/Postgres under your account, with
  row-level security so only you can read your own data.

- **Second phone as a camera, phone remote, live calls:** your phones set up a direct connection through a small relay (signalling) server that sees a random room code and the connection details (including network addresses) for a few seconds. The video itself goes phone to phone, not through the relay. To find a route, the browser asks a public Google STUN server, which sees your network address. If your network blocks direct connections these features will not connect (there is no TURN relay, so nothing is relayed through any server of ours).
- **Streaming health numbers:** the Go Live health line is calculated on your device from your own connection statistics; nothing is sent to us.
- **Noise removal, colour grades, LUTs, skin smoothing, trim:** all run on your device. A LUT file you load stays in this browser.
- **Payments (when offered):** card details are entered on the payment provider's own page and never reach Genesis. We keep only the fact that a payment was made.

## What Genesis itself never collects

- No ad tracking, no analytics beyond what's explicitly listed above.
- No selling or sharing of your data with third parties beyond the
  services you directly invoke (Groq, Pollinations, your chosen
  streaming destination, or Supabase if configured).

## Your controls

- Local-only mode (no account) means nothing about your recordings or
  templates ever leaves your device.
- You can delete your account and its cloud data at any time from
  Settings (calls a database function that only ever deletes your own
  row).
- You can clear local data any time via your browser's site data
  settings.

## Your rights (Nigeria Data Protection Act 2023)

You can ask to see, correct or delete the personal data held about you, withdraw consent, and object to some processing. Write to the contact email above. Genesis keeps as little as possible: with no account, nothing about you is held by us at all.

## Changes to this policy

**[PLACEHOLDER: how you'll notify users of changes — e.g. a dated
changelog on this page, or an in-app banner]**
