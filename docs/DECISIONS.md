# Decision Log

Decisions locked with the project owner on **7 July 2026**, resolving the open questions in [BRAINSTORM.md](./BRAINSTORM.md) §8. Each entry states the decision and what it implies for the build.

## D1 — Governance: independent clinician-led pilot first
Launch on independent hosting following the SWSLHD LibGuides / Ingham Institute precedent; demonstrate value, then pursue SWSLHD endorsement with a working product. The stack (static site + Git) is chosen to migrate cleanly to an official home later.

## D2 — Scope: Campbelltown Hospital only
Sharp identity for the pilot. Affiliation queries target `Campbelltown Hospital[Affiliation]`. Camden/Macarthur/district expansion is a deliberate later step, not a v1 concern. Relationship with Ingham Institute (Macarthur) and SWIRL: link, don't duplicate; reassess partnership once live.

## D3 — Editing surfaces: Git-backed web CMS + SharePoint/M365 seam
- Primary: a Git-backed browser CMS (Sveltia/Decap-class) for news, pages, profiles.
- Secondary: SharePoint Lists for staff-owned content (e.g. project noticeboard), pushed to the repo by a Power Automate flow. MS Forms for student EOIs.
- Architecture = BRAINSTORM Option A + Option D seam, as recommended.

## D4 — Researcher profiles: auto-stub, publish on nod
The pipeline auto-generates profile stubs from public PubMed data (name, department, publications). Each researcher gets a quick consent ask before their profile goes live; the nod is recorded (consent trail for any future PIA). No photos/direct contact details without explicit provision.

## D5 — Publications rule: include all, badge "Campbelltown-led"
Every Campbelltown-affiliated paper appears on the wall. Papers with a Campbelltown first/last/corresponding author get a "Campbelltown-led" badge and filter. Stat tiles report both counts.

## D6 — Access model: fully public site + companion SharePoint "Staff area"
No auth on the site itself. Sensitive/internal content (contact numbers, meeting schedules, internal docs) lives in a companion SharePoint site, linked from a consistent, visible "Staff area" pattern throughout the public site; M365 enforces the login. Building the companion SharePoint structure is in scope for the project.

**Open action (owner):** test whether external sites (e.g. inghaminstitute.org.au, a *.pages.dev site) open from a clinical desktop on the NSW Health network — determines nothing about architecture but confirms reachability where JMOs work.

## D7 — Pipeline autonomy: tiered
- Auto-publish immediately: bibliographic facts (title, authors, journal, DOI, dates), trial statuses.
- Human-gated: AI-drafted lay summaries and department tags ship in the harvest PR and appear only after batch approval — or publish flagged "auto-generated" if unreviewed after a grace period (default: 14 days, tune later).

## D8 — Custodianship & budget
- Create a free **GitHub organisation** for the project with ≥2 owners (owner + a research office/colleague account, anchored to a role mailbox where possible). This repo migrates there.
- **Small budget approved (~AU$20–100/yr)** → register a proper custom domain rather than a free hosting subdomain. Domain *name* not yet chosen — shortlist needed (e.g. `campbelltownresearch.org.au`-style; note `.org.au` requires an eligible entity, `.au`/`.com.au` direct registration is simpler for an unincorporated pilot — verify eligibility before purchase).

## Deferred / follow-up items
1. **ANZCTR connector spike** — scraping refuted in verification; evaluate ClinicalTrials.gov dual-registration coverage first, then a formal ANZCTR data request. Until then, Australian-only trials may be under-represented and can be manually curated (small list).
2. **Domain name shortlist** — owner to pick; check auDA eligibility rules per TLD.
3. **Intranet reachability test** — see D6.
4. **Supervisor self-service editing** (Monash pattern) — v2; keep project-listing schema compatible with per-supervisor ownership.
