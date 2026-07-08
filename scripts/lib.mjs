/**
 * scripts/lib.mjs
 *
 * Shared helpers for the data-harvesting scripts (scripts/harvest-pubmed.mjs,
 * scripts/sync-trials.mjs). Extracted so the throttle/retry, file I/O, and
 * Campbelltown-matching logic exist in exactly one place — see
 * docs/DECISIONS.md D2 (scope) and D7 (pipeline autonomy / field-preserving
 * merge contract) for the policy this code implements.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

export { sleep };

// ---------------------------------------------------------------------------
// Shared config
// ---------------------------------------------------------------------------

export const HOSPITAL_NAME = 'Campbelltown Hospital';

// D2: scope is Campbelltown Hospital only for the pilot. When scope expands
// (Camden/Macarthur/district — see DECISIONS.md D2), this is the one place to
// broaden the PubMed affiliation query.
export const PUBMED_AFFILIATION_TERM = `"${HOSPITAL_NAME}"[Affiliation]`;

// ---------------------------------------------------------------------------
// Networking: throttle + retry
// ---------------------------------------------------------------------------

/**
 * Build a fetchWithRetry(url, options?) function that:
 *  - throttles requests to at least `minIntervalMs` apart (a shared, module-
 *    private clock per throttled-fetch instance, so each script gets its own
 *    independent rate limit even though they import the same factory), and
 *  - retries network errors and 429/5xx responses with exponential backoff,
 *    honouring a numeric `Retry-After` header when present, up to
 *    `maxRetries` attempts.
 */
export function createThrottledFetch({ minIntervalMs, maxRetries }) {
  let lastRequestAt = 0;

  async function throttle() {
    const now = Date.now();
    const wait = lastRequestAt + minIntervalMs - now;
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
  }

  async function fetchWithRetry(url, options = {}, attempt = 1) {
    await throttle();
    let res;
    try {
      res = await fetch(url, options);
    } catch (err) {
      if (attempt >= maxRetries) throw err;
      await sleep(2 ** attempt * 1000);
      return fetchWithRetry(url, options, attempt + 1);
    }
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= maxRetries) {
        throw new Error(`Request failed after ${attempt} attempts: ${res.status} ${res.statusText} — ${url}`);
      }
      const retryAfter = Number(res.headers.get('retry-after'));
      const backoff = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 1000;
      await sleep(backoff);
      return fetchWithRetry(url, options, attempt + 1);
    }
    if (!res.ok) {
      throw new Error(`Request failed: ${res.status} ${res.statusText} — ${url}`);
    }
    return res;
  }

  return fetchWithRetry;
}

// ---------------------------------------------------------------------------
// String helpers
// ---------------------------------------------------------------------------

export function truncate(str, maxLen) {
  if (!str) return '';
  const clean = str.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  const cut = clean.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(' ');
  const trimmed = lastSpace > maxLen * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${trimmed.trimEnd()}…`;
}

// ---------------------------------------------------------------------------
// Campbelltown Hospital matcher — the ONE canonical matcher shared by both
// scripts (harvest-pubmed's author/campbelltownLed/department detection, and
// sync-trials' facility post-filter).
//
// Matching rule: lowercase the text, strip everything that isn't a letter
// (collapses spaces, punctuation, hyphens — so "Campbelltown  Hospital,",
// "CampbelltownHospital" and "Campbelltown-Hospital" all normalise the same
// way), then check for:
//   - the literal substring "campbelltownhospital", OR
//   - a Camden-combined form where both hospitals are named together, e.g.
//     "Camden and Campbelltown Hospitals" -> collapses to
//     "camdenandcampbelltownhospitals", which contains "campbelltownhospitals";
//     "Campbelltown and Camden Hospital" / "Campbelltown & Camden Hospitals"
//     collapse to forms containing "campbelltownandcamdenhospital(s)".
//
// Deliberately does NOT match "Campbelltown Private Hospital" (the word
// "private" sits between "campbelltown" and "hospital" so the collapsed
// string is "campbelltownprivatehospital", which does not contain
// "campbelltownhospital"), "Campbelltown Medical & Dental Centre", or
// "GenesisCare - Campbelltown" (no "hospital" at all).
// ---------------------------------------------------------------------------

export function isCampbelltownHospital(text) {
  if (!text) return false;
  const collapsed = text.toLowerCase().replace(/[^a-z]/g, '');
  // The common case: "Campbelltown" immediately precedes "Hospital(s)" once
  // whitespace/punctuation is stripped. This already covers combined forms
  // where Campbelltown is the LAST-named hospital, e.g. "Camden and
  // Campbelltown Hospitals" -> "camdenandcampbelltownhospitals" contains
  // "campbelltownhospital" as a substring.
  if (collapsed.includes('campbelltownhospital')) return true;
  // Combined forms where Camden is named SECOND, i.e. Campbelltown is not
  // immediately followed by "Hospital" — "Campbelltown and Camden Hospital(s)"
  // and its "&" variant. ("&" is stripped by the letters-only collapse, same
  // as removing "and" entirely, so both conjunctions normalise the same way.)
  return (
    collapsed.includes('campbelltownandcamdenhospital') ||
    collapsed.includes('campbelltowncamdenhospital')
  );
}

// ---------------------------------------------------------------------------
// Existing-data loading — FAIL LOUD on corruption. Only a missing file
// (ENOENT) is treated as "no existing data"; any other read/parse error
// means something is wrong with a file that DOES exist, and silently
// treating that as "start empty" would upsert on top of nothing and lose
// every previously-harvested record (and any hand-curated fields on them —
// see upsertByKey below). --fresh explicitly opts into starting empty.
// ---------------------------------------------------------------------------

export function loadExistingItems(fileUrl, { fresh } = {}) {
  if (fresh) return { items: [] };
  let raw;
  try {
    raw = readFileSync(fileUrl, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return { items: [] };
    console.error(`Failed to read ${fileUrl.pathname ?? fileUrl}: ${err.message}`);
    console.error('Refusing to start from empty — fix or delete the file, or pass --fresh.');
    process.exit(1);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    console.error(`Failed to parse ${fileUrl.pathname ?? fileUrl} as JSON: ${err.message}`);
    console.error('Refusing to start from empty — fix or delete the file, or pass --fresh.');
    process.exit(1);
  }
  return { items: Array.isArray(data.items) ? data.items : [] };
}

// ---------------------------------------------------------------------------
// Upsert-by-key merge. Field-preserving: the merged record is
// `{ ...existing, ...fetched }`, so any extra field the harvester itself
// doesn't produce (e.g. a future D7 human-curated `laySummary` or
// `curationStatus`) survives every re-harvest untouched. `updated` only
// counts records whose *merged* shape actually differs from what was already
// stored — an identical re-fetch is neither added nor updated.
// ---------------------------------------------------------------------------

export function upsertByKey(existingItems, fetchedItems, keyFn, mergeFn) {
  const byKey = new Map(existingItems.map((item) => [keyFn(item), item]));
  let added = 0;
  let updated = 0;
  for (const fetched of fetchedItems) {
    const key = keyFn(fetched);
    const existing = byKey.get(key);
    if (existing === undefined) {
      added += 1;
      byKey.set(key, mergeFn(undefined, fetched));
      continue;
    }
    const merged = mergeFn(existing, fetched);
    if (JSON.stringify(merged) !== JSON.stringify(existing)) {
      updated += 1;
    }
    byKey.set(key, merged);
  }
  return { items: [...byKey.values()], added, updated };
}

/** Default field-preserving merge: existing fields survive unless the fetch overwrites them. */
export function defaultMerge(existing, fetched) {
  return { ...(existing ?? {}), ...fetched };
}

// ---------------------------------------------------------------------------
// Write-if-changed. Re-reads whatever is currently on disk at `fileUrl` and
// compares its `items` against the new `items` by content; skips the write
// (keeping the previous `generated` stamp) when nothing actually changed.
// This is what makes harvest.yml's `git diff --cached --quiet` no-op guard
// work on a week with zero changes: no write means no diff means no commit.
// ---------------------------------------------------------------------------

export function writeDataFile(fileUrl, source, items, previousGenerated) {
  // Read whatever is currently on disk (independent of what the caller used
  // to build `items`) so the comparison is against the true current state of
  // the file, not a copy the caller might have mutated in memory.
  let onDiskItems;
  let onDiskGenerated = previousGenerated ?? null;
  try {
    const raw = readFileSync(fileUrl, 'utf8');
    const data = JSON.parse(raw);
    onDiskItems = Array.isArray(data.items) ? data.items : undefined;
    onDiskGenerated = data.generated ?? onDiskGenerated;
  } catch {
    onDiskItems = undefined;
  }

  if (onDiskItems !== undefined && JSON.stringify(onDiskItems) === JSON.stringify(items)) {
    console.log('No changes — file untouched.');
    return { written: false, generated: onDiskGenerated };
  }

  const generated = new Date().toISOString();
  const output = { generated, source, items };
  writeFileSync(fileUrl, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Wrote ${items.length} items to ${fileUrl.pathname ?? fileUrl}`);
  return { written: true, generated };
}

// ---------------------------------------------------------------------------
// Department-name alias map (B4c). Applied AFTER normaliseDeptName() in
// harvest-pubmed.mjs, keyed on the normalised (title-cased) name so it's
// independent of casing quirks upstream.
//
// To extend: add a `'Normalised Input Name': 'Preferred Output Name'` entry
// below. Set the value to `null` to drop a known false positive entirely
// (e.g. a department phrase that actually names a different hospital) —
// deriveDepartments() filters out any alias that resolves to null. Keys are
// matched case-sensitively against normaliseDeptName()'s output, so check
// what that function actually produces (title case, small-word lowercasing,
// ICU/ED/GP/ENT preserved) before adding an entry.
// ---------------------------------------------------------------------------

// IMPORTANT: keys must match normaliseDeptName()'s ACTUAL output exactly
// (case-sensitive) — that means small words (of/and/the/for/in) are already
// lowercased except as the first word, so e.g. "Diabetes and Endocrinology"
// (lowercase "and"), NOT "Diabetes And Endocrinology". When adding an entry,
// run the phrase through normaliseDeptName mentally (or check a harvest's
// printed department list) before typing the key.
export const ALIAS_MAP = {
  // Duplicate/variant spellings observed in the initial seed run — collapse
  // to one canonical form.
  'Diabetes and Endocrinology': 'Diabetes & Endocrinology',
  'Macarthur Cancer Center': 'Macarthur Cancer Therapy Centre',
  'Macarthur Cancer Therapy Clinic': 'Macarthur Cancer Therapy Centre',
  'Immunology and Allergy': 'Immunology & Allergy Unit',
  'Immunology and Allergy Unit': 'Immunology & Allergy Unit',
  'Immunology/Allergy Unit': 'Immunology & Allergy Unit',
  'Clinical Immunology and Allergy Unit': 'Immunology & Allergy Unit',
  'Allergy and Clinical Immunology': 'Immunology & Allergy Unit',
  'Allergy and Immunology Unit': 'Immunology & Allergy Unit',
  'Hepatology and Gastroenterology': 'Gastroenterology and Hepatology',
  'Obstetrics & Gynecology': 'Obstetrics & Gynaecology',
  'Obstetrics and Gynaecology': 'Obstetrics & Gynaecology',
  'Obstetrics and Gynecology': 'Obstetrics & Gynaecology',
  'Macarthur Diabetes and Endocrine Service': 'Macarthur Diabetes Endocrinology and Metabolism Service',
  'Macarthur Diabetes Service': 'Macarthur Diabetes Endocrinology and Metabolism Service',
  'Obesity and Metabolism Translational Research Unit': 'Diabetes Obesity and Metabolism Translational Research Unit',
  'Metabolism Translational Research Unit': 'Diabetes Obesity and Metabolism Translational Research Unit',
  'Intensive Care': 'Intensive Care Unit',
  // Same unit, spelling/suffix variants only (judgment call — see docs/PIPELINES.md).
  'Orthopedics': 'Orthopaedic Surgery',
  'Rheumatology Unit': 'Rheumatology',

  // Known false positives — the matched phrase actually names a different
  // hospital/service, or is a job title/role rather than a department, not a
  // Campbelltown Hospital department. Drop these.
  'Cardiology Liverpool Hospital': null,
  'Concord Cancer Centre': null,
  'Head of Unit': null,
};

// Note: "MacArthur"/"MACARTHUR"/"macarthur" casing variants are already
// collapsed to the single correct "Macarthur" spelling by normaliseDeptName's
// title-casing (B4b) before ALIAS_MAP is consulted — title-casing a
// single unbroken letter-run always yields "Macarthur" regardless of the
// source casing, so no separate alias entries are needed for that case.
// ALIAS_MAP entries below exist for genuine wording differences (different
// words/abbreviations for what is the same department) and the drop-list.

/** Apply ALIAS_MAP to a single normalised (title-cased) department name. Returns '' to drop it. */
export function applyDeptAlias(name) {
  if (Object.prototype.hasOwnProperty.call(ALIAS_MAP, name)) {
    const alias = ALIAS_MAP[name];
    return alias === null ? '' : alias;
  }
  return name;
}
