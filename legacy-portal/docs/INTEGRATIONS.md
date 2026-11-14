# Integrations — not active
All integration stubs throw an explicit error and make no network requests. A ChatGPT connector does not grant browser access.

- GitHub: private source repository; no browser GitHub token.
- Airtable: backend OAuth/token vault, inspect existing bases before mapping entities.
- Google Drive: authenticated server endpoints for documents/backups; preserve folder structure.
- Gmail: approved draft creation only after explicit user approval; never automatic sends.
- Stripe: optional commercial operations integration; never research scoring.
- NZBN, Companies Register, Google Places, Stats NZ: permitted official endpoints and verified provenance through authenticated server adapters, with rate limits and duplicate checks.

Keep credentials server-side. Confirm permission, NZ Privacy Act implications and anti-spam rules before collecting contacts or initiating outreach.
