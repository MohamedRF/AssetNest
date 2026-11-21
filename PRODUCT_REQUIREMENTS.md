# Product Requirements Document (PRD)

## 1. Vision and audience

AssetNest is a modern self-hostable web asset management platform for (a) households, (b) small offices/IT teams and (c) institutions with many locations. **Workspace mode is an experience preset**, not a separate schema. Every tenant/workspace is isolated. A user may be a member of multiple workspaces.

## 2. Jobs to be done

- Know what is owned, where it is, who is responsible and what it cost.
- Capture purchase invoices, photos, warranty evidence and service documents securely.
- Find an asset by tags, attributes, location, QR code and advanced filters.
- Track assignment, return, transfer, repair, damage, retirement and disposal.
- Never overlook inspection, service or warranty events.
- Audit physical presence without losing a permanent asset history.
- Allow configurable AI assistants to suggest data without becoming the source of truth.

## 3. Personas / roles

- Home owner / family member: minimal onboarding, rooms, appliances, recurring service.
- Office admin: asset labels, assignments, procurement evidence, audits.
- Custodian/employee: see assigned items, request return or issue reporting.
- Auditor: read assets and enter audit observations with limited permissions.
- Workspace admin: users, settings, secrets, security and integration permissions.
- Platform operator (hosted deployment only): service health and tenancy administration, **not** blanket visibility of tenant secrets or documents.

## 4. Functional scope by module

### Identity and workspaces

Registration/invitation, workspace creation and switching, membership, roles, deactivation, configurable home/office preset, settings and audit log.

### Asset registry

UUID, unique workspace asset tag, category, manufacturer/model, serial (optional), status, condition, purchase amount/currency/date, default location, custodian, photos, custom field templates, notes, tags, archive and soft deletion policy. Asset histories must preserve old values.

### Organization

Nested locations (building/floor/room/shelf), people and teams, vendors, categories, asset models, collections/kits as future enhancement.

### Custody and lifecycle

Assign, return, transfer, check out/in, repair, lost, retired, disposed. Conflict-safe state transitions and history. Optional approval workflow in advanced phase.

### Documents

Attach invoice, warranty, manuals, service evidence; private download and retention; size/type controls; no public bucket URLs.

### Maintenance and warranty

Plans by date or interval, service log, due reminders, service provider, cost, warranty interval, reminder preferences.

### Physical audits

Audit sessions per location/category; QR scan or manual verify; missing/extra/moved statuses; reconciliation review and immutable audit closing.

### Reports

Asset register, by location/status/custodian, purchase summaries, warranty due, maintenance overdue, moves, audit discrepancies; CSV first, PDF later.

### Integrations

Versioned API, outgoing webhooks with signatures/retries, API tokens/service accounts, optional MCP service with explicit authorization, import/export.

### AI

Optional assistant, invoice/photo-assisted extraction and natural language search with explicit review for write suggestions, per-task model routing and diagnostics.

## 5. Priority

- **P0:** workspaces, identity, asset CRUD, locations, categories, search, private files, QR codes, history, RBAC, CSV import/export, Docker deployment.
- **P1:** assignments/transfers, warranty/maintenance jobs, notifications, audits, advanced filters/reporting, webhook/event framework.
- **P2:** AI ecosystem including BYOK, OpenAI-compatible base URL, native connectors, local model backends, safe search and extraction, MCP, SDK, automation rules.
- **P3:** advanced enterprise workflows, customizable approvals, depreciation policies (informational only), scheduled exports, scale optimization, hosted deployment readiness.
- **Deferred:** native mobile; may be considered only after separately documented approval and validated need.

## 6. Non-functional requirements

- Multi-tenant isolation verified in API, jobs, exports, search and attachments.
- Accessible keyboard navigation and WCAG 2.2 AA target for main flows.
- Stable migrations, documented upgrade/restore, secure defaults.
- Pagination and indexed queries; avoid loading entire dataset.
- Offline model execution optional, cloud AI optional. Core works with AI disabled.
- Data portability via CSV/JSON plus attachment export with authorization.

## 7. Initial success criteria

- New workspace to first asset in under five straightforward UI steps (measure in usability test).
- Import 1,000 assets from validated CSV without silently losing rows; export discrepancy report.
- QR resolves to authorized view, never exposes personal data publicly by default.
- Cross-tenant test suite catches any unauthorized read/write.
- Alerts fire only once per expected notification event under retries.
- AI extraction never auto-commits a purchase record or asset without user review.

## 8. Out of scope / prohibitions

No native mobile app, purchases/payments, guaranteed valuations, automatic external account scraping, covert network discovery, subscription entitlement bypass or AI-triggered destructive write without clear authorization.
