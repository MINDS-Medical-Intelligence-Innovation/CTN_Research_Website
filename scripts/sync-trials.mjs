#!/usr/bin/env node
/**
 * scripts/sync-trials.mjs
 *
 * Syncs clinical trials with a Campbelltown Hospital location from the
 * ClinicalTrials.gov v2 API (https://clinicaltrials.gov/api/v2/studies) and
 * upserts them into src/data/trials.json.
 *
 * Zero npm dependencies — Node 22's global `fetch` only (shares scripts/lib.mjs with
 * scripts/harvest-pubmed.mjs for throttle/retry, file I/O and the Campbelltown matcher).
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

import { parseArgs } from 'node:util';
import {
  createThrottledFetch,
  truncate,
  loadExistingItems,
  upsertByKey,
  defaultMerge,
  writeDataFile,
  isCampbelltownHospital,
  HOSPITAL_NAME,
} from './lib.mjs';

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

const fetchWithRetry = createThrottledFetch({ minIntervalMs: MIN_INTERVAL_MS, maxRetries: MAX_RETRIES });

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseCliArgs(argv) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        'dry-run': { type: 'boolean', default: false },
        fresh: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
      allowPositionals: false,
    }));
  } catch (err) {
    console.error(err.message);
    printHelp();
    process.exit(1);
  }
  if (values.help) {
    printHelp();
    process.exit(0);
  }
  return { dryRun: values['dry-run'], fresh: values.fresh };
}

function printHelp() {
  console.log('Usage: node scripts/sync-trials.mjs [--dry-run] [--fresh]');
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
// "Campbelltown Medical & Dental Centre"). Uses the same canonical matcher as
// harvest-pubmed.mjs (see scripts/lib.mjs isCampbelltownHospital) so both
// pipelines agree on what counts as "Campbelltown Hospital".
// ---------------------------------------------------------------------------

function studyHasCampbelltownHospital(study) {
  const locations = study.protocolSection?.contactsLocationsModule?.locations ?? [];
  return locations.some((loc) => isCampbelltownHospital(loc.facility));
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
    facility: HOSPITAL_NAME,
    url: `https://clinicaltrials.gov/study/${identification.nctId}`,
    briefSummary: truncate(description.briefSummary ?? '', 600),
    // B6: persisted (not transient) — the real field trials are sorted on,
    // so a trial retained from a previous run but absent from the current
    // fetch keeps its last known update date instead of losing recency.
    lastUpdate: status.lastUpdatePostDateStruct?.date ?? '',
  };
}

// ---------------------------------------------------------------------------
// Sort: RECRUITING first, then by the persisted lastUpdate date (most recent
// first). No side-Map — sorts directly on the field stored on each record.
// ---------------------------------------------------------------------------

function sortTrials(items) {
  const statusRank = (s) => (s === 'RECRUITING' ? 0 : 1);
  return [...items].sort((a, b) => {
    const rankDiff = statusRank(a.status) - statusRank(b.status);
    if (rankDiff !== 0) return rankDiff;
    return (b.lastUpdate ?? '').localeCompare(a.lastUpdate ?? '');
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseCliArgs(process.argv.slice(2));

  console.log('Fetching studies with a location near "Campbelltown" from ClinicalTrials.gov...');
  const rawStudies = await fetchAllStudies();
  console.log(`ClinicalTrials.gov returned ${rawStudies.length} candidate studies.`);

  const matched = rawStudies.filter(studyHasCampbelltownHospital);
  console.log(`${matched.length} have a genuine "Campbelltown Hospital" location.`);

  const fetched = matched.map(mapStudy);

  const existing = loadExistingItems(OUT_FILE, { fresh: args.fresh });
  const { items, added, updated } = upsertByKey(existing.items, fetched, (t) => t.nctId, defaultMerge);
  const merged = sortTrials(items);

  const byStatus = new Map();
  for (const t of merged) byStatus.set(t.status, (byStatus.get(t.status) ?? 0) + 1);

  console.log('--- Summary ---');
  console.log(`Fetched from ClinicalTrials.gov : ${fetched.length}`);
  console.log(`New                              : ${added}`);
  console.log(`Updated (changed)                : ${updated}`);
  console.log(`Total in file                    : ${merged.length}`);
  console.log('By status:');
  for (const [status, count] of [...byStatus.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${status.padEnd(24)} ${count}`);
  }

  if (args.dryRun) {
    console.log('Dry run: trials.json was not written.');
    return;
  }

  writeDataFile(OUT_FILE, 'clinicaltrials.gov', merged);
}

main().catch((err) => {
  console.error('sync-trials failed:', err);
  process.exitCode = 1;
});
