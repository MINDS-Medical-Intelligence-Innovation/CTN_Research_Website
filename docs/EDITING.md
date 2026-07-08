# Editing this site — a guide for the research office

This is a non-technical guide to keeping the Campbelltown Hospital Research website up to
date. You don't need to know any code or use Git directly — everything below happens through a
web form. If something here doesn't match what you see on screen, or you get stuck, see
**Who to contact** at the end.

## 1. Logging in

The site content is edited through a screen called the **Content Manager**, at:

```
/admin/
```

(for example, `https://<the-site's-domain>/admin/`).

To log in you need:

- **A GitHub account.** GitHub is the (free) service that stores the website's content and
  history. If you don't have one, create one at [github.com](https://github.com) — use a
  personal or role-mailbox email, whichever your team has agreed to use as the account of
  record.
- **Membership of the project's GitHub organisation**, with write access to this repository.
  The research office should have at least one, ideally two, people added as members or
  "owners" so the project doesn't depend on a single person (see decision **D8** in
  [`DECISIONS.md`](./DECISIONS.md)). If you don't have access yet, contact whoever currently
  holds the GitHub organisation (see **Who to contact**) and ask to be added.

When you open `/admin/` for the first time, click **Log in with GitHub** and authorise the
app. After that, you'll see a list of content types down the left: **News**, **Students &
JMOs: Projects**, and **People**.

Every change you make and save is recorded as a proper entry in the site's history — who
changed what, and when — the same way it would be for a document with track changes on,
permanently. Nothing you do here can be silently lost.

## 2. Adding a news post

1. Go to **News** → **New News post**.
2. Fill in:
   - **Title** — the headline.
   - **Date** — the publish date. Posts are shown newest-first.
   - **Summary** — one or two sentences. This is the teaser shown on the News listing page, so
     make it stand alone (don't assume someone has read the full post).
   - **Author** — optional. Leave blank, or put "Research Office" or a person's name.
   - **Body** — the full post. A couple of short paragraphs is plenty; this isn't a newsletter.
3. Click **Publish** (or **Save** then **Publish**, depending on your workflow settings).

The post appears on the site's News page the next time the site rebuilds, which happens
automatically within a few minutes of publishing.

## 3. Adding or expiring a project (the student/JMO noticeboard)

Go to **Students & JMOs: Projects** → **New Project**. Fields to know:

- **Title** — be specific. "Audit of X" or "Prospective evaluation of Y" tells a student much
  more than "Cardiology project".
- **Department**, **Supervisor** — plain text, no fixed list. Use the supervisor's normal title
  (Dr, A/Prof, Prof, Mr/Ms, CNC, etc.).
- **Project type** — pick the closest match from the dropdown (Audit, Quality improvement,
  Case report, Retrospective study, Prospective study, Systematic review, Other). This drives
  the filter on the noticeboard, so pick carefully.
- **Commitment** — plain language, e.g. "One term", "6+ months", "Ongoing".
- **Skills gained** — a short list of what a student will actually learn (e.g. "REDCap data
  entry", "PDSA cycles"). This is one of the main things students scan for.
- **Recruiting students now?** — turn this ON only while you genuinely want someone to reach
  out immediately. Turn it OFF once the position is filled, without necessarily removing the
  listing (a project can stay listed as "not currently recruiting").
- **Contact email** — optional, only needed if interest should go somewhere other than the
  main expression-of-interest form.
- **Expiry date** — **this is the important one for keeping the noticeboard tidy.** Set it to
  the date after which the listing should stop appearing (e.g. the end of the term, or a fixed
  application deadline). The listing disappears from the site automatically after that date —
  you don't need to remember to come back and delete it. Leave it blank only for a genuinely
  open-ended listing that you're willing to manage manually.
- **Example / seed content** — leave this **OFF**. It's only used for the placeholder listings
  from the initial pilot build (see below).

To close a listing early, either set **Recruiting students now?** to off, edit the **Expiry
date** to today, or delete the entry entirely if it was never real.

### About the seeded example projects

The pilot launched with eight fictional example projects (marked **Example / seed content**)
covering Cardiology, Respiratory & Sleep, Paediatrics, Emergency, General Medicine, Mental
Health, Surgery, and Nursing & Midwifery research, so the noticeboard wasn't empty on day one
and so new editors have a template to copy. Replace them with real listings as they come in —
there's no need to keep the fictional ones once genuine projects exist, though a few can stay
as reference examples if that's useful for new supervisors learning the format.

## 4. People profiles — the consent rule (important)

**A person's profile only appears on the public site once they have confirmed, themselves,
that they're happy for it to be published.** This is a deliberate project decision (decision
**D4** in [`DECISIONS.md`](./DECISIONS.md)), not a technical limitation — please don't work
around it.

Concretely, in the **People** collection:

- Every profile has a **Consent status** field: **Pending** or **Granted**.
- New profiles default to **Pending**. A profile with consent set to Pending will **not**
  appear on the People page or get a public URL — it's saved in the system but invisible to
  visitors, exactly as if it didn't exist yet.
- Only switch a profile to **Granted** once the researcher has actually told you (an email is
  fine — keep it, in case it's ever needed as a record) that they're happy to have a public
  profile with the details you've entered.
- If a profile started as an auto-generated stub (drafted from public PubMed data as part of
  the site's publication pipeline), treat it exactly the same way: it stays Pending, and
  therefore invisible, until the researcher has confirmed.

There is one field that can look confusing here: **Example / seed content**. This flag exists
only to let a handful of clearly fictional demo profiles render on the site during the pilot
build, so the page design could be shown before any real consent process had happened — it is
**not** a way to skip the consent step for a real person. If you're ever tempted to turn
**Example** on for a real profile just to make it appear before consent is granted — don't.
Leave it off and wait for the researcher's actual confirmation.

For everything else — name, role, department, research themes, ORCID — just fill in what the
person has told you or what's on their public ORCID record. Bios should be short: one or two
paragraphs on what they research and why it matters is more useful to a reader than a full CV.

## 5. What NOT to edit

- **`src/data/publications.json` and `src/data/trials.json`** — these are generated
  automatically by the PubMed and ClinicalTrials.gov pipelines (see the main
  [`README.md`](../README.md) and `docs/PIPELINES.md`, once written). They are not part of the
  CMS and shouldn't be hand-edited — any manual change will be overwritten by the next
  automated run. If a publication or trial listing looks wrong, that's a pipeline or
  data-source issue, not something to fix by editing the file directly — flag it (see below)
  rather than patching it.
- **Anything under `scripts/`, `.github/`, or the site's code (`src/pages`, `src/components`,
  etc.)** — these aren't accessible from the Content Manager at all; if you find yourself
  looking at raw code to make a content change, stop and ask for help instead.
- **The consent gate itself.** If a Pending profile really needs to go live urgently, get the
  researcher's actual confirmation and switch the field — don't route around it via the
  Example flag or by editing files outside the CMS.

## Who to contact

- **Access problems** (can't log in, need to be added to the GitHub organisation): contact
  whoever currently holds the project's GitHub organisation ownership — see decision **D8** in
  [`DECISIONS.md`](./DECISIONS.md) for the custodianship arrangement, and update this line with
  a real name/role once that's settled.
- **Content questions** (what should/shouldn't go on the site, tone, department groupings):
  the research office team currently running the pilot.
- **Something looks technically broken** (a page won't load, a publication or trial listing
  looks wrong, the CMS itself errors out): flag it to the site's technical custodian rather
  than trying to fix it through the Content Manager — most of these issues live in the data
  pipelines or site code, not in editable content.

*(This contact section is intentionally a placeholder — see `docs/DECISIONS.md` D8. Replace
the descriptions above with actual names/roles once the research office's editing team is
confirmed.)*
