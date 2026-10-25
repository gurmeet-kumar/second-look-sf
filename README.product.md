# Second Look

A personal scout for free Facebook Marketplace items in a selected U.S. city. Save a brief, let the cloud worker search, review evidence and unknowns, and receive eligible email alerts.

## Working demo

Private app: https://second-look-sf-finds.cocoa-trout-0039.chatgpt.site

Sign in with the owning ChatGPT account. This is a shared owner-private hackathon prototype, not a public multi-user service. The worker relies on the private Sites dispatch boundary. Do not change the audience to public without adding application authentication and record ownership checks.

## Features

- Sample login as Alex Morgan, with a clearly labeled demo profile and sign out. This is a presentation flow, not a separate authentication boundary or multi-user account system; the private Sites boundary still controls access. Notification mail stays with the configured team inbox.
- View every query in My scouts, with current status, last successful search, next check and reviewed listing counts. Status refreshes every ten seconds.
- Choose a U.S. city using GeoNames-backed Open-Meteo suggestions, with the state shown to distinguish same-named cities. The server resolves and stores a canonical city ID and center; device location is not used. There is no user-configured miles or radius control. Original SF neighborhood scouts now use San Francisco city scope.
- Create, edit, pause, resume and finish up to three scouts. Delete a scout to cancel queued work and alerts and free a slot. Recently deleted scouts can be restored with their finds, in a paused state.
- Search free listings with a source date filter, retrieve item details and verify the stated pickup city and state. Listings in a different city are rejected; an unconfirmed city/state cannot trigger alerts. Search uses a bounded internal area around the selected center as a retrieval hint, not a user pickup-distance rule. It does not guarantee an exhaustive crawl of municipal boundaries. Listing-age choices are 24 hours (default), 7 days and 30 days. Source filters can leak older results, so the app independently enforces age, including on cached matches and immediately before sending alerts. Known-old candidates skip AI; unknown dates remain flagged and never trigger alerts.
- Prioritize relevant local candidates, batch database writes, and check up to three independent tasks at once. An initial visible check continues its saved queue without waiting for a cron tick or issuing a fresh search on each continuation. The foreground session is bounded; cloud checks continue when the page is closed.
- Screen text and one photo with OpenAI GPT-5.4 Mini using strict structured output.
- Require evidence for dimensions, brand, model and seller-reported functioning. Standing-desk scouts show a separate requested-capability check even when another rule already rejects the item, including a different pickup city. Generic wood desks, a single height measurement and photos alone do not establish standing or adjustable capability; explicit contradictory seller text is treated separately from missing evidence. Available inexpensive failure reasons are retained together, and cached rejections receive the same check without extra provider calls. Obsolete radius failures are removed from cached reviews. A previously unreviewed radius-only exclusion must be screened before it can alert.
- Show source posting dates and age, sorted newest first among the returned relevant matches. Never substitute discovery time for posting time. Relative source phrases retain their observation date when known and never become fabricated exact dates. Show Strong fit, Needs checking, and honest unknown information. A separate Rejected tab exposes stored failures, cited evidence and original listings without additional provider calls. Failure reasons are separate from supporting notes, and rejected records cannot trigger alert emails. Display prices as listed amounts; discovery times do not establish posting times.
- Save or dismiss finds; copy a seller question and open the original listing.
- Send email alerts through Resend with durable deduplication and provider idempotency.
- Check real Facebook Marketplace asking prices on demand. Prefer an identified brand/model; when that is missing or sparse, use a supported specific chair, desk or monitor category derived from the actual listing. Similar-item references are explicitly low confidence. Require at least three qualifying prices for a range, but show one or two comparison links when evidence is sparse. The price-reference feature remains explicitly SF-only, even when the free-find scout is in another U.S. city. It searches from SF independently of that scout. Keep explicitly San Francisco, source-dated listings within 30 days and exclude clear parts, bundles, faults and incompatible conditions. These are advertised prices, not completed sales or an appraisal. At most two search requests are used per check, with no extra model calls. Useful results cache for 24 hours (while comparison dates remain eligible); insufficient results cache for two minutes. An explicit refresh bypasses either cache.
- Store scans, work queues, results and alerts in D1. A cron-job.org worker wakes every minute; each active scout searches every ten minutes.

## Configuration

Copy `.env.example` to the ignored `.dev.vars` for local development. Configure the same names as hosted runtime secrets. Never commit key values.

Required: `SCRAPECREATORS_API_KEY`, `OPENAI_API_KEY`, `OPENAI_MODEL` (default `gpt-5.4-mini`), `RESEND_API_KEY`, `DEMO_EMAIL`.

Resend's `onboarding@resend.dev` sender only sends to the Resend account's signup inbox. A verified domain is required for other recipients.

## Local development

Use Node 22.13 or later. Install with the supplied Sites dependency helper or `npm run install:ci`. Run `npm run build`, then apply each pending Drizzle SQL migration to local D1 with the starter's documented Wrangler command. Run `npm run dev` for the local preview. Local and hosted databases are separate.

`npx tsc --noEmit` checks types. `lib/location.test.ts` covers canonical city resolution, source city/state checks and legacy radius handling. `lib/screening.test.ts` covers evidence validation, dimension conversion, mismatched axes, unsupported facts, unknowns, hard constraints and image failure. Storage checks cover unique matches/alerts, atomic leases and paused-scout exclusion.

The search combines relevance ordering (`suggested`) with `date_listed` (1, 7 or 30), independently enforces the selected age and sorts valid source timestamps newest first. It checks one returned page of at most 30 candidates per search; this is not an exhaustive Marketplace crawl. The source date filter may still return older items. Historical latency test: a live comparison found newest-first returned mostly distant desks for a gaming-chair query. In a local end-to-end run using the real providers, the first reviewed chair appeared in 9.39 seconds and the 15-candidate queue finished in about 24 seconds. This is one measured run, not a latency guarantee. The UI separates reviewed candidates, matches, waiting work, failures and completed searches without suitable matches.

## Background operation and limits

See `AUTOMATION.md`. cron-job.org job 8716173 calls the private worker; its authorization header stays in scheduler configuration, not this repository. Cloud execution has been verified through scheduler history and database readback.

The current guardrails are 200 Marketplace requests per UTC day and an estimated $3 OpenAI screening budget for the demo. Credits, provider quotas and source availability still apply. The app does not purchase more credits. Cached results remain available on service failures.

Signing out does not pause cloud scouts. Pause or delete them to stop their checks and alerts. Deletion prevents future work, but an email already being delivered may still arrive. Deletion is recoverable from Recently deleted; restoration leaves monitoring off until explicitly resumed.

Photos cannot establish exact physical dimensions, electrical/mechanical function or hidden damage. Seller claims are not independently verified. Only the source timestamp or a clearly identified source phrase is shown as posting information. First-seen timestamps remain internal discovery metadata. A recent date or a still-published listing does not prove the seller still has the item; seller confirmation is required before pickup.

## Before public release

Add per-user authentication and data ownership, a narrowly scoped external worker credential, verified sender domain and recipient ownership, provider billing controls, and more extensive field testing. Preserve the current private audience until those changes are implemented.
