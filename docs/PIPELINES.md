# Data pipelines

Operational notes for the two auto-update scripts that keep `src/data/publications.json`
and `src/data/trials.json` current. See [DECISIONS.md](./DECISIONS.md) for the policy
decisions these scripts implement (D2 scope, D5 publications rule, D7 pipeline autonomy).

Both scripts are zero-dependency Node 22 ESM (`.mjs`), using the global `fetch`. No npm
install is required beyond the project's existing `devDependencies`. Shared logic (throttle
+ retry, existing-file loading, upsert-merge, write-if-changed, the Campbelltown Hospital
matcher, CLI parsing) lives in **`scripts/lib.mjs`** — see "Shared library" below.

## scripts/harvest-pubmed.mjs

Searches PubMed (NCBI E-utilities) for `"Campbelltown Hospital"[Affiliation]` and upserts
matches into `src/data/publications.json`.

```
node scripts/harvest-pubmed.mjs [--from YYYY-MM-DD] [--dry-run] [--fresh]
```

- `--from YYYY-MM-DD` — only search publications dated on/after this date.
- `--dry-run` — fetch and print the summary; does not write the file.
- `--fresh` — ignore the existing file and merge from an empty list. Used for the initial
  seed run; do not use this routinely, since it still upserts (never deletes), but starting
  fresh means a since-removed/retracted PubMed record won't linger from an old run either —
  normal scheduled runs should omit this flag so previously-seen publications are preserved
  even if a transient PubMed issue drops them from one run's results.

**Incremental default window (no `--from` given, not `--fresh`):** the script derives
`--from` from the data already on disk — the latest `(year, month)` among stored
publications, minus a 90-day safety overlap (an unknown month is treated as January, the
conservative choice that widens rather than narrows the window). It prints the derived
window on every run, e.g.:

```
No --from given — deriving incremental window from existing data (latest stored publication
date ~2026-07, minus 90-day overlap): --from 2026-04-02.
```

Falls back to the historical default `2020-01-01` (see docs/DECISIONS.md D2 — this is a
pilot, not a full historical archive) when there's no existing data to derive from (a first
run, or `--fresh` with no explicit `--from`). This is what stops the weekly cron job
re-fetching the entire ~6.5-year window every Saturday — a normal week's run only queries
the last ~90+ days' worth of PMIDs. Pass an explicit `--from` to override the derived value
(e.g. for a manual backfill).

**How it works:** ESearch (with `usehistory=y`, paging via `WebEnv`/`query_key` and
`retstart`, 500 IDs per page) collects every matching PMID, then EFetch pulls full records
in batches of ≤200 PMIDs via POST (avoids URL length limits). The XML is parsed with a
small hand-rolled regex-based tag extractor — no XML parser dependency.

**EFetch batch shortfalls:** after parsing each batch, the script compares the number of
`<PubmedArticle>` records actually returned against the number of PMIDs requested. On a
mismatch it retries that one batch once; if it's still short afterwards, it prints a
prominent `WARNING` with the shortfall and lists it in the final summary — the run does
**not** fail, since a partial harvest is still useful and the missing records will normally
be picked up on the next scheduled run (they stay inside the incremental window until then,
since the derived `--from` has a 90-day overlap).

**Derived fields:**
- `authors[].campbelltown` — true if any of that author's affiliation strings match the
  canonical Campbelltown Hospital matcher (`isCampbelltownHospital` in `scripts/lib.mjs` —
  see "Shared library" below), not a bare `/campbelltown/i` regex.
- `campbelltownLed` — true if the first author, last author, or any author both flagged
  Campbelltown *and* whose affiliation text matches `/corresponding/i` (D5).
- `departments` — parsed from Campbelltown-affiliated authors' affiliation strings via
  `Department of X`, `Dept of X`, `Division of X`, `Unit of X`, and a fallback pattern for
  unit/ward/service-style names (e.g. "General Medical Ward"). Three refinements keep this
  clean:
  1. **Segment anchoring** — a raw `<Affiliation>` string is split on `;` before matching, and
     only segments that themselves mention Campbelltown Hospital (via the canonical matcher)
     are searched for a department phrase. This stops a department phrase attached to a
     *different* institution in a multi-institution affiliation string (e.g. "Department of
     Cardiology, Liverpool Hospital; Department of Medicine, Campbelltown Hospital") from
     bleeding into the Campbelltown department list.
  2. **Real title-casing** (`normaliseDeptName`) — casing is normalised per contiguous
     letter-run (not per whitespace-split word), so `"EMERGENCY MEDICINE"` becomes
     `"Emergency Medicine"` (the old version only capitalised the first letter and left the
     rest of an all-caps word untouched), small words (`of`/`and`/`the`/`for`/`in`) are
     lowercased except as the first word, a short acronym allowlist (`ICU`, `ED`, `GP`,
     `ENT`) stays fully uppercase, and any casing variant of "MacArthur"/"macarthur" collapses
     to the single correct "Macarthur" spelling as a side effect of title-casing one unbroken
     letter-run.
  3. **`ALIAS_MAP`** (`scripts/lib.mjs`) — applied after normalisation, this collapses
     remaining wording-only duplicates (e.g. `"Diabetes and Endocrinology"` →
     `"Diabetes & Endocrinology"`) and drops known false positives (e.g. a department phrase
     that actually names a different hospital, or a job title the fallback pattern mistook
     for a department). **To extend it:** run a fresh harvest, inspect the printed
     `departments` list (or grep `src/data/publications.json`) for a duplicate/garbled entry,
     then add a `'Normalised Input Name': 'Preferred Output Name'` entry to `ALIAS_MAP` —
     keyed on the *exact* output of `normaliseDeptName` (case-sensitive: small words
     lowercase except first, acronyms uppercase), not the raw source text. Set the value to
     `null` to drop an entry entirely instead of renaming it. See the comment block above
     `ALIAS_MAP` in `scripts/lib.mjs` for the full contract.

  If nothing parses, the `departments` array is empty — this is expected for a meaningful
  fraction of records (real affiliation strings are inconsistent). As of the post-refactor
  reseed, roughly 40% of publications had no department-shaped text in their Campbelltown
  affiliation string; these are surfaced, not hidden, on the site — see "Unclassified
  publications" below.

**Contact email:** every request must carry a real, monitored contact address per NCBI's
usage policy. Set the `NCBI_CONTACT_EMAIL` environment variable (repo/org **variable**
`NCBI_CONTACT_EMAIL` in `.github/workflows/harvest.yml`, i.e. `vars.NCBI_CONTACT_EMAIL`, not
a secret — it isn't sensitive). Without it, the script falls back to the placeholder
`REPLACE@example.com` and prints a loud `WARNING` block at startup so this can't ship
silently.

## scripts/sync-trials.mjs

Queries the ClinicalTrials.gov v2 API for studies with a location near "Campbelltown" and
upserts matches into `src/data/trials.json`.

```
node scripts/sync-trials.mjs [--dry-run] [--fresh]
```

- `--dry-run` / `--fresh` — same semantics as above.

**How it works:** `query.locn=Campbelltown` with `pageSize=100`, paged via `pageToken`,
requesting only the fields the mapping needs. The API's location filter is coarse (it
returns anything geographically near Campbelltown), so results are post-filtered using the
same canonical `isCampbelltownHospital` matcher as harvest-pubmed.mjs (see "Shared library"
below) — this deliberately excludes nearby but distinct businesses like "GenesisCare -
Campbelltown" or "Campbelltown Medical & Dental Centre", while still catching data-entry
quirks like the concatenated facility string `"CampbelltownHospital"` (no space).

Trials keep **all** statuses (D5-equivalent "include everything" philosophy extended to
trials) and are sorted RECRUITING first, then by the persisted `lastUpdate` field (most
recent first) — `lastUpdate` is a real, stored field on every trial record (set from
ClinicalTrials.gov's `LastUpdatePostDate` on every fetch that returns that trial), not a
transient value reconstructed via a side lookup. This matters for trials that are retained
from a previous run but happen to be absent from the *current* fetch (e.g. a transient API
hiccup) — their last known `lastUpdate` stays intact and they keep sorting correctly, instead
of silently losing recency because nothing in the current run mentioned them.

## Shared library: scripts/lib.mjs

Extracted so the two scripts can't drift out of sync on behaviour that must be identical:

- **`createThrottledFetch({ minIntervalMs, maxRetries })`** — returns a `fetchWithRetry`
  function with its own independent rate-limit clock. Retries network errors and 429/5xx
  responses with exponential backoff, honouring a numeric `Retry-After` header when present.
  Each script builds its own instance with its own `minIntervalMs` (harvest-pubmed: 350ms
  anonymous / 120ms with an API key; sync-trials: 250ms).
- **`sleep`** — re-exported from `node:timers/promises`' `setTimeout`; no hand-rolled
  Promise wrapper anymore.
- **`truncate(str, maxLen)`** — word-boundary-aware truncation with an ellipsis.
- **`isCampbelltownHospital(text)`** — the **one** canonical "is this actually Campbelltown
  Hospital" matcher, used by both scripts (harvest-pubmed's author-affiliation flag,
  `campbelltownLed`, and department-segment anchoring; sync-trials' facility post-filter).
  Lowercases the text and strips everything that isn't a letter, then checks for the
  substring `campbelltownhospital` (covers "Campbelltown Hospital", "CampbelltownHospital",
  hyphenated/punctuated variants, and Camden-combined forms where Campbelltown is named
  last, e.g. "Camden and Campbelltown Hospitals") or a Camden-combined form where Campbelltown
  is named *first* (e.g. "Campbelltown and Camden Hospital", "Campbelltown & Camden
  Hospitals"). Deliberately does **not** match "Campbelltown Private Hospital", "Campbelltown
  Medical & Dental Centre", or "GenesisCare - Campbelltown" — see the function's doc comment
  in `scripts/lib.mjs` for the full reasoning.
- **`loadExistingItems(fileUrl, { fresh })`** — **fails loud** on a corrupt/unreadable
  existing file. Only a genuinely missing file (`ENOENT`) is treated as "no existing data
  yet"; any other read or JSON-parse error prints a clear error and calls `process.exit(1)`
  rather than silently starting from an empty list. Silently treating a corrupt file as
  "empty" would upsert the fresh fetch on top of nothing and the next write would look like
  every previously-harvested record (and any hand-curated fields on them) had simply
  vanished — far worse than a failed CI run that a human then has to look at. `--fresh`
  still explicitly opts into starting empty regardless of what's on disk.
- **`upsertByKey(existingItems, fetchedItems, keyFn, mergeFn)`** — the merge core. Returns
  `{ items, added, updated }`. **Field-preserving contract:** the default merge function
  (`defaultMerge`) produces `{ ...existing, ...fetched }`, so any field the harvester itself
  doesn't produce — most importantly, future D7 human-curated fields like `laySummary` or
  `curationStatus` once that tier is built — **survives every re-harvest untouched**. A
  harvest can only ever add new bibliographic/status facts or refresh existing ones; it can
  never silently wipe a curated field a human added out-of-band. `updated` only increments
  when the *merged* record actually differs (by `JSON.stringify` comparison) from what was
  already stored, so an identical re-fetch counts as neither added nor updated.
- **`writeDataFile(fileUrl, source, items, previousGenerated)`** — write-if-changed. Reads
  whatever is currently on disk and compares it against the new `items`; if they serialise
  identically, the file is **not** rewritten (the previous `generated` timestamp is kept,
  and the script prints `"No changes — file untouched."`) instead of rewriting the file with
  just a bumped `generated` stamp. This is what makes `harvest.yml`'s
  `git diff --cached --quiet` no-op guard actually work on a week with zero real changes —
  no write means no diff means no commit, instead of a commit that only ever changes one
  timestamp line.
- **`HOSPITAL_NAME`**, **`PUBMED_AFFILIATION_TERM`** — shared config constants. When D2's
  scope eventually expands beyond Campbelltown Hospital alone, these (plus
  `isCampbelltownHospital`) are the one place to edit for both scripts to pick it up.
- Both scripts parse their CLI flags with Node's built-in `util.parseArgs` (supporting both
  `--from=2024-01-01` and `--from 2024-01-01` forms) instead of a hand-rolled loop.

## Etiquette, rate limits, and auth

- **PubMed / NCBI E-utilities**: every request carries `tool=ctn-research-site` and an
  `email=` contact param, per [NCBI's usage
  policy](https://www.ncbi.nlm.nih.gov/books/NBK25497/) — see "Contact email" above for how
  that's configured and what happens if it's left as the placeholder. Without an API key,
  requests are throttled to stay under NCBI's anonymous 3 req/s cap; set the `NCBI_API_KEY`
  environment variable (repo secret `NCBI_API_KEY` in `.github/workflows/harvest.yml`) to
  raise this to 10 req/s. 429/5xx responses are retried up to 3 times with exponential
  backoff (via `scripts/lib.mjs`'s `createThrottledFetch`).
- **ClinicalTrials.gov**: no published hard rate limit, but the script throttles to ~4
  req/s and retries 429/5xx the same way, to be a good citizen.

## Schedule and tiered autonomy (D7)

`.github/workflows/harvest.yml` runs both scripts every Saturday 09:00 AEST
(`cron: '0 23 * * 5'`, i.e. Friday 23:00 UTC) plus on-demand via `workflow_dispatch` (which
also accepts an optional `from` input, passed through as `--from` to harvest-pubmed.mjs for
a manual backfill without editing the workflow file).

Per D7, the pipeline has two autonomy tiers:

1. **Auto-publish (implemented today)** — bibliographic facts (title, authors, journal,
   DOI, dates) and trial statuses are objective, sourced data with no editorial judgement.
   The workflow commits changed data files straight to the branch as `ctn-research-bot`
   with the message `chore: weekly data harvest`, then `git pull --rebase` + retries the
   push up to 3 times (10s apart) to survive a concurrent push landing on the same branch
   mid-run. The `departments` field is a mechanical regex parse of affiliation text (plus
   the alias map above, itself mechanical/deterministic, not an AI summary), so it stays in
   this tier too.
2. **Human-gated (not yet built)** — any future step that has an LLM draft lay summaries of
   abstracts or infer department/theme tags beyond the mechanical parse above must ship as
   a PR labelled "auto-generated — needs review", not a direct commit, and either wait for
   human approval or auto-merge after a grace period (default 14 days, tune later) with the
   "auto-generated" flag left visible if unreviewed. See the commented-out TODO block at the
   bottom of `.github/workflows/harvest.yml` for the sketch of how that step should be wired
   in once it exists. **The field-preserving merge contract above (`upsertByKey`/
   `defaultMerge`) is what makes this tier safe to build later**: whatever field a future
   human-gated step writes onto a publication record (e.g. `laySummary`), every subsequent
   auto-publish-tier harvest run will preserve it untouched, because the merge only ever
   overlays newly-fetched bibliographic fields on top of the existing record.

## Adding an ANZCTR connector later

Australian trials that are *only* registered on ANZCTR (not dual-registered on
ClinicalTrials.gov) are currently invisible to `sync-trials.mjs`. Per
[DECISIONS.md deferred item 1](./DECISIONS.md#deferred--follow-up-items): scraping ANZCTR
was investigated and refuted/blocked, so the near-term coverage strategy is
ClinicalTrials.gov's dual-registration (most industry-sponsored and many
investigator-initiated Australian trials register on both registries). When ready to close
this gap:

1. Pursue a formal ANZCTR data request/export (contact ANZCTR directly — do not resume
   scraping attempts).
2. If/when a usable data source is confirmed, add `scripts/sync-anzctr.mjs` following the
   same shape as `sync-trials.mjs` (and importing the same `scripts/lib.mjs` helpers): fetch,
   post-filter to Campbelltown Hospital (reuse `isCampbelltownHospital`), map to the exact
   `trials.json` contract (reuse the `nctId`-shaped identity field as whatever ANZCTR's
   ACTRN identifier is, keeping the object shape otherwise identical), upsert by that ID
   (never delete, via `upsertByKey`), and wire it into `harvest:all` in `package.json` and
   `.github/workflows/harvest.yml`.
3. Until then, a small manually-curated list of known ANZCTR-only trials is the interim
   mitigation (see DECISIONS.md) — that curation is out of scope for this pipeline.

## Unclassified publications

As of the post-refactor reseed, 207 of 513 publications (roughly 40%) have an empty
`departments` array — the affiliation text just doesn't contain a recognisable department
phrase. Rather than making these invisible in department-oriented views:

- `/research/` shows an explicit "Unclassified" card (muted styling, with a count and the
  line "Department could not be parsed from the author affiliation") alongside the real
  department cards, linking to `/publications/?dept=__unclassified`.
- `/publications/` adds an "Unclassified (N)" option to the department filter dropdown that
  matches publications with an empty `departments` array. The `__unclassified` value is
  synthetic (never a real department name) and is handled in three places that all need to
  stay in sync if this is ever touched: the dropdown option in
  `src/pages/publications/index.astro`, the client-side filter script's `matchesDept` check
  in the same file, and (for free) the existing generic `?dept=` preselect logic, which
  already works once the option exists in the `<select>`.

## Deliberate deferrals

A few things below are known limitations, not oversights — noted here so they aren't
"discovered" again later:

- **Publications page pagination.** `/publications/` renders all 513 publication cards on a
  single static HTML page (~920KB at time of writing). This is a deliberate v1 simplification
  — Astro's client-side filter bar makes it usable at this volume, and static hosting means
  there's no server-side cost to the larger page. Revisit (client-side pagination, or a
  build-time paginated route) once volume genuinely demands it — there's no fixed threshold
  set for "when," just "when it starts to matter in practice" (slow loads on the clinical
  desktops D6 flags as a reachability concern, for instance).
- **Abstracts are stored but not rendered.** `harvest-pubmed.mjs` parses and stores a
  truncated (1200 char) abstract on every publication record, but no page currently displays
  it. This is by design, not an oversight: the abstract is feedstock for the future D7
  human-gated tier (an LLM-drafted lay summary derived from it) and for a future search
  improvement (indexing on abstract text, not just title/author/journal). Keeping it in the
  data file now means that future work doesn't need a second harvest/backfill pass to get
  the raw material.

## Troubleshooting

- **`Request failed after 3 attempts: 429 ...`** — rate limit exceeded despite throttling
  (e.g. another process sharing the same IP/API key). Wait a few minutes and re-run; for
  PubMed, set `NCBI_API_KEY` to raise the ceiling.
- **`Request failed: 403 ...` or similar from a CI runner** — some cloud IP ranges
  (including shared GitHub Actions runners) are occasionally rate-limited or soft-blocked by
  upstream APIs during traffic spikes unrelated to this project. Re-run via
  `workflow_dispatch`; if it persists, check NCBI's/ClinicalTrials.gov's status pages before
  assuming the script is broken.
- **Publication count looks too low** — check the `--from` date isn't set later than
  intended (remember it now defaults to an incremental window, not a fixed constant — the
  script always prints the effective window it used), and that the ESearch term still
  resolves (NCBI occasionally changes indexing lag for very recent articles — a paper
  published this week may not be indexed yet).
- **A trial you know is at Campbelltown Hospital is missing** — check its
  `LocationFacility` string on ClinicalTrials.gov directly; if it's phrased unusually (not
  containing "Campbelltown Hospital" in any recognisable form), `isCampbelltownHospital` in
  `scripts/lib.mjs` needs a new variant. If the trial isn't on ClinicalTrials.gov at all, see
  the ANZCTR section above.
- **A department looks wrong, garbled, or duplicated** — the `departments` parse is a
  best-effort regex over free-text affiliation strings NCBI doesn't structure; false
  negatives (empty array, surfaced as "Unclassified" — see above) are expected and safe. A
  genuine duplicate (two spellings of the same department) should usually be fixed by adding
  an `ALIAS_MAP` entry in `scripts/lib.mjs` (see "Shared library" above for the exact
  contract); a structurally wrong capture (wrong text captured, or text belonging to another
  institution) should be fixed by tightening `DEPT_PATTERNS`/segment-anchoring in
  `deriveDepartments` in `scripts/harvest-pubmed.mjs`. Either way this is a facts-tier field
  (D7), so fixes should ship as a normal code change, not a manual data edit that the next
  scheduled run would just overwrite anyway (though note: the field-preserving merge means a
  manual data edit to a field the harvester *doesn't* produce, like a future `laySummary`,
  would in fact survive — it's specifically the harvester-produced fields like `departments`
  that get overwritten by design on every run).
- **`Failed to read/parse ... as JSON`** — the existing data file is corrupt or unreadable.
  The script deliberately refuses to proceed (exits 1) rather than silently starting from an
  empty list — fix the file (or restore it from git history) and re-run, or pass `--fresh` if
  starting over is actually intended.
