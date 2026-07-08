# Data pipelines

Operational notes for the two auto-update scripts that keep `src/data/publications.json`
and `src/data/trials.json` current. See [DECISIONS.md](./DECISIONS.md) for the policy
decisions these scripts implement (D2 scope, D5 publications rule, D7 pipeline autonomy).

Both scripts are zero-dependency Node 22 ESM (`.mjs`), using the global `fetch`. No npm
install is required beyond the project's existing `devDependencies`.

## scripts/harvest-pubmed.mjs

Searches PubMed (NCBI E-utilities) for `"Campbelltown Hospital"[Affiliation]` and upserts
matches into `src/data/publications.json`.

```
node scripts/harvest-pubmed.mjs [--from YYYY-MM-DD] [--dry-run] [--fresh]
```

- `--from YYYY-MM-DD` — only search publications dated on/after this date. Default
  `2020-01-01` (D2: this is a pilot, not a full historical archive).
- `--dry-run` — fetch and print the summary; does not write the file.
- `--fresh` — ignore the existing file and merge from an empty list. Used for the initial
  seed run; do not use this routinely, since it still upserts (never deletes), but starting
  fresh means a since-removed/retracted PubMed record won't linger from an old run either —
  normal scheduled runs should omit this flag so previously-seen publications are preserved
  even if a transient PubMed issue drops them from one run's results.

**How it works:** ESearch (with `usehistory=y`, paging via `WebEnv`/`query_key` and
`retstart`, 500 IDs per page) collects every matching PMID, then EFetch pulls full records
in batches of ≤200 PMIDs via POST (avoids URL length limits). The XML is parsed with a
small hand-rolled regex-based tag extractor — no XML parser dependency.

**Derived fields:**
- `authors[].campbelltown` — true if any of that author's affiliation strings match
  `/campbelltown/i`.
- `campbelltownLed` — true if the first author, last author, or any author both flagged
  Campbelltown *and* whose affiliation text matches `/corresponding/i` (D5).
- `departments` — parsed from Campbelltown-affiliated authors' affiliation strings via
  `Department of X`, `Dept of X`, `Division of X`, `Unit of X`, and a fallback pattern for
  unit/ward/service-style names (e.g. "General Medical Ward"). If nothing parses, the array
  is empty — this is expected for a meaningful fraction of records (real affiliation strings
  are inconsistent; as of the initial seed run, roughly 40% of publications had no
  department-shaped text in their Campbelltown affiliation string).

## scripts/sync-trials.mjs

Queries the ClinicalTrials.gov v2 API for studies with a location near "Campbelltown" and
upserts matches into `src/data/trials.json`.

```
node scripts/sync-trials.mjs [--dry-run] [--fresh]
```

- `--dry-run` / `--fresh` — same semantics as above.

**How it works:** `query.locn=Campbelltown` with `pageSize=100`, paged via `pageToken`,
requesting only the fields the mapping needs. The API's location filter is coarse (it
returns anything geographically near Campbelltown), so results are post-filtered to studies
with a location facility matching `/campbelltown hospital/i` — this deliberately excludes
nearby but distinct businesses like "GenesisCare - Campbelltown" or "Campbelltown Medical &
Dental Centre". A secondary check also catches real data-entry quirks like the facility
string `"CampbelltownHospital"` (no space) without loosening the exclusion above — see the
`isCampbelltownHospitalFacility` comment in the script.

Trials keep **all** statuses (D5-equivalent "include everything" philosophy extended to
trials) and are sorted RECRUITING first, then by ClinicalTrials.gov's last-update date.

## Etiquette, rate limits, and auth

- **PubMed / NCBI E-utilities**: every request carries `tool=ctn-research-site` and an
  `email=` contact param, per [NCBI's usage
  policy](https://www.ncbi.nlm.nih.gov/books/NBK25497/). **The email is currently a
  placeholder (`REPLACE@example.com`) — replace it with a real, monitored address in
  `scripts/harvest-pubmed.mjs` before relying on the scheduled workflow.** Without an API
  key, requests are throttled to stay under NCBI's anonymous 3 req/s cap; set the
  `NCBI_API_KEY` environment variable (repo secret `NCBI_API_KEY` in
  `.github/workflows/harvest.yml`) to raise this to 10 req/s. 429/5xx responses are retried
  up to 3 times with exponential backoff.
- **ClinicalTrials.gov**: no published hard rate limit, but the script throttles to ~4
  req/s and retries 429/5xx the same way, to be a good citizen.

## Schedule and tiered autonomy (D7)

`.github/workflows/harvest.yml` runs both scripts every Saturday 09:00 AEST
(`cron: '0 23 * * 5'`, i.e. Friday 23:00 UTC) plus on-demand via `workflow_dispatch`.

Per D7, the pipeline has two autonomy tiers:

1. **Auto-publish (implemented today)** — bibliographic facts (title, authors, journal,
   DOI, dates) and trial statuses are objective, sourced data with no editorial judgement.
   The workflow commits changed data files straight to the branch as `ctn-research-bot`
   with the message `chore: weekly data harvest`. The `departments` field is a mechanical
   regex parse of affiliation text, not an AI summary, so it stays in this tier too.
2. **Human-gated (not yet built)** — any future step that has an LLM draft lay summaries of
   abstracts or infer department/theme tags beyond the mechanical parse above must ship as
   a PR labelled "auto-generated — needs review", not a direct commit, and either wait for
   human approval or auto-merge after a grace period (default 14 days, tune later) with the
   "auto-generated" flag left visible if unreviewed. See the commented-out TODO block at the
   bottom of `.github/workflows/harvest.yml` for the sketch of how that step should be wired
   in once it exists.

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
   same shape as `sync-trials.mjs`: fetch, post-filter to Campbelltown Hospital, map to the
   exact `trials.json` contract (reuse the `nctId`-shaped identity field as whatever ANZCTR's
   ACTRN identifier is, keeping the object shape otherwise identical), upsert by that ID
   (never delete), and wire it into `harvest:all` in `package.json` and
   `.github/workflows/harvest.yml`.
3. Until then, a small manually-curated list of known ANZCTR-only trials is the interim
   mitigation (see DECISIONS.md) — that curation is out of scope for this pipeline.

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
  intended, and that the ESearch term still resolves (NCBI occasionally changes indexing
  lag for very recent articles — a paper published this week may not be indexed yet).
- **A trial you know is at Campbelltown Hospital is missing** — check its
  `LocationFacility` string on ClinicalTrials.gov directly; if it's phrased unusually (not
  containing "Campbelltown Hospital" in any recognisable form), the post-filter regex in
  `isCampbelltownHospitalFacility` needs a new variant. If the trial isn't on
  ClinicalTrials.gov at all, see the ANZCTR section above.
- **A department looks wrong or garbled** — the `departments` parse is a best-effort regex
  over free-text affiliation strings NCBI doesn't structure; false negatives (empty array)
  are expected and safe. A false positive (wrong text captured) should be fixed by
  tightening the patterns in `deriveDepartments` in `scripts/harvest-pubmed.mjs` — this is a
  facts-tier field (D7), so fixes should ship as a normal code change, not a manual data
  edit that the next scheduled run would just overwrite anyway.
