# Admin Panel — Design Reference

These files are a **visual spec only**, produced in Claude Design. They are NOT
the admin panel implementation and should never be wired into the running app.

## What this is

A hi-fi React/JSX prototype of the TRA admin panel, covering three screens:

- **Dashboard** (`Dashboard.jsx`) — overview: tamper-stamped %, documents by
  vertical, scrape health, pending-vs-approved per municipality, recent runs.
- **Review Queue** (`ReviewQueue.jsx`) — the primary screen: filterable table,
  bulk-select, tamper-evidence column, inline + confirm-drawer bulk-approve flow.
- **Document Detail** (`DocumentDetail.jsx`) — approve/reject, 4-field
  provenance, SHA-256 digest, RFC-3161 timestamp state, append-only version
  history with content-changed flags.

Supporting files: `app.jsx` (root/routing/tweaks), `components.jsx` (shared
primitives — badges, icons, sidebar, topbar), `data.jsx` (mock dataset),
`index.html` + `tweaks-panel.jsx` (Claude Design harness — ignore for build).

## Target stack (what the real panel will actually be)

**Astro + HTMX + Tailwind**, in `packages/admin`, behind admin session auth.
The JSX here is a picture of the intended result, not source to port. Read it
for layout, hierarchy, states, and copy — then build the real thing natively.

## Hard dependency

The real panel sits behind a login and calls the admin API routes, so it
**comes after auth Phase 3/4** (`requireAdminSession` working). Do not start
the panel build before auth is cut over.

## Design decisions baked into this prototype

- English UI chrome, Albanian data.
- Navy accent, light mode default; sans UI + mono for hashes/IDs.
- Bulk-approve = inline-select **plus** a confirm step that previews scope
  (mirrors the real `dryRun` preview-then-confirm pattern).
- Tamper-evidence is first-class: every row shows stamped/unstamped; unstamped
  documents carry a visible "Not stamped" warning and are flagged on approval.
- Provenance shown as 4 explicit fields (source ID, origin, page URL, source URL).
- Version history is append-only with per-version hash + "content changed" tag.

## Naming

"Radari Vendor" is the intended public-facing product name and is correct as
shown — keep it. "Transparency Radar Albania" is the project/grant name.

## Corrections to apply when building the real panel

One thing in the prototype is stale and must NOT be copied as-is:

1. **Source architecture in the mock data is out of date.** `data.jsx` lists
   proxy procurement sources ("Open Procurement Albania (proxy)", "Open Data
   Albania (proxy)"). Those reflect the OLD architecture. As of the June 2026
   migration:
   - **Procurement is now all official** (app.gov.al / APP), tamper-stamped.
   - The **only** labeled unofficial proxy is **Vlorë Vendime via vendime.al**
     (`is_unofficial_proxy=true`).

   The official-vs-proxy UI distinction and the "Not stamped" warning are still
   correct and needed — but they should reflect the real split (one Vendime
   proxy, everything else official), not the prototype's mock proxies.

## Provenance

Created in Claude Design during the 2026-06-04 session. Visual spec captured;
screenshots of the rendered screens are the companion artifact (store alongside).
