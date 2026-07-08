#!/usr/bin/env node
/**
 * scripts/sync-trials.mjs
 *
 * Syncs clinical trials with a Campbelltown Hospital location from the
 * ClinicalTrials.gov v2 API (https://clinicaltrials.gov/api/v2/studies) and
 * upserts them into src/data/trials.json.
 *
 * Zero npm dependencies — Node 22's global `fetch` only.
 *
 * Usage:
 *   node scripts/sync-trials.mjs [--dry-run] [--fresh]
 *
 *   --dry-run   Fetch and print the summary, but do not write trials.json.
 *   --fresh     Ignore the existing trials.json contents and start the merge
 *               from an empty list (used for the initial seed run — see docs/PIPELINES.md).
 *
 * Coverage note (see docs/DECISIONS.md, "Deferred / follow-up items" #1): this only
 * covers trials registered on ClinicalTrials.gov. An ANZCTR connector was scoped out
 * (scraping refuted/blocked) — Australian-only trials that are ANZCTR-only may be
 * under-represented until a formal ANZCTR data request is pursued.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const API_BASE = 'https://clinicaltrials.gov/api/v2/studies';
const OUT_FILE = new URL('../src/data/trials.json', import.meta.url);

// Keep only the fields we actually map, to keep responses small and fast.
const FIELDS = [
  'NCTId',
  'BriefTitle',
  'OverallStatus',
  'Phase',
  'Condition',
  'LocationFacility',
  'LocationCity',
  'LocationState',
  'LocationCountry',
  'BriefSummary',
  'LastUpdatePostDate',
].join(',');

const PAGE_SIZE = 100;
const MIN_INTERVAL_MS = 250; // be a polite anonymous client; CTG has no published hard cap
const MAX_RETRIES = 3;

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { dryRun: false, fresh: false };
  for (const arg of argv) {
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--fresh') args.fresh = true;
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/sync-trials.mjs [--dry-run] [--fresh]');
      process.exit(0);
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Networking: throttle + retry
// ---------------------------------------------------------------------------

let lastRequestAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function throttle() {
  const now = Date.now();
  const wait = lastRequestAt + MIN_INTERVAL_MS - now;
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

async function fetchWithRetry(url, options = {}, attempt = 1) {
  await throttle();
  let res;
  try {
    res = await fetch(url, options);
  } catch (err) {
    if (attempt >= MAX_RETRIES) throw err;
    await sleep(2 ** attempt * 1000);
    return fetchWithRetry(url, options, attempt + 1);
  }
  if (res.status === 429 || res.status >= 500) {
    if (attempt >= MAX_RETRIES) {
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

// ---------------------------------------------------------------------------
// Fetch all studies with a location near "Campbelltown" (server-side coarse
// filter), paging via pageToken.
// ---------------------------------------------------------------------------

async function fetchAllStudies() {
  const studies = [];
  let pageToken;
  do {
    const url = new URL(API_BASE);
    url.searchParams.set('query.locn', 'Campbelltown');
    url.searchParams.set('pageSize', String(PAGE_SIZE));
    url.searchParams.set('fields', FIELDS);
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetchWithRetry(url);
    const data = await res.json();
    studies.push(...(data.studies ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return studies;
}

// ---------------------------------------------------------------------------
// Post-filter: only genuine "Campbelltown Hospital" locations, not other
// Campbelltown-named businesses (e.g. "GenesisCare - Campbelltown",
// "Campbelltown Medical & Dental Centre").
// ---------------------------------------------------------------------------

function isCampbelltownHospitalFacility(facility) {
  if (!facility) return false;
  if (/campbelltown hospital/i.test(facility)) return true;
  // Real-world data-entry quirk: some registrations concatenate the name with
  // no space (e.g. "CampbelltownHospital") or extra punctuation/hyphens. This
  // still requires "hospital" to immediately follow "campbelltown" once
  // whitespace/hyphens are stripped, so it does not match business names like
  // "GenesisCare - Campbelltown" or "Campbelltown Medical & Dental Centre".
  const collapsed = facility.toLowerCase().replace(/[^a-z]/g, '');
  return collapsed.includes('campbelltownhospital');
}

function studyHasCampbelltownHospital(study) {
  const locations = study.protocolSection?.contactsLocationsModule?.locations ?? [];
  return locations.some((loc) => isCampbelltownHospitalFacility(loc.facility));
}

function truncate(str, maxLen) {
  if (!str) return '';
  const clean = str.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  const cut = clean.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(' ');
  const trimmed = lastSpace > maxLen * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${trimmed.trimEnd()}…`;
}

// ---------------------------------------------------------------------------
// Map to the trials.json contract
// ---------------------------------------------------------------------------

function mapStudy(study) {
  const identification = study.protocolSection?.identificationModule ?? {};
  const status = study.protocolSection?.statusModule ?? {};
  const design = study.protocolSection?.designModule ?? {};
  const conditionsModule = study.protocolSection?.conditionsModule ?? {};
  const description = study.protocolSection?.descriptionModule ?? {};

  const phases = design.phases ?? [];
  const phase = phases.length > 0 ? phases.join('/') : null;

  return {
    nctId: identification.nctId,
    title: identification.briefTitle ?? '',
    status: status.overallStatus ?? 'UNKNOWN',
    phase,
    conditions: conditionsModule.conditions ?? [],
    facility: 'Campbelltown Hospital',
    url: `https://clinicaltrials.gov/study/${identification.nctId}`,
    briefSummary: truncate(description.briefSummary ?? '', 600),
    // Transient — used only to order the merged output, stripped before write.
    _lastUpdate: status.lastUpdatePostDateStruct?.date ?? '',
  };
}

// ---------------------------------------------------------------------------
// Merge: upsert by nctId, never delete. Sort RECRUITING first, then by
// last-update date (most recent first).
// ---------------------------------------------------------------------------

function loadExisting(fresh) {
  if (fresh) return { items: [] };
  try {
    const raw = readFileSync(OUT_FILE, 'utf8');
    const data = JSON.parse(raw);
    return { items: Array.isArray(data.items) ? data.items : [] };
  } catch {
    return { items: [] };
  }
}

function sortTrials(items, lastUpdateByNctId) {
  const statusRank = (s) => (s === 'RECRUITING' ? 0 : 1);
  return [...items].sort((a, b) => {
    const rankDiff = statusRank(a.status) - statusRank(b.status);
    if (rankDiff !== 0) return rankDiff;
    const au = lastUpdateByNctId.get(a.nctId) ?? '';
    const bu = lastUpdateByNctId.get(b.nctId) ?? '';
    return bu.localeCompare(au);
  });
}

function mergeTrials(existingItems, fetchedItems) {
  const byId = new Map(existingItems.map((t) => [t.nctId, t]));
  const lastUpdateByNctId = new Map();
  let added = 0;
  let updated = 0;
  for (const trial of fetchedItems) {
    const { _lastUpdate, ...clean } = trial;
    lastUpdateByNctId.set(clean.nctId, _lastUpdate ?? '');
    if (byId.has(clean.nctId)) {
      updated += 1;
    } else {
      added += 1;
    }
    byId.set(clean.nctId, clean);
  }
  const merged = sortTrials([...byId.values()], lastUpdateByNctId);
  return { merged, added, updated };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log('Fetching studies with a location near "Campbelltown" from ClinicalTrials.gov...');
  const rawStudies = await fetchAllStudies();
  console.log(`ClinicalTrials.gov returned ${rawStudies.length} candidate studies.`);

  const matched = rawStudies.filter(studyHasCampbelltownHospital);
  console.log(`${matched.length} have a genuine "Campbelltown Hospital" location.`);

  const fetched = matched.map(mapStudy);

  const existing = loadExisting(args.fresh);
  const { merged, added, updated } = mergeTrials(existing.items, fetched);

  const byStatus = new Map();
  for (const t of merged) byStatus.set(t.status, (byStatus.get(t.status) ?? 0) + 1);

  console.log('--- Summary ---');
  console.log(`Fetched from ClinicalTrials.gov : ${fetched.length}`);
  console.log(`New                              : ${added}`);
  console.log(`Updated (refreshed)              : ${updated}`);
  console.log(`Total in file                    : ${merged.length}`);
  console.log('By status:');
  for (const [status, count] of [...byStatus.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${status.padEnd(24)} ${count}`);
  }

  if (args.dryRun) {
    console.log('Dry run: trials.json was not written.');
    return;
  }

  const output = {
    generated: new Date().toISOString(),
    source: 'clinicaltrials.gov',
    items: merged,
  };
  writeFileSync(OUT_FILE, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Wrote ${merged.length} trials to ${OUT_FILE.pathname}`);
}

main().catch((err) => {
  console.error('sync-trials failed:', err);
  process.exitCode = 1;
});
