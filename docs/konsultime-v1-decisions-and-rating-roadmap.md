# Konsultime v1 — Decisions, Verifications, and Rating Roadmap

Status: **Metadata layer (Layer 1) complete and verified.** Layers 2–4 not started.
Last verified: June 2026.

This document records the deliberate decisions and verification results behind the
konsultime metadata work, and sketches the future document/rating layers so the
design is captured before that work begins. It is documentation only — no code or
schema changes are implied by this file.

---

## 1. Scope as built (Layer 1 — metadata only)

Five official municipal sources, metadata only ("what consultation exists"). No
document download, hashing, RFC 3161 stamping, classification, or rating.

Final local coverage (verified by direct SQL):

| Municipality | Rows | Oldest | Newest | Kinds |
|---|---|---|---|---|
| durres | 6 | 2026-03-20 | 2026-06-08 | consultation_notice, hearing |
| pogradec | 8 | 2023-12-17 | 2026-06-16 | consultation_notice, hearing |
| shkoder | 33 | 2023-09-20 | 2026-05-29 | consultation_notice, hearing |
| tirana | 1 | 2026-05-20 | 2026-05-20 | draft_act |
| vlore | 4 | 2023-09-05 | 2024-01-25 | draft_act |

Total: 52 official metadata rows.

---

## 2. Verifications performed (verify-at-the-source)

All checked with direct SQL against the live DB, not agent-reported counts.

- **No duplicate dedup keys anywhere in konsultime.** A `GROUP BY dedup_key HAVING
  count(*) > 1` query returns zero rows. Confirmed across all five municipalities,
  not just one.
- **rows = distinct_keys for every municipality** (durres 6/6, pogradec 8/8,
  shkoder 33/33, tirana 1/1, vlore 4/4) — each consultation is uniquely keyed.
- **Idempotency:** every scraper re-run reports `totalNew: 0` on the second pass
  (`onConflictDoNothing` on the dedup key).
- **Flags correct:** `is_unofficial_proxy = false` everywhere (konsultime is
  official for all five — the vendime.al proxy is a Vendime-only exception);
  `review_status = pending` everywhere (nothing auto-approved); one official
  `source_origin` per municipality.
- **Year floor ≥ 2023** holds (oldest row is vlore 2023-09-05).

Dedup key shape (consistent across all five):
`konsultime:{municipality_slug}:{toSlug(title)}:{published_date_iso}`

---

## 3. Deliberate decisions (do not "fix" these without re-deciding)

### 3.1 Tiranë — append-per-version, keyed on filename timestamp
Tiranë does not publish per-consultation pages; it publishes a single downloadable
**register `.doc`** of draft project-acts. Metadata v1 tracks that register as one
row, keyed on the date parsed from the file's name timestamp (e.g.
`20260520142956_...` → `2026-05-20`).

**Consequence — intentional:** when Tiranë republishes the register with new
content, the filename timestamp changes → new `published_date` → new dedup key →
**a new row is appended.** This is not a duplicate (the keys differ); it is the
change-detection signal. Over time Tiranë accumulates one row per register version.

**Why append (not update-in-place):** it aligns with the platform's tamper-evidence
mission — a register that changed should leave a dated trail you can prove. The
"multiple Tiranë rows" appearance is a display-layer concern (show latest,
expandable to history), solvable later without changing the scraper.

**Open note for Layer 2/display:** two Tiranë rows for different register versions
share title + kind + source_page_url and differ only by date/source_url. Whoever
builds Tiranë display/enrichment should group these as "the same register over
time," not as distinct consultations.

### 3.2 Vlorë — source-level `draft_act` for all rows
Vlorë's source is the official "Regjistri i projekt-akteve për konsultim publik"
(a project-act register). Every parsed row is stored as `kind = draft_act`, even
when an individual title reads like a notice/hearing ("njoftim per degjese
publike"). This is a **source-level** labeling decision: the register *is* a
draft-acts register, so labeling its contents `draft_act` is honest about what the
source represents, and avoids presenting register entries as ordinary open
consultations.

This is a conscious divergence from the per-item classification used for
Pogradec/Shkodër/Durrës (where `degjes` → `hearing`). Recorded here so it isn't
"corrected" by mistake. Revisit only if the rating/display layer needs per-item
kind for Vlorë.

### 3.3 Durrës — WordPress detail-posts only
Durrës's listing mixes WordPress detail-post links and direct document-only links.
Metadata v1 collects only the detail posts (which carry item-level title + date via
JSON-LD `datePublished`). Direct document-only links are skipped to avoid inventing
item metadata. Title/date priority: JSON-LD `datePublished` → visible Albanian post
date → permalink path date (last resort). Stores the final effective URL after
redirects.

### 3.4 KonsultimiVendor — not used
`konsultimivendor.al` is a supplemental/unofficial proxy. Among the five v1
municipalities only Shkodër appears there, and the official source already covers
Shkodër. Not implemented; if ever added, gets `is_unofficial_proxy = true` and never
overrides an official source on dedup.

---

## 4. Rating roadmap (Layer 4 — NOT built; future spec)

The "1/5 completeness" idea cannot be built yet: it scores *which document types a
consultation contains*, and that requires Layers 2–3 (enrichment + classification),
which do not exist. The current data is metadata only — there is nothing for a
rating to read. Build order is strict:

```
Layer 1 metadata (done) → Layer 2 enrichment → Layer 3 classification → Layer 4 rating
```

### 4.1 Layer 2 — document enrichment (prerequisite)
For each consultation, open its detail page, find attached PDF/DOC/DOCX/XLSX,
download/record them, hash (SHA-256), and RFC 3161 timestamp via FreeTSA. Only
Pogradec has enrichment scaffolding today (committed, not yet run). Tiranë's case is
special: enrichment there means handling the register `.doc` itself.

### 4.2 Layer 3 — classification (prerequisite)
Label each enriched document by type. The shared `classifyDocType` classifier
already exists for this. Target types (illustrative): RIA, projektakt/projektvendim,
relacion/report, annex, notice, consultation report.

### 4.3 Layer 4 — rating rubric (DRAFT — not locked)
A descriptive completeness indicator, not a graded judgment, derived from document
*presence*. Illustrative sketch (rubric not finalized):

- **1/5** — only a RIA (or only a notice), key documents missing.
- **2/5** — RIA + projektakt/projektvendim.
- **3/5** — + relacion/report.
- **4/5** — + annexes.
- **5/5** — + consultation report (full package).

Design constraints (carried from architecture rules):
- Rating logic lives in its own layer — never inside the metadata scraper.
- Rating reads classified-document data; it does not re-scrape or re-classify.
- The rubric is a *descriptive* presence indicator (what's published), not a quality
  score of the documents' contents.
- Decide, when building, whether per-document labels live in a proper schema column
  (promoted from the interim audit-log bridge used in Pogradec enrichment).

---

## 5. What NOT to do next

- Do not build rating before Layers 2–3 exist.
- Do not mix enrichment/classification/rating into the metadata scrapers.
- Do not start Layer 2 inside existing metadata files — it's separate, plan-first work.
- Do not "correct" the Tiranë append-per-version or Vlorë source-level `draft_act`
  decisions without re-deciding them deliberately (§3.1, §3.2).
- Do not implement KonsultimiVendor before/over official sources.
