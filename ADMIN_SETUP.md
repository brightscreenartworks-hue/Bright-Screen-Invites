# Bright Screen Invites — Admin Panel setup

The admin panel lives at **`/admin/`** on the same Vercel site
(e.g. `https://brightscreeninvites.vercel.app/admin/`). It needs a free **Supabase**
project (database + login + image storage). Setup takes about 15 minutes, once.

> Until steps 1–4 are done the public website keeps working exactly as before
> (it falls back to the cards already written in the HTML pages).

---

## 1. Create the database (Supabase)

1. Go to <https://supabase.com> → **New project**. Region: **Mumbai (ap-south-1)**. Save the database password somewhere safe.
2. Open **SQL Editor → New query**, paste the whole of `supabase/schema.sql`, click **Run**.
3. New query again, paste `supabase/seed.sql`, click **Run**.
   This copies every existing category, subcategory and sample from the live site (62 samples, 18 categories) into the database. Both files only *add* data — re-running them never overwrites or deletes anything.

## 2. Lock down sign-in

In Supabase → **Authentication**:

- **Sign In / Providers → Email**: keep *Email* enabled, turn **OFF “Allow new users to sign up”**.
  (Even if this were left on, the database rejects any account whose email is not on the admin allowlist.)
- **URL Configuration**: *Site URL* = `https://brightscreeninvites.vercel.app` and add `https://brightscreeninvites.vercel.app/admin/` to *Redirect URLs* (used by “Forgot password?”).

## 3. Add environment variables in Vercel

Vercel → your project → **Settings → Environment Variables** (Production + Preview):

| Name | Where to find it |
|---|---|
| `SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `SUPABASE_ANON_KEY` | Supabase → Project Settings → API → `anon` `public` key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → `service_role` key (**secret — never put it in HTML/JS files**) |
| `SITE_URL` | `https://brightscreeninvites.vercel.app` |
| `SUBMIT_SALT` | any long random text (used to anonymise visitor IPs for spam protection) |
| `CALLMEBOT_API_KEY` | see step 5 (or the Meta / Twilio variables if you use those) |

Then **redeploy** (Deployments → ⋯ → Redeploy) so the variables take effect.

## 4. Create the admin logins

Only the emails on the allowlist can ever sign in (maximum 3 by default — changeable in *Settings*).

**Option A — one command (from the repo folder on your Mac):**

```bash
SUPABASE_URL="https://xxxx.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="paste-service-role-key" \
ADMIN_EMAILS="first@gmail.com,second@gmail.com,third@gmail.com" \
node scripts/setup-admins.mjs
```

It adds the three Gmail addresses to the allowlist and asks you to type a password for each
(min. 10 characters, letters + numbers). Passwords are stored by Supabase Auth as secure hashes only.

**Option B — in the Supabase dashboard:**

1. SQL Editor → run (with your three emails):
   `insert into public.admin_allowlist (email) values ('first@gmail.com'), ('second@gmail.com'), ('third@gmail.com');`
2. Authentication → Users → **Add user → Create new user** for each email, tick **Auto Confirm User**.

Afterwards everything (adding/removing admins, passwords) can be managed from **Admin Access** inside the panel.

## 5. WhatsApp forwarding

Every client submission is **saved to the database first**, then forwarded to the business WhatsApp
from the server (no keys in the browser). If WhatsApp fails, the record is still saved and shows a
*Retry sending* button.

Choose a method in **Admin → WhatsApp Settings** (it shows the exact steps):

- **CallMeBot (free, quickest):** activate it from the business WhatsApp at callmebot.com → “WhatsApp API”, put the key in `CALLMEBOT_API_KEY`, redeploy, then press **Send test message**.
- **WhatsApp Cloud API (Meta, official):** `META_WA_TOKEN`, `META_WA_PHONE_NUMBER_ID`, `META_WA_TEMPLATE` (approved template with one `{{1}}` body variable).
- **Twilio:** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`.

## 6. Deploy

Commit the changes and push to `main` — Vercel deploys automatically.

## 7. After deploying — 5-minute check

1. Open `/admin/`, sign in with each admin account. An email that is not allowlisted must be refused.
2. **Upload New Sample** → paste a YouTube Shorts link → thumbnail appears → choose *Video Invites › Engagement Invites* → **Preview on website** → **Save**. Open `video-invites.html#engagement-invites` — the card is there (allow ~15 s for the cache).
3. Upload a custom thumbnail on that sample → it replaces the YouTube one on the site.
4. **Hide** it → it disappears from the site. Delete it.
5. Submit `fill-details.html` with test data → it appears in **Client Submissions**, and the WhatsApp message arrives.
6. **Settings → Download full backup** works.

---

## How it fits together

| Piece | What it does |
|---|---|
| `admin/` | The admin panel (static files; all data access is checked by the database). |
| `assets/bs-live.js` | Added to the 4 category pages + home page. Loads published samples/categories from `/api/catalog` and renders them with the *exact same card HTML* as before. If the API is unavailable, the page keeps its existing static cards. |
| `assets/bs-submit.js` | Added to `fill-details.html` and the home page form. Saves submissions via `/api/submit` without changing the existing WhatsApp/email flow. Duplicate submissions are ignored; failed sends are retried later from the visitor's browser. |
| `collection.html` | Page used automatically for brand-new top-level categories created in the admin. |
| `api/` | Vercel serverless functions: `catalog` (public, read-only), `submit` (save + WhatsApp), `thumbnail`, `config`, `admin/whatsapp`, `admin/users` (admin-only). |
| `supabase/schema.sql` | Tables, Row Level Security, allowlist, history/activity triggers, recovery bin, storage bucket. |

**Data safety**

- Client submissions are never deleted automatically. A manual delete requires typing `DELETE`, and a full copy goes to **Settings → Recovery bin**, from where it can be restored.
- Categories that still contain samples cannot be deleted (hide them instead).
- **Settings → Download full backup** exports everything as JSON — do this monthly. Supabase Pro adds automatic daily backups if you want them.

**Updating samples by hand-editing HTML is no longer needed.** If you ever edit the HTML cards directly, those edits only show when the database is unreachable; manage samples in the admin panel instead.
