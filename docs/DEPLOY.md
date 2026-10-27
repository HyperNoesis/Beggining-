# Deploying Genesis

This app is plain HTML/CSS/JS — no build step, no bundler — so deployment
is just: real accounts (Supabase) + version control (GitHub) + static
hosting (several free options). Here's the actual path, in order.

## 1. Create a Supabase project

1. Go to supabase.com, create a free project.
2. Project Settings → API: copy the **Project URL** and the **anon public** key.
3. Copy `js/config.example.js` to `js/config.js` (this second file is
   gitignored on purpose — see below) and paste your values in:
   ```js
   window.VS.config = {
     supabaseUrl: 'https://xxxxx.supabase.co',
     supabaseAnonKey: 'eyJ...'
   };
   ```
   That single change flips the whole app from local-only accounts to real,
   cross-device accounts — nothing else needs editing (see
   `js/providers/auth-provider.js` if you want to see how).

## 2. Run the schema

1. In your Supabase project: SQL Editor → New query.
2. Paste the entire contents of `supabase/schema.sql`, run it.
3. This creates `profiles`, `recordings`, `environments`, and `usage_events`
   tables, each with row-level security so users can only ever see their
   own data.

## 3. Create storage buckets (recordings) and run the schema

`supabase/schema.sql` (step 2 above) already creates the `recordings` and
`environments` storage buckets and their access policies via SQL — you
don't need to click "New bucket" manually. Once you've run the schema and
filled in `js/config.js`, recordings automatically save to Supabase Storage
+ Postgres instead of IndexedDB (`js/providers/storage-provider.js` — same
local/cloud switch pattern as auth). No other file needs to change.

## 4. Push to GitHub

```bash
cd virtual-studio
git init
git add .
git commit -m "Genesis v1"
git branch -M main
git remote add origin https://github.com/<your-username>/<repo-name>.git
git push -u origin main
```

**Before you push:** `js/config.js` will contain your Supabase anon key.
That key is meant to be public (it's restricted by the row-level security
policies you just ran, not by secrecy) — but double check you never put a
*service role* key anywhere in this frontend code. Only the anon key
belongs here.

## 5. Host it (pick one, all free)

- **GitHub Pages**: repo Settings → Pages → deploy from the `main` branch.
  Your app is live at `https://<username>.github.io/<repo-name>/`.
- **Vercel** or **Netlify**: connect the GitHub repo, no build command
  needed (it's static), deploy. Both give you a real HTTPS domain and
  preview URLs per commit.

## 6. Camera permissions in production

Browsers only allow camera/mic access on HTTPS or `localhost` — GitHub
Pages/Vercel/Netlify all serve HTTPS by default, so this isn't extra work,
just confirming why it'll keep working once deployed.

## What's still local-only after this

Custom environment uploads (`environments.html`) still save to this
browser's storage even with Supabase turned on — the `environments` table
and bucket exist and are ready, but wiring the upload flow is a separate
follow-up. Recordings are fully cloud-synced once you complete steps 1-2
above.
