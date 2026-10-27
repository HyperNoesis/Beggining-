# M5 Business: what is built, what you must do, what is researched
Written 22 Oct 2026. Engineering notes, NOT legal or financial advice. Figures below are what the cited pages said that day; check the source before acting.

## Built in this build (all tested in a real browser: t30_m5, unit_m5)
- `landing.html` (public, no sign-in): honest headline, "Try it with your camera", feature cards, honest limits, pilot form, price note. `index.html` now sends signed-out visitors here (signed-in users still go to home).
- Before/after slider: shows ONLY when `assets/landing/before.jpg` and `after.jpg` exist. Until then the page shows the room pictures and says nothing about results. Make the pair in Studio, Recordings tab, "Save before and after pictures (for my website)". Use your own face or people who agreed.
- Pilot form: no server. It opens WhatsApp (if `business.whatsapp` is set) or your email (if `business.email` is set) with the message ready. Nothing is stored by the page. If neither is set it says the pilot is not open yet.
- `privacy.html`, `terms.html`: render `docs/PRIVACY.md` and `docs/TERMS.md`, fill your details from `js/config.js` (`business`), and show a red "Not ready to publish" banner while anything is missing. Placeholders are highlighted, never hidden. Privacy now covers the second-phone camera relay, the Google STUN server, local-only effects, payments, and NDPA rights.
- `js/config.js`: `business {name,email,jurisdiction,effectiveDate,whatsapp}` and `payLinks {pro}` (a hosted payment link; the Upgrade button only appears if it is an https link).
- NOT built on purpose: feature gating or licence keys (a browser-only check is trivial to bypass and the pilot is free), card handling (never touch card data), accounts changes (existing local/Supabase accounts untouched).

## What only you can do (checklist)
1. Fill `business` in `js/config.js` and replace the remaining placeholders in `docs/TERMS.md` (liability, governing law, links). Have a Nigerian lawyer read both pages before you charge anyone.
2. Take the before/after pair on your phone and drop both files in `assets/landing/`.
3. Decide the pilot contact (WhatsApp is the most used in Nigeria; set `whatsapp` with country code, for example 234...).
4. Run Diagnostics > Test effects speed on the Redmi 14C and fill `docs/DEVICE_MATRIX.md`: the landing page promises a speed test, so keep that true.
5. Business registration and NDPC steps below.

## Payments for a Nigerian seller (researched)
- Stripe: a Nigerian business generally cannot open a Stripe account directly; sellers use a supported-country entity or an intermediary. Paystack and Flutterwave are the native options. [Kolonell comparison](https://kolonell.com/en/blog/stripe-vs-paystack-nigeria-comparison-2026)
- Approximate fees (that article, 2026): local cards 1.4 to 1.5% on Paystack/Flutterwave; international cards about 3.8%; payouts about next working day. Verify on the providers' pricing pages.
- Paystack "Starter Business" lets you collect before registering a company: owner's identity and address verified; lifetime cap NGN 2,000,000 (and USD 5,000); payments switch off at the cap until you upgrade to a Registered Business; no Transfers. [Paystack support](https://support2.paystack.com/hc/en-us/articles/360009972719-What-is-a-Paystack-Starter-Business)
- The sources I read did not state Paystack's recurring-billing terms, settlement times for USD, or which documents a Registered Business needs: read Paystack's current pages before choosing.
- Suggested route (zero-spend, in order): (1) pilot free; (2) a Paystack hosted payment page or link per plan, put in `payLinks.pro`, paid customers confirmed by hand (fine for the first 20); (3) when manual confirmation hurts, Paystack Plans/subscriptions with a webhook handled by a small Supabase Edge Function that flips a plan field on the user row; only then add feature gating, enforced on the server side where possible.
- International customers: Paystack and Flutterwave take international cards at the higher rate; a merchant-of-record service (they handle tax and sell worldwide) is an option to research later. Not researched here.

## Nigeria data protection (researched; ask a lawyer)
- The Nigeria Data Protection Act 2023 and the NDPC's General Application and Implementation Directive (GAID) 2025 apply to anyone processing data of people in Nigeria. Controllers/processors "of major importance" must register: 2,500 to 9,999 data subjects (ordinary-high), 10,000 to 49,999 (extra-high), 50,000 and above (ultra-high). Extra-high and ultra-high file an annual compliance audit return; major-importance entities appoint a Data Protection Officer. Breach notice to the NDPC within 72 hours. Registration fees and deadlines were not in the sources I read: check the NDPC. [Mondaq GAID guide](https://www.mondaq.com/nigeria/privacy-protection/1693812/navigating-the-nigeria-data-protection-act-general-application-and-implementation-directive-ndpa-gaid-a-guide-for-businesses), [OAL overview](https://oal.law/data-protection-laws-in-nigeria-what-tech-companies-must-know-in-2026/)
- Genesis keeps video on the device and has no analytics, so a no-account pilot holds almost no personal data. Accounts (Supabase) and pilot messages (your WhatsApp/email) are the personal data you will hold: keep a short written breach plan and a way to delete someone on request.

## Pilot plan (first paying pilot customers)
- Who: 10 to 20 people who stream, teach, run a church or small business video. Recruit by WhatsApp groups and your own network.
- Offer: free for 30 days, you do a 20-minute setup call, they send the Diagnostics "Copy report" and a before/after if they like.
- Learn: did the first 5 minutes work, which phone, did the effects run smooth, did they go live or record, what broke. Log each in `docs/DEVICE_MATRIX.md`.
- Pricing hypotheses to test (NOT decided, do not publish): a low monthly Naira price for individuals, a higher one for churches/schools with a few devices. Ask "what would you pay" only after they used it for a week.
- Success to call M5 done: 3 pilot users who used it more than twice without help, and one who pays.
