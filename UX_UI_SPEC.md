# Web UX/UI and Design Specification

## Product principles

Web-only responsive application; no mobile app development. Home is approachable, office is efficient; shared component system. Accessible keyboard interactions, obvious status, informative empty states, fast search, explicit destructive confirmations. Light/dark theme and system preference.

## Design system

React + Vite + TypeScript; Tailwind + shadcn/ui; icon library Lucide; font system stack; density setting (comfortable/compact). Use neutral background, clear accent, distinct semantic warning/danger/success. Maintain WCAG 2.2 AA contrast and focus rings; reduced-motion preference.

## Global layout

- Collapsible sidebar: Overview, Assets, Locations, People/Custody, Maintenance, Warranties, Audits, Reports, Integrations, Settings.
- Topbar: workspace switcher (mode label), global search, quick-add, reminders, user menu.
- Home mode: Overview, My Things, Rooms, Maintenance, Documents, Reports (hide irrelevant enterprise navigation initially).
- Office mode: Overview, Assets, Locations, Assignments, Maintenance, Audits, Reports, Team, Integrations.

## Pages

1. Onboarding: create/join workspace, select home/office, default currency, add first location and asset.
2. Dashboard: total assets, warranty due, maintenance overdue, asset status/category chart, recent activity, actionable alerts.
3. Asset list: full-text search, saved filters, sort, columns, bulk actions, import/export, pagination.
4. Add/Edit asset: progressive fields, category-driven custom fields, model and serial, purchase, location, photos, documents; inline validation.
5. Asset detail: summary, QR, history timeline, custodian, warranty, maintenance, documents, actions.
6. Locations: nested navigation, breadcrumb, assets in location, move controls.
7. Custody: assign/return/transfer dialogs with before/after confirmation, expected version warning.
8. Maintenance: list/calendar, due/overdue, service record, recurrence editor.
9. Audits: create scope, scanning or manual verify in browser, discrepancy resolution, close and export.
10. Reports: common templates, date filters, CSV export and progress indicator.
11. Team & roles: invites, membership, roles/scope explanation.
12. Settings: workspace, assets/categories, notifications, storage, integrations, security, AI providers and routes.
13. AI assistant: opt-in drawer, provider status, permitted read-only queries, proposed change review screen.

## QR flow

QR encodes an opaque URL/identifier, not serial, employee or invoice detail. If user not authenticated, require login and then re-check workspace authorization. Offer web camera scanning where supported plus manual code entry fallback. Do not publish private asset detail from a public QR.

## AI configuration UX

Add connection (provider type, endpoint when applicable, credentials, test), model discovery/manual ID, capabilities, per-task routing, data processing consent and budgets. Distinguish API access from consumer subscriptions. Show provider failure and fallback transparently. AI proposes asset changes as an editable diff, never silently saves.

## Component checklist

DataTable, AssetStatusBadge, ConditionPicker, LocationTree, FileUploader, DocumentViewer, QRCodeDisplay/Scanner, Timeline, DateRangeFilter, AlertInbox, WorkspaceSwitcher, RoleGuard (display only, real auth server-side), AIConnectionForm, CapabilityMatrix, AIApprovalDiff, AsyncJobProgress, ConfirmDialog, EmptyState, ErrorBoundary.

## Screen acceptance

- Keyboard-only create/search/assign workflow.
- 320px browser width usable with responsive tables/cards (no native app requirement).
- Empty/no-data/error/loading states.
- Global search returns only accessible workspace data.
- Form errors explain how to correct them; destructive actions have clear consequences.
