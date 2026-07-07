# Campbelltown Hospital Research Website — Brainstorm & Architecture Proposal

*Founding document — July 2026. Synthesised from deep multi-source web research (24 primary/secondary sources, 118 extracted claims, top 25 adversarially verified: 22 confirmed / 3 refuted) plus live API feasibility probes run from this repository's build environment.*

---

## 1. Vision

A single, elegant, always-current home for research at Campbelltown Hospital (SWSLHD):

- **Public showcase** — publications, clinical trials, research groups, news, impact stats.
- **Discovery engine for students & JMOs** — find a topic, a supervisor, and a project that fits your term, your skills, and your time budget.
- **Zero-rot content** — the publication wall, trial listings, and researcher profiles update themselves from authoritative sources (PubMed, ClinicalTrials.gov, ORCID, ANZCTR); humans only curate and add narrative.
- **Editable by the research office** — non-technical staff can add news, projects, and people without touching code.

## 2. Why this site should exist (evidence)

The research confirmed a genuine gap — this would not duplicate anything that exists:

| Finding | Evidence |
|---|---|
| SWSLHD's official research page is a thin overview: three links (Research Directorate under `/ethics/`, Ingham Institute, a 2019 strategy PDF). No publications list, no trials register, no researcher profiles, no news. | [swslhd.health.nsw.gov.au/research.html](https://www.swslhd.health.nsw.gov.au/research.html) |
| That page shows **"Page last updated: 26 May 2022"** — four years stale. Hand-edited pages on NSW Health infrastructure rot; automation is the antidote. | same |
| The official SWSLHD site runs on **legacy ColdFusion** behind F5 load balancers (CFID/CFTOKEN cookies observed in live probe) — not a platform to build a modern site on. | live HTTP probe, Jul 2026 |
| SESLHD (the comparison LHD) organises its research hub entirely around *process* (ethics, governance, forms, grants) — no public showcase, no supervisor directory, no searchable trials. Early-career researcher support is drop-in Q&A sessions, not an online tool. | [seslhd.health.nsw.gov.au research hub](https://www.seslhd.health.nsw.gov.au/services-clinics/directory/research-home) |
| SWSLHD already hosts public research content **outside** NSW Health web infrastructure: the Clinical Library's LibGuides site (swslhd.libguides.com, updated daily) — precedent that a district research team can run a modern externally-hosted site. | [swslhd.libguides.com](https://swslhd.libguides.com/Research/Trials) |
| SWSLHD maintains a staff publications database called **SWIRL** ("a listing of staff publications showcasing the research output of SWSLHD staff") plus an institutional repository (swslhd.intersearch.com.au eLibrary) — existing datasets to integrate with or deliberately supersede, not ignore. | [LibGuides SWIRL page](https://swslhd.libguides.com/Research/SWIRL) |
| The Ingham Institute (SWSLHD's affiliated MRI) runs a custom agency-built site on its own `.org.au` domain, outside NSW Health hosting — the strongest local precedent for an independently-hosted research presence linked from official pages. Note: its new **Macarthur building sits on the Campbelltown Hospital campus** (opened Nov 2025), and its Macarthur web presence is still building out (placeholder pages for Addiction Medicine, Indigenous Health) — coordination is both an opportunity and an overlap risk. | [inghaminstitute.org.au](https://inghaminstitute.org.au/) |
| The **modern standard public platform for NSW LHDs is a shared Drupal 10 CMS** (`nswlhd` theme — verified on SESLHD and WSLHD sites), which SWSLHD has *not* migrated to (its pages fingerprint as Microsoft FrontPage-generated on ColdFusion). "Put it on the official platform" therefore means the NSW Health Drupal platform, probably coupled to a future SWSLHD replatforming — not SWSLHD's current stack. | live fingerprints: [SESLHD](https://www.seslhd.health.nsw.gov.au/services-clinics/directory/research-home), [WSLHD](https://www.wslhd.health.nsw.gov.au/) |

**Campbelltown's research volume justifies automation:** a live PubMed E-utilities probe found **167 publications with a Campbelltown Hospital affiliation since Jan 2025** (~900 SWSLHD-wide since 2023). Nobody will hand-enter that; a pipeline will.

## 3. Design direction — what the best exemplars do

### Information architecture patterns worth stealing

- **Ingham Institute** — shallow 5-item top nav (About / Research / News & Events / Support Us / Contact); research organised by *campus* (Liverpool vs Macarthur) and *theme* (cancer, cardiovascular, diabetes, childhood wellbeing…). Directly reusable for a hospital with departmental research streams.
- **UHN Toronto (Find a Supervisor)** — audience-segmented nav (*For Trainees / For Scientists / For Staff / For Patients*) and a dual discovery pathway: **browse by interest** and **browse by name/institute**. Simple, effective, low-tech.
- **Monash Supervisor Connect** — the gold standard for the student/JMO use case: advertised *projects* (not just people; 1,641 live projects at verification), keyword search + facet filters (research area, school, degree stream), supervisor self-service logins (SSO) so listings stay current without central admin, expression-of-interest forms routed straight to the researcher, plus editorial guidance ("how to choose a supervisor", "how to write the first email"). A complete discovery-to-application funnel.
- **Monash Find a Researcher** — architecturally: a static CMS page with an embedded client-side search widget backed by a maintained search index — *not* a dynamic web app. This "static page + search index" pattern is exactly what modern static-site tooling (Pagefind) gives us for free.
- **Harvard Profiles RNS / VIVO (research networking systems)** — validated at scale: 47/48 US CTSA academic medical centres run researcher-profile systems; 51/53 auto-populate profiles from **publication data** as the backbone. Co-authorship networks are generated from PubMed metadata, not manual curation. Most institutions made profiles **mandatory/auto-created (53%) or opt-out (33%), not opt-in (10%)** — a useful governance precedent. Notably these systems historically under-serve trainees — the exact gap our JMO focus fills.

### Proposed IA (v1)

```
Home
├── Research            → themes/groups by department (Cardiology, Respiratory, Paeds, …)
├── People              → researcher profiles (auto-populated pubs, ORCID-linked), browse by name/topic
├── Publications        → auto-updating wall, filter by year/department/type; impact stat tiles
├── Clinical Trials     → auto-synced recruiting trials at Campbelltown, lay summaries
├── Students & JMOs     → project noticeboard, "find a supervisor" dual pathway, how-to guides, EOI form
└── News & About        → research office news, governance links (ethics, SWSLHD Research Directorate), contact
```

**JMO-first differentiators (nobody else does these):**
- Projects tagged by **commitment level** (case report / audit / QI / prospective study), **time budget** (one term, 6 months, ongoing), **skills gained** (stats, ethics submission, first-author opportunity), and a **"recruiting students now"** flag.
- Lay + technical summaries per project; auto-drafted lay summaries for new publications (AI-assisted, human-approved).
- Term-aware: JMO rotations churn every 10 weeks — the noticeboard needs freshness indicators and expiry dates so listings self-clean.

**Visual design:** clean, editorial, WCAG 2.2 AA from day one (the NSW Digital Design Standards baseline). If ever migrated under an official NSW domain, the NSW Design System becomes mandatory — so borrowing its typography/spacing idioms now (without being bound by it) keeps that door open.

## 4. Governance reality check (NSW Health context)

These constraints shape the hosting decision more than any technology preference:

1. **DCS-2020-01 (NSW website consolidation circular)** — verified verbatim: agencies *"should not launch new websites if the content meets criteria to be published on the central NSW Government website"*; status Active, compliance **Mandatory**, scope includes statutory authorities (LHDs are statutory health corporations). New `nsw.gov.au` domains are restricted to defined government bodies, require **CEO-or-delegate sponsorship** and Domain Administrator compliance review, and applications are steered toward *subdomains/subdirectories of existing domains*. Note the operative verb is *should not* with case-by-case exception pathways — in practice a **negotiation reality, not an absolute bar** (NSW Health entities routinely operate their own health.nsw.gov.au subdomains).
2. NSW Government entities are forbidden from registering new `.com/.org/.net` domains for official sites.
3. Official NSW digital services must meet **WCAG 2.2 AA** and use the **NSW Design System**; NSW Cyber Security Policy and privacy-by-design (PIAs for anything holding personal data — e.g., supervisor profiles) apply.
4. **But**: the Ingham Institute (separately incorporated charity, own domain) and SWSLHD LibGuides (third-party SaaS) precedents show research-adjacent content routinely lives *outside* this regime, linked from official pages.

**Implication:** the fork in the road is *official* (SWSLHD-endorsed, hosted under health.nsw.gov.au — months of process, design-system-bound, but permanent and credible) vs *independent pilot* (own hosting, launched in weeks, formal endorsement sought later — the LibGuides/Ingham path). This is Question #1 for you below.

## 5. Auto-update pipeline — feasibility verified

Live probes from this environment (July 2026):

| Source | Status | Detail |
|---|---|---|
| **PubMed (NCBI E-utilities)** | ✅ Works today | `Campbelltown Hospital[Affiliation]` → 167 pubs since 2025. Rich metadata: title, abstract, DOI, keywords, **department-level affiliations** ("Department of Cardiology, Campbelltown Hospital") → auto-tag by department. Rate limits: 3 req/s (10 with free API key); include `tool`+`email` params; schedule bulk jobs off-peak US time. |
| **ClinicalTrials.gov v2 API** | ✅ Works today | No key needed, JSON, `filter.overallStatus=RECRUITING`, pagination to 1000/page. 27 recruiting trials matched Campbelltown as location. Caveat: location-string matching also catches "GenesisCare - Campbelltown" → filter on exact facility names. |
| **ANZCTR** | ❓ Needs a technical spike | Live probe returned 403 (bot protection); no official public REST API. Claims that ANZCTR can be harvested via XML search-exports (the old Oxford EBM DataLab scraper approach) **failed adversarial verification** — that method is unvalidated today and should not be planned for. Realistic candidates, in order: (1) rely on dual-registration in ClinicalTrials.gov, (2) formal data-access request to ANZCTR, (3) WHO ICTRP exports, (4) manual curation of the (small) Campbelltown trial list. Decide after a short spike. |
| **ORCID public API** | ✅ (documented) | `pub.orcid.org/v3.0` with a ~20-year token; enrich with **doi.org content negotiation** (`Accept: text/x-bibliography`) for formatted citations without a separate CrossRef integration. Known gap: ORCID work summaries can omit co-authors → always enrich via DOI. |

### Pipeline design (the boring-and-robust version)

```
GitHub Actions (cron, weekly Sat morning AEST)
  ├── harvest-pubmed.yml      → ESearch (affiliation query) → EFetch → normalise → JSON/MD
  ├── sync-trials.yml         → ClinicalTrials.gov v2 (+ ANZCTR connector when resolved)
  ├── enrich-orcid.yml        → per-researcher ORCID pull + doi.org citation formatting
  └── curate.yml (AI agent)   → dedupe vs existing content, tag by department/theme,
                                 draft lay summary, flag "Campbelltown-led vs co-authored"
        ↓
  Pull request per batch → research office reviews in a friendly diff view (or auto-merge
  with a "needs-review" badge on the site) → merge → site rebuilds & deploys in ~60s
```

Every new item arrives as a **reviewable change, never a silent mutation** — that's the human-in-the-loop guardrail, and Git gives it to us for free. The "PR per harvest batch" pattern is proven in the wild (ORCID Record Action's cron-fetch-commit loop).

**Curation rule to decide (Question #5):** affiliation search catches papers where only one middle co-author is Campbelltown-based. Include everything (bigger numbers) or badge/filter "Campbelltown-led" (first/last/corresponding author affiliation)?

## 6. Candidate architectures

### Option A — Static site + Git-backed CMS + GitHub Actions *(recommended)*

Astro static site → deployed on Cloudflare Pages/Netlify/GitHub Pages. Content as Markdown/JSON collections in this repo. Editing via **Sveltia or Decap CMS** (free, Git-backed, browser-based forms — no servers) or **TinaCMS** if live visual preview matters. Search via **Pagefind** (static, client-side, zero infrastructure). Pipelines as above.

- ✅ Effectively **$0/month**, no servers, no database, nothing to patch (evidence: typical WordPress ≈ 25–40 h/yr maintenance vs ~zero for static; no admin panel/DB/plugin attack surface — relevant on a health-adjacent site).
- ✅ Best-in-class design freedom, performance, SEO; WCAG-compliant by construction if we build it so.
- ✅ Pipelines, content, and site live in one repo — one thing to hand over, full history/audit trail.
- ✅ Works fine on NSW Health desktops (it's just a fast public website in Edge).
- ⚠️ Editing UX is "structured forms in the browser," good but not Word; there's a one-time setup cost in content modelling.
- ⚠️ Needs one technically-literate custodian (or an AI-assisted repo like this one) for occasional dependency bumps.

### Option B — Integrate into the official NSW Health Drupal 10 LHD platform

The governance-safest public home: the shared Drupal platform SESLHD/WSLHD already run, NSW Design System-aligned, brand-native, permanent.

- ✅ Zero governance risk once approved; institutional credibility; survives staff turnover.
- ❌ SWSLHD hasn't migrated to it — you'd be coupling the project to a district replatforming timeline you don't control.
- ❌ Least automatable option: the observed LHD pattern on this platform is thin, hand-edited process pages (the exact staleness failure mode this project exists to fix). External build pipelines committing content into a managed government Drupal instance is not a supported pattern.
- Verdict: the right *eventual* home for an official presence, and worth opening the conversation with SWSLHD comms now — but building *on* it first would sacrifice the auto-update capability that is the project's core idea.

### Option C — All-Microsoft: SharePoint (internal) + Power Pages (public) + Power Automate

- ✅ Zero new vendors; IT-governance friendly (RBAC, MFA, compliance alignment); Power Automate flows can poll APIs; editors already live in M365.
- ❌ SharePoint Communication Sites **cannot be public** (authenticated internal audiences only; guest-account workarounds are a known anti-pattern) — so the public site *must* be Power Pages.
- ❌ Power Pages: per-user + Dataverse licensing with **unpredictable cost at public traffic scale**; hard ceilings on design freedom, performance tuning and SEO — even Microsoft-partner consultancies concede it's a poor fit for design-led public sites.
- ❌ Two platforms to run (SharePoint + Power Pages) for one product; scraping pipelines in Power Automate hit premium-connector licensing and are clumsy at parsing XML/JSON at volume.
- Verdict: right platform for *internal business portals*; wrong platform for an elegant public research showcase.

### Option D — Hybrid: Option A's public site + M365 as the *staff interface*

The public site stays static (Option A), but the research office **edits where they already live**:
- Project noticeboard & people directory as **SharePoint Lists** (or Microsoft Lists/Forms for EOI submissions).
- **Power Automate** flow on list change → pushes JSON to the GitHub repo via API → site rebuilds automatically.
- Student EOIs via MS Forms → SharePoint → supervisor notification via Power Automate/Teams.
- ✅ Editors get familiar M365 forms; the public site keeps Option A's elegance and $0 hosting; intranet integration comes free (it *is* the intranet toolset).
- ⚠️ One integration seam to maintain (the flow), and content truth is split between Git and SharePoint — needs clear "which system owns what" rules.

### Option E — Off-the-shelf research networking system (VIVO, Harvard Profiles RNS)

Mature, validated pattern (30+ institutional deployments; Profiles RNS is even C#/.NET/SQL Server — Microsoft-native). But these are heavyweight self-hosted institutional systems aimed at whole-university scale; running one for a single hospital contradicts "low maintenance." **Use as a pattern library, not a platform.**

*(Also considered and rejected: WordPress — the maintenance/security burden is the exact thing we're designing away; headless WordPress is recommended only for 50+ author newsrooms.)*

### Recommendation

**Start with Option A; add Option D's M365 seam only where staff workflows demand it** (EOI forms first — MS Forms → Power Automate → email/Teams notification is genuinely the easiest win and needs no integration with the site at all, just a link).

This is the architecture that maximises elegance and power while minimising the two scarce resources: money and ongoing maintenance attention. It also keeps every door open: the repo can later be re-pointed at an official domain, re-skinned in the NSW Design System, or handed to SWSLHD digital — content, pipelines, and history intact.

**Phasing that de-risks governance** (rather than betting everything on one approval):
1. Build the site + ingestion pipelines now (no approval needed to *build*; content is public data).
2. Launch internal-first: circulate to JMOs/students/research office via intranet link, Teams, and orientation materials — an "internal tool with public content" needs no domain decision.
3. In parallel, open the conversation with SWSLHD comms/Research Directorate about the public home (Option A's independent domain vs eventual Option B Drupal migration) with a working product in hand — demos beat proposals.

## 7. Suggested MVP → v2 roadmap

**MVP (a weekend of build + content seeding):**
1. Astro site, 6-section IA above, Pagefind search, WCAG 2.2 AA.
2. PubMed pipeline live: auto-publication wall with department tags + stat tiles.
3. ClinicalTrials.gov pipeline: recruiting-at-Campbelltown trial cards.
4. Hand-seeded: ~10 researcher profiles, ~10 projects on the student/JMO noticeboard, 3 news posts.
5. MS Forms EOI link + Sveltia CMS for staff edits.

**v2:** ORCID enrichment, ANZCTR connector (once access path chosen), AI lay-summary drafts, co-authorship network visual, supervisor self-service updates, SWIRL reconciliation, internal-only section (Entra ID login) if needed.

## 8. Refined questions for direction

> **Resolved 7 July 2026** — all eight questions were put to the project owner and locked. See [DECISIONS.md](./DECISIONS.md) for the outcomes; the questions below are retained for context.

1. **Governance & identity** — official SWSLHD-endorsed site (slow, permanent, design-system-bound) or independent clinician-led pilot à la LibGuides/Ingham (fast, endorsement later)? **Who specifically is the sponsor** — do you have a champion in the Campbelltown research office / SWSLHD Research Directorate / comms who would put their name on a domain application or endorse a pilot? And what domain: e.g. `campbelltownresearch.org.au`-style, a LibGuides-like subdomain, or pursue `health.nsw.gov.au` real estate?
2. **Scope boundary** — Campbelltown only, Campbelltown+Camden (Macarthur), or all SWSLHD? How do we relate to Ingham Institute (partner/link/ignore) and the existing SWIRL publications database (integrate/supersede)?
3. **Editors** — who actually edits (names/roles/count), and would they rather edit in a friendly web CMS or in SharePoint/Excel-like lists? This decides Option A vs C for each content type.
4. **Researcher profiles** — auto-create from PubMed harvest (opt-out, the academic-medical norm) or opt-in with consent? Any NSW Health privacy/PIA sensitivities about listing staff names, photos, emails?
5. **Publication inclusion rule** — everything with a Campbelltown affiliation, or badge/filter "Campbelltown-led"?
6. **Internal vs public split** — is anything genuinely intranet-only (supervisor phone numbers, meeting schedules, datasets)? If yes: link out to SharePoint for that, or build an authenticated section (Entra ID) on the site? Also a 2-minute test only you can run: **can you open arbitrary external websites (e.g. inghaminstitute.org.au, a Netlify site) from a clinical desktop on the NSW Health network?** The research found no verified documentation of eHealth NSW web-filtering rules, and this single fact determines whether an externally-hosted site is reachable where JMOs actually work.
7. **AI curation autonomy** — auto-publish harvested items with a review badge, or hold everything in a review queue until a human approves?
8. **Custodianship & budget** — who owns the GitHub org/hosting accounts long-term (JMOs rotate; bus-factor matters)? Is there *any* recurring budget (domain ≈ AU$20/yr is the only hard cost in Option A), or strictly $0?

## 9. Sources

Key sources behind this document (all verified against live fetches, Jul 2026): [Ingham Institute](https://inghaminstitute.org.au/) · [UHN Find a Supervisor](https://www.uhnresearch.ca/service/find-supervisor) · [Monash Supervisor Connect](https://www.monash.edu/medicine/research/supervisorconnect) · [Monash Find a Researcher](https://www.monash.edu/research/find) · [SWSLHD research page](https://www.swslhd.health.nsw.gov.au/research.html) · [SWSLHD LibGuides](https://swslhd.libguides.com/Research/Trials) · [SESLHD research hub](https://www.seslhd.health.nsw.gov.au/services-clinics/directory/research-home) · [NCBI E-utilities](https://www.ncbi.nlm.nih.gov/books/NBK25497/) · [ClinicalTrials.gov v2 API notes](https://dev.to/avabuildsdata/how-to-search-clinicaltrialsgov-programmatically-the-v2-api-is-actually-good-now-2i2a) · [ORCID Record Action](https://github.com/marketplace/actions/orcid-record-action) · [ORCID auto-update pattern](https://chrisholdgraf.com/blog/2022/orcid-auto-update/) · [EBM DataLab registry scrapers](https://github.com/ebmdatalab/registry_scrapers_parsers) · [DCS-2020-01 website consolidation](https://arp.nsw.gov.au/dcs-2020-01-nsw-government-website-consolidation/) · [nsw.gov.au domain policy](https://www.nsw.gov.au/nsw-government/communications/nswgovau-domain-names) · [NSW Digital Design Standards](https://www.digital.nsw.gov.au/delivery/digital-service-toolkit/design-standards) · [Power Pages pros/cons](https://i3solutions.com/microsoft-power-pages/microsoft-power-pages-pros-and-cons/) · [Power Pages vs SharePoint sites](https://sharepointsupport.com/blog/power-pages-vs-sharepoint-communication-sites-2026) · [Astro CMS comparisons](https://webuildstores.co.uk/insights/best-cms-for-astro/) · [Astro vs WordPress TCO](https://webuildstores.co.uk/insights/astro-vs-wordpress/) · [Research networking tools comparison](https://en.wikipedia.org/wiki/Comparison_of_research_networking_tools_and_research_profiling_systems) · [CTSA RNS adoption study](https://pmc.ncbi.nlm.nih.gov/articles/PMC4610407/) · [Harvard Profiles RNS](https://catalyst.harvard.edu/informatics/open-source-software/profiles-rns/) · Live probes: PubMed E-utilities, ClinicalTrials.gov v2, ANZCTR (403), swslhd.health.nsw.gov.au (ColdFusion fingerprint).
