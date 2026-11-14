# Higher Frequencies — Departmental & Registry Closure (104/116)

Integrated Reporting and Executive workspaces, source-linked specialist objective inspection and governed Administration source/hub management. See `docs/HF18-DEPARTMENTAL-REGISTRY-CLOSURE.md` for verification and remaining Windows/live gates. No user database is bundled or replaced.

---

# RC8 Incremental Discovery & Governed Handoff

Preserves the complete RC7 application. Adds automatic governed review queueing for attributed manual imports, idempotent processing stages and public source-linked named-organiser search. **Not a live NZBN/business registry or fully operational autonomous market discovery release.** See `docs/RC8-IMPLEMENTATION-AND-ACCEPTANCE.md` for tests, migration and outstanding gates.

---

# RC6 — Incremental Public Discovery and Source Governance

The existing RC5 ecosystem is preserved. RC6 adds a no-login **local curated public event explorer**, a 25-pathway **governed source registry**, verified-vs-failed connector status and reconciliation of **116 original mandatory requirements**. The full RC6 live-ingestion acceptance gate remains **OPEN**: genuine data.govt.nz retrieval was attempted through the application, but DNS returned `EAI_AGAIN`, so **zero new automatic source records** were ingested. The manual ChristchurchNZ events remain publisher-attributed manual observations; no buyer interest is verified.

Read `docs/RC6-IMPLEMENTATION-AND-ACCEPTANCE.md` for evidence, caveats and explicit blockers. Test with `node --test tests/*.test.mjs` and probe on an internet-enabled host with `node scripts/rc6-network-probe.mjs ./rc6-network-evidence.json`. The Windows launcher, RC5 authentication, SQLite, source analysis and governance remain unchanged. Public search exposes only a curated publisher snapshot and never internal tenant data.

---

# RC5 — Evidence Learning & Strategic Synthesis (Development Preview)

**Starting point: RC4, preserved.** An authenticated Super User can import the five genuine, manually attributable ChristchurchNZ events; review each source into immutable Education Hub knowledge; generate source-linked Marketing and Finance assessments; combine them into Management-reviewable Collective/Decision Intelligence briefs; see a dedicated strategic notification and revisit the decision. History and notification states survive SQLite restarts. **No genuine automated external retrieval has succeeded in this sandbox.** The authorised data.govt.nz on-demand connector was attempted and logged as failed (outbound network/DNS unavailable). No sales or forecasts were fabricated.

**Run:** extract entire ZIP, then double-click `Start-Higher-Frequency.cmd` (Windows, Node.js >=22), sign in once, import the sample events in **Intelligence inbox · Super User**, and use **Review for Education Hub** followed by **Run Marketing + Finance + Collective synthesis** on a sourced report. Examine the **Education Hub · specialist intelligence · strategic decisions** panel and record Management decisions explicitly. Review `docs/RC5-INTELLIGENCE-LEARNING-AND-SYNTHESIS.md` for precise verification, limitations and provider status.

**Reproduce:** `node scripts/rc5-integration-demo.mjs` (real HTTP/SQLite run using attributable public facts); `node --test --test-concurrency=2 tests/*.test.mjs` (existing + RC5 suite); `node browser/rc5-synthesis-cdp-acceptance.mjs` (Chromium DOM with mediated real localhost HTTP, not native browser network). No account, credential or client data shipped in the archive. Existing baseline financials untouched.

---

# Higher Frequency — Local Operations Centre

**RC4 intelligence activation — development preview, not a production or verified Windows beta.** The current dashboard, Security/Caretaker modules and Research workbench are part of the existing Higher Frequency repository. The browser acceptance gate for Research is still open.

## RC4: genuine Christchurch / Canterbury market intelligence

**New: working attributed-source ingestion → SQLite-backed intelligence reports → Super User inbox.** This is an additive continuation of RC3: the original workspaces, Management review gates and historical records are retained.

1. Follow the Windows start instructions below. Sign in once using your Super User credentials.
2. Your default authorised workspace is **Intelligence inbox · Super User**. Select **Import attributed ChristchurchNZ event observations** to run the included reproducible public-facts demonstration. The five records were manually transcribed and verified against the linked ChristchurchNZ public event listings on **13 November 2026**, not pulled through an official API. They are **real published events, not fabricated prospects**.
3. Five evidence-linked reports and five notifications appear. Open a notification to view the published facts, possible Higher Frequencies commercial relevance, source hash, confidence, research gaps and explicit Management review controls. This is *service fit only*; **no buying intent** or right to contact is inferred.
4. Use **Source ingestion** to import a lawful attributed JSON export with a provider and HTTPS source URLs. Repeat the demonstration to verify unchanged records are deduplicated; new/changed source records produce alerts. All reports and read states persist in the SQLite database. No automatic outreach.
5. **Run open data.govt.nz catalogue API** performs an on-demand authorised machine-readable catalogue search when the computer has internet access. It only creates *dataset metadata signals* (not invented events/leads). Dataset-specific licence obligations still apply. **Ticketmaster** requires `HF_TICKETMASTER_API_KEY` set in the server environment and source enablement in Discovery controls; credentials are never stored in the web browser or repository. Provider credentials and API access are not included in the archive.
6. **Discovery controls** store zones, radius, industries, event types, sources and evidence threshold. Current geographic filtering is textual (Christchurch/Canterbury); exact radius and automatic daily/weekly scheduling are **not yet implemented**. There is no promise of background monitoring when the application is shut down.

**Reproduce the actual HTTP/SQLite demonstration:** `node scripts/activation-demo.mjs` (writes `docs/test-evidence/RC4-ACTIVATION-LIVE-WORKFLOW.json`). This executes against real published event facts from the included attributable manual snapshot, *not* a fake network response. **Run backend regression:** `node --test --test-concurrency=4 tests/*.test.mjs`. **Chromium UI validation:** `node browser/discovery-cdp-acceptance.mjs` uses a host bridge to real HTTP only because the verification environment manages Chrome with URLBlocklist `*`. This verifies real browser DOM presentation and server persistence, **not** native browser navigation or Windows desktop launching.

Read `docs/RC4-REAL-INTELLIGENCE-ACTIVATION.md` for operational sources, evidence, dependencies, limits and classification. No proprietary credentials or default user account are shipped.

## Windows — start without editing source

1. Install **Node.js 22 or newer** (LTS) from https://nodejs.org/ and reopen Command Prompt.
2. Extract **the entire ZIP** to a normal writable folder (for example, Documents\Higher-Frequency). Do not launch it while still inside the ZIP.
3. Double-click **`Start-Higher-Frequency.cmd`**. On first start, enter an administrator username and a password of at least 12 characters. Password entry is hidden. The administrator account is stored in the local SQLite database.
4. The launcher waits for the local server and opens your default browser to **http://127.0.0.1:4173**. If the browser does not open, visit that address manually.
5. Sign in using the administrator credentials you created. To stop the server, return to the console and press **Ctrl+C**.

The database is stored in `data/runtime/ecosystem.sqlite` next to the application, and survives normal restarts. A Super User can create integrity-checked local SQLite backups in the Administration section; backups are saved to `data/runtime/backups/`. Restoration deliberately requires the server to be stopped and a new destination database file, protecting the active database from accidental overwrite. Backups contain sensitive account and business data and must remain private. Keep backups of the `data` directory. No online service or npm install is required for the supported Node application. The launcher is a batch script plus Node.js, **not a standalone executable**.

### Troubleshooting

- **Connecting to local service**: Make sure you extracted this updated build, rather than running an older version. Reload the page using Ctrl+F5. The corrected CSP must include a real `sha256-...` script hash, not the literal `${scriptHash}` placeholder.
- **Node not found**: Install Node.js 22+ and reopen the terminal.
- **Port 4173 already in use**: Stop the other Higher Frequency process. The launcher prints the actual error; do not run multiple servers on the same port.
- **Signed out / Authentication required**: Sign in to view the tenant-scoped operations and Research workbench.
- **Browser managed by an organisation**: If your own organisation blocks local pages, its administrator must authorise the address. Do not disable managed policies.

## Developer verification

From the extracted application directory:

```bash
node --test tests/*.test.mjs
node server.mjs
```

Research browser acceptance (where Chromium is available and local URL access is authorised):

```bash
node browser/research-cdp-acceptance.mjs
```

The local server listens on the loopback address only. It does not automatically contact prospects, publish marketing, or change approved Higher Frequencies financial forecasts.

## Operational workflow and evidence provenance

After first sign-in, select **Provision scoped department workers (Management)**. This one authenticated action provisions both the legacy Research→Decision→Reporting chain and Research, Marketing, Finance, Collective, Executive and Education workers, all using tenant-scoped service mandates. Create an objective and select **Open objective**; evidence and approved records persist locally.

The **Attributable public research** section loads eight offline-cached records containing published observations from Stats NZ, Christchurch City Council, ChristchurchNZ and the New Zealand Government directory. The catalogue is seeded into local SQLite at startup. Selecting **Import cached observation** copies a source-exact, dated record into your current objective with its publication URL and SHA-256 evidence provenance. The two organisation descriptions can also be registered through **Register sourced organisation**; they are attributed public observations, not verified leads or buying intent. These snapshots do not update automatically and do not include harvested contact details or purchase intent. User-supplied evidence must be validated separately.

The Marketing workspace saves opportunity hypotheses, immutable campaign-planning revisions with explicit assumptions and risks, and versioned Management assessments of sourced organisation profiles. The directory shows observation provenance, recorded manual outcomes, and scoped opportunity links; **it never sends or publishes messages**. Finance analyses only explicitly supplied revenue, cost, currency, period and optional tax figures, without changing any approved Higher Frequencies forecasts. Collective Intelligence assembles departmental assessment evidence and keeps conflicts and uncertainty visible. Decision Intelligence records human-supplied alternatives, ratings and Management review, with no automated approvals. Reporting retains immutable document snapshots and two separate Management gates.

### Integrated review and reconciliation controls

- **Marketing:** Management can review the latest immutable offline campaign-plan version and preserve review reasoning. Separately, it can generate immutable, source-derived service-fit recommendation snapshots, review their explicit evidence and reject stale assessments. Neither workflow sends marketing.
- **Finance:** The Finance scenario workspace distinguishes rejected/incomplete inputs from valid, reproducible arithmetic, and preserves audited human review and source hashes without changing accounting or approved forecasts.
- **Coordination:** Coordinator status now reconciles from actual departmental processing, mandate state and objective decisions on startup and during local worker ticks. Saved transitions distinguish queued, processing, completed, blocked, superseded and cancelled work. Reconciliation does not replay events.
- **Reporting:** Management can review the latest draft, request a new immutable revision and re-review before final approval. A needs-revision or rejected review blocks approval of that draft; Executive users cannot see unapproved versions.
- **Education:** Improvements may cite specific Research evidence, and Management decisions preserve rationale and review history. Approval is for controlled testing only; changes are not auto-applied.

All of these operations are supported by authenticated backend endpoints. The managed Chromium policy prevented real interactive browser acceptance here; therefore those interface journeys remain unverified in a browser. Run the suite with `node --test --test-concurrency=2 tests/*.test.mjs` to limit local test-runner resource contention.

**Release limitation:** This repository is an integrated development build. Browser acceptance could not be executed against the managed Chromium environment because an organisation URL policy blocks all navigation. Full beta acceptance and the remaining mandatory requirements are not passed; see `docs/requirements-register.json`.

## Historical documentation

Earlier milestone files are retained in `docs/` for provenance; their old authentication and portal status descriptions are superseded by this README, current source code, tests and the machine-readable requirements register.

### RC6 RSS live-activation continuation (14 November 2026)

See `docs/RC6-LIVE-FEED-CONTINUATION.md` for the exact new Beehive official RSS connector, source restrictions, local DNS evidence, live acceptance command, and limitations. `node scripts/rc6-rss-live-acceptance.mjs ./rc6-rss-acceptance` performs real unmocked retrieval and a full SQLite/knowledge/synthesis acceptance check on a network-enabled machine. **No live success was recorded on the development host.** All 116 original mandatory requirements are preserved in the prior RC6 traceability file.

## Integrated operational checkpoint (14 November 2026)

See [`docs/FINAL-INTEGRATED-ACCEPTANCE.md`](docs/FINAL-INTEGRATED-ACCEPTANCE.md) for the complete verification matrix, safe upgrade instructions and remaining acceptance gates. This increment provides opt-in local daily/weekly retrieval using the existing Beehive/data.govt.nz/Ticketmaster adapters, immutable source update history, run-to-source evidence linkage, protected retrieval scheduling controls and governed Research-to-Education-to-strategic notification handoffs. Approval for Education knowledge and Management decisions remains explicit. The final live retrieval acceptance gate is **not** claimed as passed in the development environment.


## Research and Management review workspaces (November 2026)

The existing one-login navigation includes a **Research Review Desk** for evidence inspection, explicit claim comparison, contradiction dispositions, gap review and governed Research snapshot approval. The **Management Decision Desk** shows objectives, tenant-scoped evidence, departmental assessments, versioned reports and audit history, and offers only state-authorised Management transitions. All actions use existing authenticated API routes and SQLite; no separate database, auto-approval or external outreach is introduced.

Run the real Chromium DOM/HTTP/SQLite acceptance test with `node browser/research-desk-mediated-acceptance.mjs`. It runs Chromium, renders the actual dashboard and delegates HTTP through a host binding because this managed environment blocks native localhost navigation; it cannot substitute for Windows browser/CSP acceptance. The test creates only temporary data, not owner data. See `docs/RESEARCH-WORKSPACE-CLOSURE.md` for remaining limits.

## Optional cloud feasibility and safe snapshots (not deployed)

For the 14 November 2026 assessment of **Oracle Always Free, Google Compute Engine, Render Free, GitHub, Google Drive, local Windows and hybrid access**, see `docs/HOSTING-FEASIBILITY-AND-OPTIONAL-DEPLOYMENT.md`. The application continues to bind to local loopback and use SQLite; these optional tools make **no** cloud changes. `node scripts/cloud-preflight.mjs` checks local suitability; `node scripts/safe-backup.mjs <separate-backup-directory>` creates and validates a SQLite online snapshot. A user-service template is provided in `deploy/`, but do not install or publicly expose it until access controls have been reviewed and explicitly approved.

The planned future dashboard simplification, hover assistance and keyboard/touch guidance are specified (not implemented) in `docs/FUTURE-FRONTEND-USABILITY-SPEC.md`.

## Closed-loop organisational learning (controlled validation)
See `docs/CLOSED-LOOP-INTELLIGENCE-VALIDATION.md`. Run `node scripts/two-cycle-acceptance.mjs` for a disposable two-cycle evidence → Education → outcome lesson → next intelligence assessment test. The new Super User Education/strategic workbench provides governed lesson review. No automatic approval, training, financial updates, external outreach, or production-code changes occur. Live-source and native Windows acceptance remain pending.
