# Higher Frequencies Intelligence Portal — v0.1

A browser-local, evidence-led market research and B2B operations application for Higher Frequencies, Christchurch, New Zealand.

## Launch
Run a static HTTP server from the repository root: `python3 -m http.server 8000`, then open `http://localhost:8000`. ES modules require HTTP hosting in some browsers; opening `index.html` directly via `file://` is not reliable. No build step, package installation or credentials required. Modern Chromium, Firefox or Safari recommended.

## What works
- Responsive cinematic overview and navigation
- Business creation/editing, source URLs, basic duplicate prevention, filters
- Human-scored opportunities (A/B/C), historical assessments
- Quarterly campaign creation, prospect selection, pipeline stages and follow-ups
- Research briefs with citations and unknowns; text export
- Category, geography, lifecycle and verification charts
- Local JSON export/import, confirmation before destructive replacement

## Data integrity
All research starts empty. Source URLs are user-provided and **not independently verified**. Scores do not represent purchasing intent. Targets are not results. No external API, email sending, payment processing or automatic discovery is enabled.

## Limitations
LocalStorage is device/browser/origin-specific and not secure for sensitive personal information. Back up frequently. Do not store confidential customer records here. No authentication, cloud sync, map, live registration checks, or automated messaging. Browser visual/end-to-end testing not yet verified.

See docs/ for architecture, model, integrations, deployment and testing.
