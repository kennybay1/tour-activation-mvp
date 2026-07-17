This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## API

Both endpoints run server-side with the Supabase service role key (`SUPABASE_SERVICE_ROLE_KEY`), which is never exposed to the browser.

### POST /api/claim

Registers a fan against a campaign and decides whether they unlock the reward based on their location.

Body: `{ slug, email, marketing_consent, lat, lng, accuracy, session_id }`

Behaviour:

- Looks up the campaign by `slug`. If it doesn't exist, is inactive, or the current time is outside its `starts_at`–`ends_at` window → `{ "status": "expired" }`.
- Rate limit: at most 10 claim attempts per email per campaign in any 10-minute window; beyond that → HTTP 429 `{ "error": "rate_limited" }`. Attempts are counted via `claim_attempt` rows in `events`.
- The claim is upserted on `(campaign_id, email)` **before** the location check, so a registration is recorded even if the fan is out of range. Email is validated and lowercased server-side. If `marketing_consent` is true, `consent_at` is set.
- Distance from the campaign point is computed with the haversine formula. Effective radius = `radius_m + min(accuracy, 50)` — a small grace allowance for GPS noise, capped so an inaccurate fix can't unlock from far away.
- Outside the effective radius → `{ "status": "out_of_range", "distance_m": <n> }` (no reward fields), and an `unlock_out_of_range` event is logged.
- Inside, already unlocked → `{ "status": "already_claimed", reward_content_url, discount_code, ticket_url }` so a fan who lost the page can get back in.
- Inside, first unlock → claim marked `unlocked`, `unlock_success` event logged → `{ "status": "unlocked", reward_content_url, discount_code, ticket_url }`.
- `reward_content_url` and `discount_code` only ever appear in responses after a passed location check.
- The fan's raw lat/lng is never stored — only the computed `distance_m` and `location_accuracy_m`.

Validation errors return HTTP 400 with `{ "error": "invalid_json" | "invalid_slug" | "invalid_email" | "invalid_location" }`.

### POST /api/track

Logs an analytics event for a campaign.

Body: `{ slug, session_id, event_type, metadata }`

- `event_type` must be one of: `page_view`, `permission_granted`, `permission_denied`, `location_error`, `register`, `ticket_click` (HTTP 400 otherwise).
- The campaign id is resolved from `slug` (HTTP 404 if unknown), then the event is inserted into `events`.
- Returns `{ "ok": true }`. Never returns reward fields.

## Deploying to Vercel

### Environment variable checklist

Add these three in Vercel under **Project Settings → Environment Variables** (all three for the Production environment; add them to Preview too if you want working preview deploys):

| Variable | Value | Exposed to browser? |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL, e.g. `https://xxxx.supabase.co` — **no path after `.co`** | Yes (safe) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | The publishable/anon key (`sb_publishable_...`) | Yes (safe, protected by Row Level Security) |
| `SUPABASE_SERVICE_ROLE_KEY` | The secret key (`sb_secret_...`) | **No — server only. Never prefix with NEXT_PUBLIC.** |
| `ADMIN_EMAIL` | The email of the single admin account (see "Admin area" below) | **No — server only.** |

Both keys are in the Supabase dashboard under **Settings → API**.

### Connecting the GitHub repo

1. Go to [vercel.com](https://vercel.com) and sign up / log in — choose **Continue with GitHub** so the accounts are linked.
2. Click **Add New… → Project**.
3. Under "Import Git Repository", find **tour-activation-mvp** and click **Import**. (If it's not listed, click "Adjust GitHub App Permissions" and grant Vercel access to the repo.)
4. Leave the defaults — Vercel auto-detects Next.js. Don't change the build command or output directory.
5. Before clicking Deploy, open the **Environment Variables** section on that same screen and add the three variables from the checklist above.
6. Click **Deploy** and wait a minute or two.
7. You'll get a live URL like `tour-activation-mvp.vercel.app`. Test it: open `/c/your-campaign-slug` on your phone.

From then on, every push to `main` on GitHub deploys automatically. Pull requests get their own preview URLs.

### After the first deploy

- Add a custom domain (optional): **Project Settings → Domains**.
- Campaign links to share with fans look like: `https://your-domain/c/<slug>`.

## Admin area

`/admin` is a password-protected area for the (single) site owner. There is deliberately no signup or password-reset flow.

Setup, once:

1. In the Supabase dashboard go to **Authentication → Users → Add user → Create new user**. Enter your email and a strong password, and tick **Auto Confirm User**.
2. Set `ADMIN_EMAIL` to that exact email in `.env.local` (and in Vercel's environment variables for the live site).
3. Recommended: in **Authentication → Sign In / Up**, disable public signups — nobody else should ever create an account.

Sign in at `/admin/login`. Every admin page is checked on the server: a valid login session **and** an email match against `ADMIN_EMAIL`, otherwise you're redirected to the login page. Admin data is fetched with the service-role key on the server only — the browser-side (anon) client can only ever see the public campaign fields, never `discount_code` or `reward_content_url`.
