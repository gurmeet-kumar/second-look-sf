# Vercel server proxy

The Vercel browser app uses `/api/*` on its own origin. These routes proxy only
the approved application endpoints to the existing owner-private Site. The
Cloudflare D1 database and cron-job.org worker continue running there.

Configure these **server-only** Vercel environment variables:

- `SECOND_LOOK_BACKEND_URL`: `https://second-look-sf-finds.cocoa-trout-0039.chatgpt.site`
- `SECOND_LOOK_BACKEND_TOKEN`: the supported service access credential for that Site.
- `SECOND_LOOK_ADMIN_PASSWORD`: at least 12 characters; use a random password.
- `SECOND_LOOK_SESSION_SECRET`: at least 32 characters; use a separate random secret.

Never prefix these names with `VITE_` or `NEXT_PUBLIC_`. Never commit their values.
The proxy pins the backend origin, rejects redirects, excludes cookies from
upstream requests, bounds bodies to 8 KiB, and returns generic upstream errors.
The backend service token is sent only as `OAI-Sites-Authorization` to that Site.

Session protocol:

- `GET /api/session` returns `{ canManage, loginAvailable }`.
- `POST /api/session` with JSON `{ password }` returns `{ canManage: true }` and
  a signed 12-hour `__Host-second-look-admin` cookie.
- `DELETE /api/session` returns `{ canManage: false }` and clears the cookie.

The cookie is HttpOnly, Secure, SameSite=Strict, and restricted to `/` on the
current host. Every write requires an HTTPS same-origin request. Every proxied
write also requires the signed owner session. Local HTTP does not set an owner
session; use a Vercel HTTPS preview to check login.

Anonymous visitors can read sanitized state and city searches. Public state
excludes emails, deleted scouts, internal budget details, errors and activity.
City query results have a bounded 60-second per-instance cache. Public visitors
cannot modify shared scouts, mark listings, trigger scans or refresh resale.
The worker endpoint is never proxied; keep the existing private scheduler.

This is a single owner demo, not independent accounts or per-user data storage.
Changing the session secret invalidates all existing owner cookies.

Run isolated tests with `node deployment/vercel/proxy.test.mjs`. Tests use fake
credentials and injected responses; they make no network calls.
