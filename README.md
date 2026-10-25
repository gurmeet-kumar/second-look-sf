# Second Look

A personal agent that scouts free Facebook Marketplace finds in your selected U.S. city while you are away. Save an item brief, review evidence and missing details, and receive email alerts when a listing deserves a second look.

## What it does

- Persistent scouts with a selected U.S. city, listing age and optional size requirements. City suggestions show the state to distinguish names; no miles or pickup-radius control is required.
- Scheduled searches and a durable work queue; monitoring continues with the browser closed.
- Evidence-based text and photo screening with OpenAI, including price contradictions, fit, condition, freshness and unknown details.
- Clear rejected-listing explanations, source posting dates and direct Marketplace links. Different-city listings are rejected; an unconfirmed pickup city or state cannot trigger an email alert.
- Comparable asking-price references from recent paid SF listings, labeled by confidence. This feature remains explicitly SF-only even when the free-find scout watches another city.
- Email alerts through Resend with deduplication.
- Scout management: pause, resume, soft delete, restore, save and dismiss.

## Stack

React, TypeScript, Vinext/Vite, Cloudflare Workers and D1, Drizzle, ScrapeCreators, OpenAI, Resend, cron-job.org, and GeoNames-backed Open-Meteo city lookup. Source Sans 3 is served with the app.

## Getting started

Use Node.js 22.13 or later.

```sh
npm run install:ci
cp .env.example .dev.vars
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_needy_domino.sql
npm run dev
```

Apply the migration once to a fresh local database; do not replay it on an existing database. The explicit persistence directory makes migrations, development and built previews use the same local database.

Fill the ignored `.dev.vars` file with your own service keys. Required names are documented in `.env.example`; never put values in committed code. This repository does not include credentials, dependencies, generated builds or database contents.

## Deployment

For **Vercel**, this repository includes a Vite frontend and server-only API proxy. Import the repository with the settings in `vercel.json`; the build command is `npm run build:vercel` and the output is `dist-vercel`. Configure the four server-only values listed in [Vercel setup](deployment/vercel/README.md). Vercel hosts the public interface and proxy; the existing private Cloudflare backend retains D1, API integrations and background monitoring. Set `SECOND_LOOK_DEMO_ACCESS=open` for the interactive shared demo: visitors can create, edit, run and delete scouts without a password. Changes affect the same workspace. Leave this setting closed to require the owner management password. This does not create independent user accounts.

The original Sites/Cloudflare build remains available with `npm run build`. Its `chatgpt.site` address needs no domain purchase. An independent backend migration needs your own database, runtime secrets, app authentication and a protected scheduler endpoint. GitHub Pages cannot run the backend. See [product details](README.product.md), [background operation](AUTOMATION.md), and [framework setup](docs/starter.md).

## Development checks

```sh
npm test
npx tsc --noEmit
npm run build
```

The test runner covers screening, freshness, requested capabilities, resale matching, canonical U.S. city resolution, city-only filtering, storage lifecycle and the work queue. It uses synthetic fixtures, an in-memory SQLite adapter and mocked providers; no API keys, database dump or network access are required. Node 22.13+ includes the `node:sqlite` module used by integration checks (an experimental warning may appear). See [test details](tests/README.md).

## Demo scope

This is a hackathon prototype. The sample Alex profile is a presentation flow, not real multi-user authentication. The running app currently uses private hosting access around a shared workspace. Do not expose unprotected mutations or the worker when making an independent deployment.

Seller claims are not independently verified. Photos do not establish dimensions or working mechanisms. Comparable prices are advertised asking prices, not completed sales or an appraisal. A recent listing still needs seller confirmation before pickup.
