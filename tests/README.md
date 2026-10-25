# Regression checks

After installing the project dependencies, run:

```sh
npm test
```

`node tests/run.mjs` is the equivalent direct command. Use Node.js 22.13 or later. Integration tests use the built-in `node:sqlite` module; Node may print its experimental-feature warning.

The runner checks five rule suites under `lib/` and six integration suites here:

- Screening: supported evidence, prices, dimensions, condition and unknowns.
- Freshness: source dates and reversible listing-age filters.
- Requested capabilities: standing versus ordinary desks and preserved evidence.
- Locations: canonical U.S. cities, state aliases, city-only scope and legacy radius migration.
- Resale: conservative comparison matching, dates and exclusions.
- Store lifecycle: deletion, restoration, uniqueness, atomic updates and fenced leases.
- Queue throughput: selected-scout continuation, concurrency, retry timing and deduplicated alerts.
- Freshness integration: cached and queued candidates plus email-time age checks.
- Capability integration: combined rejection reasons and uncertain standing capability.
- Resale integration: category fallback, cache policy and bounded provider calls.
- City integration: canonical create/edit routes, city mismatch and unknown handling, in-flight location changes and SF-only resale.

Integration tests compile the real store and engine against an in-memory SQLite implementation of the D1 interface. External services are replaced with local mocks. Network calls are explicitly disabled in the integration harness. Fixtures use synthetic IDs and non-deliverable example addresses. The suite does not load `.dev.vars`, read a live database or contact a seller, email provider, model or Marketplace service. Location suites replace Open-Meteo lookups with local responses too.

Generated bundles go to an automatically cleaned operating-system temporary directory. Each integration group runs in its own process to isolate its mock runtime. Integration files import the storage harness from `test-store-lifecycle.mjs`, so its lifecycle checks also run before the engine checks.

These checks do not simulate Cloudflare's production D1 concurrency, hosting access controls or live provider availability. Run the separate type check and build before deploying.
