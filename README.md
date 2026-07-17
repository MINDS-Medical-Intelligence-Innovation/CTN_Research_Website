# Campbelltown Hospital Research

A single, always-current home for research at Campbelltown Hospital, South Western Sydney:
publications, clinical trials, researcher profiles, research-by-department pages, and a
project noticeboard for students and JMOs looking for a supervisor and a project that fits
their term. Publications and trial listings are designed to update themselves from PubMed and
ClinicalTrials.gov rather than being hand-maintained; news, people and student projects are
edited directly by the research office.

This repo is the founding build for the project. For the full reasoning behind it, read:

- [`docs/BRAINSTORM.md`](docs/BRAINSTORM.md) — the original research and architecture proposal
  (why this site should exist, IA, pipeline design, candidate architectures).
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — the decisions actually locked in with the project
  owner (governance, scope, editing model, consent model, publication rules, access model,
  pipeline autonomy, custodianship).

**Governance, in one line:** this is an independent, clinician-led pilot (decision **D1**),
hosted outside NSW Health infrastructure to move fast and demonstrate value — it is **not** an
official SWSLHD website, and doesn't claim to be one anywhere on the site.

## Tech stack

- **[Astro](https://astro.build/)** (static site generator, v5) — every page is built to plain
  HTML/CSS/JS at build time; no server, no database.
- **Content collections** (`astro:content` + Zod schemas) for news, projects and people —
  defined in [`src/content.config.ts`](src/content.config.ts).
- **[Pagefind](https://pagefind.app/)** for client-side search, indexed as a `postbuild` step.
- **[Sveltia CMS](https://github.com/sveltia/sveltia-cms)** (Decap-compatible, Git-backed) as
  the browser editing surface at `/admin/` — see [`docs/EDITING.md`](docs/EDITING.md).
- Data pipelines (PubMed harvesting, trials sync — see `scripts/`) that write JSON consumed by
  the Publications and Clinical Trials pages. Full pipeline documentation lives in
  `docs/PIPELINES.md` (introduced alongside the pipeline scripts — see that file, if present,
  for the up-to-date technical detail; it is owned by a separate workstream from this one).

## Quickstart

Requires Node.js ≥ 22.

```bash
npm install
npm run dev       # local dev server with hot reload
npm run build     # production build to dist/ (also runs the Pagefind indexing postbuild step)
npm run preview   # serve the built dist/ locally
```

## Repo layout

| Path | What lives there |
|---|---|
| `src/pages/` | Route-level Astro pages (Home, Research, People, Publications, Clinical Trials, Students & JMOs, News, About, Search). |
| `src/content/{news,projects,people}/` | Editable Markdown content, validated against the schemas in `src/content.config.ts`. This is what the CMS at `/admin/` edits. |
| `src/content.config.ts` | The Zod schemas that define and validate every content collection. The CMS config (`public/admin/config.yml`) must match these exactly. |
| `src/data/*.json` | Generated data consumed by the site (publications, clinical trials) — written by the harvesting pipelines, not edited by hand. |
| `scripts/` | Data pipeline scripts (PubMed harvesting, ClinicalTrials.gov sync) that populate `src/data/*.json`, plus `scripts/lib.mjs`, the shared throttle/retry, file I/O, and Campbelltown-matching helpers both pipeline scripts import — see `docs/PIPELINES.md`. |
| `src/components/`, `src/layouts/`, `src/utils/` | Shared UI components, page layout, and formatting helpers. |
| `src/styles/` | Global CSS. |
| `public/admin/` | The Sveltia CMS editing interface (`index.html` + `config.yml`), served at `/admin/`. |
| `public/uploads/` | Media uploaded through the CMS (created on first upload). |
| `docs/` | Project documentation: `BRAINSTORM.md`, `DECISIONS.md`, `EDITING.md`, and `PIPELINES.md` once written. |
| `dist/` | Build output (git-ignored). |

## How content editing works

Two ways to edit content, both of which end up as Markdown files under `src/content/`:

1. **The CMS at `/admin/`** — a Git-backed, browser-based editor (Sveltia CMS) for people who
   don't want to touch Markdown or Git directly. It reads and writes the same content files in
   this repo via the GitHub API, opening/commit to `main` behind a GitHub login. See
   [`docs/EDITING.md`](docs/EDITING.md) for the non-technical walkthrough (login, adding a news
   post, adding/expiring a project, the consent rule for people profiles, and what *not* to
   edit).
2. **Directly in Git** — for anyone comfortable with Markdown front matter, edit or add files
   under `src/content/{news,projects,people}/` and open a PR (or push to `main`, depending on
   the branch protection in place). Content **must** match the Zod schemas in
   `src/content.config.ts` exactly — the build fails fast on a schema mismatch.

Every content file carries an `example: true` flag when it is seed/demo content for the pilot
build, so it's easy to tell placeholder content apart from anything genuinely entered by the
research office — see the seeded files under `src/content/` for the pattern.

## How the data pipelines work

Publications (`src/data/publications.json`) and clinical trials (`src/data/trials.json`) are
generated, not hand-edited — see the harvesting scripts under `scripts/` (e.g.
`scripts/harvest-pubmed.mjs`). The intended design (per `docs/BRAINSTORM.md` §5 and
`docs/DECISIONS.md` D7) is a scheduled GitHub Actions workflow that queries PubMed and
ClinicalTrials.gov for Campbelltown Hospital-affiliated content, normalises it, and opens a
reviewable pull request per harvest batch rather than silently mutating data. **Full technical
detail belongs in `docs/PIPELINES.md`** — consult that file for the current state of the
pipelines; it's maintained by a separate workstream from the one that produced this README, so
if it doesn't exist yet in your checkout, the pipeline scripts under `scripts/` are the
source of truth in the meantime.

## Deployment

The site builds to static output in `dist/` (`npm run build`, which also runs the Pagefind
`postbuild` indexing step) and is designed to be hosted anywhere that serves static files. The
intended path is a GitHub Actions workflow (`.github/workflows/deploy.yml`) that builds and
deploys `dist/` to GitHub Pages, with a **custom domain added later** once one is registered
(decision **D8** — small budget approved, domain name not yet chosen; see the shortlist note in
`docs/DECISIONS.md`). `astro.config.mjs` builds against an optional `SITE_URL` environment
variable (falling back to a placeholder when unset) for canonical URLs, and supports an optional
`BASE_PATH` environment variable for GitHub Pages-style project subpaths (e.g.
`BASE_PATH=/ctn-research-website/`); `deploy.yml` sets both. Both workflows also cache `npm`
dependencies (`actions/setup-node`'s `cache: 'npm'`) to speed up runs.

**Deploy trigger note:** `deploy.yml` fires on pushes to `main`, which must also be the
repository's **default branch** — `.github/workflows/harvest.yml`'s scheduled data-harvest
commits land on the default branch (GitHub Actions schedules only ever run there), and those
commits are what keep the published site's data fresh.

## Placeholder inventory

These are the known stand-ins that must be replaced before/as the project moves from pilot to
production. Each is deliberately obvious in the source (grep for `PLACEHOLDER` or `example.`)
so nothing ships silently:

| Placeholder | Lives in | Replace when |
|---|---|---|
| **EOI form URL** (`https://forms.office.com/PLACEHOLDER-EOI`) | `src/pages/students/index.astro` (`EOI_FORM_URL`) | Once the research office provisions the real MS Forms expression-of-interest form (see `docs/DECISIONS.md` D3). |
| **SharePoint "Staff area" URL** (`https://PLACEHOLDER.sharepoint.com/sites/ctn-research`) | `src/components/Footer.astro` (`STAFF_AREA_URL`) | Once the companion SharePoint site for staff-only content is provisioned (decision **D6**). |
| **CMS repo slug** (`PLACEHOLDER-ORG/CTN_Research_Website`) | `public/admin/config.yml` (`backend.repo`) | Once the dedicated GitHub organisation from decision **D8** exists and this repo has migrated into it. |
| **Site URL** (`https://example.pages.dev`) | `astro.config.mjs` (`SITE_URL` env var, set by `deploy.yml`) | Once real hosting (and later, the custom domain from D8) is chosen — currently set to `https://techycardiac.github.io` in `deploy.yml`, itself a pilot-phase stand-in until the dedicated GitHub org (D8) exists. |
| **Ethics / Research Directorate link** | `src/pages/about/index.astro` | Once confirmed with the SWSLHD Research Directorate. |
| **Research office contact point** | `src/pages/about/index.astro` | Once a public contact email or SharePoint contact form is confirmed. |
| **Supervisor/contact emails** on seeded example projects (`research.campbelltown@example.health.nsw.gov.au`) | `src/content/projects/*.md` | As each example project is replaced with a real listing carrying a real supervisor contact. |
| **NCBI contact email** (`REPLACE@example.com`, used as the fallback when unset) | `scripts/harvest-pubmed.mjs` (`NCBI_CONTACT_EMAIL` env var, repo/org **variable** — not a secret — in `.github/workflows/harvest.yml`) | Once a real, monitored contact address is designated for the scheduled harvest — required by [NCBI's usage policy](https://www.ncbi.nlm.nih.gov/books/NBK25497/). The script prints a startup warning while the placeholder is in use. |

All seed content in `src/content/{news,projects,people}/` is clearly fictional and marked
`example: true` (or, for the two intentionally-unpublished people profiles, described as
example content in the body) — see `docs/EDITING.md` for how to replace it.
