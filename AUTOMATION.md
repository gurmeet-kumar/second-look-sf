# Second Look background operation

This Site is owner-private. Preserve that access policy. The shared worker is protected by Sites dispatch, and is not suitable for public deployment without adding application authentication.

Obtain the linked Site's current `siwc_bypass_bearer_token` using the native Sites `get_site` tool. Never print, persist, or put it in a schedule prompt. Use it only as `OAI-Sites-Authorization: Bearer <token>` when calling this Site.

POST `/api/worker/tick` with an empty JSON body. It searches active scouts that are due and advances persisted detail, AI-screening, and email jobs. Provider keys stay in the server's runtime secrets. A response contains `processed`, `pending`, and `message`. The external scheduler wakes the worker once per minute; each scout only searches every ten minutes. Each call handles bounded work within its HTTP timeout. Do not force a scout ID. A transient quota delay remains queued for a future run.

GET `/api/state` and confirm `system.lastWorkerAt` is newer than the run's start. Do not create scouts, change requirements, send emails outside the app, republish the Site, or change sharing. The app sends eligible email alerts to its configured demo inbox and deduplicates them.

When no work changed, remain quiet. Notify the owner only for a meaningful persistent failure or required account action.

The app has a daily request budget of 200 Marketplace calls (reset at UTC midnight) and an estimated $3 OpenAI screening budget. A usage limit produces a visible error rather than silently claiming no matches. Increase budgets only with the owner's authorization. Resend's demo sender sends only to its account's signup inbox.
