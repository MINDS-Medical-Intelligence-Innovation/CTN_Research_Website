#!/usr/bin/env node
/**
 * scripts/harvest-pubmed.mjs
 *
 * Harvests publications affiliated with Campbelltown Hospital from PubMed via NCBI's
 * E-utilities (https://eutils.ncbi.nlm.nih.gov/entrez/eutils/) and upserts them into
 * src/data/publications.json.
 *
 * Zero npm dependencies — Node 22's global `fetch` only (shares scripts/lib.mjs with
 * scripts/sync-trials.mjs for throttle/retry, file I/O and the Campbelltown matcher).
 *
 * Usage:
 *   node scripts/harvest-pubmed.mjs [--from YYYY-MM-DD] [--dry-run] [--fresh]
 *
 *   --from YYYY-MM-DD   Only search for publications with a publication date on or after
 *                       this date. Default: derived incrementally from the newest date
 *                       already in publications.json, minus a 90-day safety overlap (falls
 *                       back to 2020-01-01 — see docs/DECISIONS.md D2 — when there is no
 *                       existing data, e.g. --fresh or a first run).
 *   --dry-run           Fetch and print the summary, but do not write publications.json.
 *   --fresh             Ignore the existing publications.json contents and start the merge
 *                       from an empty list (used for the initial seed run — see docs/PIPELINES.md).
 *
 * Env vars:
 *   NCBI_API_KEY        Optional. An NCBI API key raises the request-rate ceiling from 3rps
 *                       to 10rps (see https://www.ncbi.nlm.nih.gov/books/NBK25497/). Without
 *                       it we throttle conservatively under the anonymous 3rps limit.
 *   NCBI_CONTACT_EMAIL  A real, monitored contact address. NCBI's usage policy requires every
 *                       request to identify a genuine contact in case they need to reach us —
 *                       see the startup warning below if this is unset.
 *
 * NCBI etiquette (https://www.ncbi.nlm.nih.gov/books/NBK25497/): every request identifies
 * itself with tool= and email= parameters, and requests are throttled and retried with
 * exponential backoff on 429/5xx responses.
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
  applyDeptAlias,
  PUBMED_AFFILIATION_TERM,
} from './lib.mjs';

const EUTILS_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const AFFILIATION_TERM = PUBMED_AFFILIATION_TERM;
const TOOL_NAME = 'ctn-research-site';
const PLACEHOLDER_CONTACT_EMAIL = 'REPLACE@example.com';
const CONTACT_EMAIL = process.env.NCBI_CONTACT_EMAIL || PLACEHOLDER_CONTACT_EMAIL;

const DEFAULT_FROM_DATE = '2020-01-01';
const INCREMENTAL_OVERLAP_DAYS = 90;
const OUT_FILE = new URL('../src/data/publications.json', import.meta.url);

const API_KEY = process.env.NCBI_API_KEY || '';
// Anonymous cap is 3 req/s; with a key it's 10 req/s. Stay safely under either.
const MIN_INTERVAL_MS = API_KEY ? 120 : 350;
const ESEARCH_PAGE_SIZE = 500;
const EFETCH_BATCH_SIZE = 200;
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
        from: { type: 'string' },
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
  if (values.from !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(values.from)) {
    throw new Error(`--from must be YYYY-MM-DD, got "${values.from}"`);
  }
  return { from: values.from, dryRun: values['dry-run'], fresh: values.fresh };
}

function printHelp() {
  console.log('Usage: node scripts/harvest-pubmed.mjs [--from YYYY-MM-DD] [--dry-run] [--fresh]');
}

// ---------------------------------------------------------------------------
// Incremental default --from: derive from the newest (year, month) already
// stored, minus a safety overlap, so the weekly cron doesn't re-fetch the
// entire 2020-01-01-to-date window every run.
// ---------------------------------------------------------------------------

function deriveIncrementalFromDate(existingItems) {
  let latestYear = null;
  let latestMonth = null;
  for (const item of existingItems) {
    if (!item.year) continue;
    // Unknown month is treated as January (the most conservative choice —
    // it widens the recomputed window rather than narrowing it).
    const month = item.month && item.month >= 1 && item.month <= 12 ? item.month : 1;
    if (latestYear === null || item.year > latestYear || (item.year === latestYear && month > latestMonth)) {
      latestYear = item.year;
      latestMonth = month;
    }
  }
  if (latestYear === null) return null;
  const latestDate = new Date(Date.UTC(latestYear, latestMonth - 1, 1));
  latestDate.setUTCDate(latestDate.getUTCDate() - INCREMENTAL_OVERLAP_DAYS);
  return {
    from: latestDate.toISOString().slice(0, 10),
    latestLabel: `${latestYear}-${String(latestMonth).padStart(2, '0')}`,
  };
}

// ---------------------------------------------------------------------------
// Networking helpers built on the shared throttled fetch
// ---------------------------------------------------------------------------

function buildEutilsUrl(endpoint, params) {
  const url = new URL(`${EUTILS_BASE}/${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  }
  url.searchParams.set('tool', TOOL_NAME);
  url.searchParams.set('email', CONTACT_EMAIL);
  if (API_KEY) url.searchParams.set('api_key', API_KEY);
  return url;
}

// ---------------------------------------------------------------------------
// ESearch: page through all matching PMIDs using the NCBI history server
// ---------------------------------------------------------------------------

async function esearchAllPmids(term, fromDate, toDate) {
  const ids = [];
  let webenv;
  let queryKey;
  let count = Infinity;
  let retstart = 0;

  while (retstart < count) {
    const params = {
      db: 'pubmed',
      retmode: 'json',
      retstart,
      retmax: ESEARCH_PAGE_SIZE,
      usehistory: 'y',
      sort: 'pub date',
    };
    if (webenv && queryKey) {
      params.WebEnv = webenv;
      params.query_key = queryKey;
    } else {
      // Only needed (and only valid) on the first request.
      params.term = term;
      params.datetype = 'pdat';
      params.mindate = fromDate.replaceAll('-', '/');
      params.maxdate = toDate.replaceAll('-', '/');
    }
    const url = buildEutilsUrl('esearch.fcgi', params);
    const res = await fetchWithRetry(url);
    const data = await res.json();
    const result = data.esearchresult;
    if (!result) throw new Error(`Unexpected ESearch response: ${JSON.stringify(data)}`);

    count = Number(result.count) || 0;
    webenv = result.webenv ?? webenv;
    queryKey = result.querykey ?? queryKey;
    const page = result.idlist ?? [];
    ids.push(...page);
    retstart += ESEARCH_PAGE_SIZE;
    if (page.length === 0) break; // safety valve against infinite loop
  }

  return ids;
}

// ---------------------------------------------------------------------------
// EFetch: fetch full records in batches of <=200 PMIDs
// ---------------------------------------------------------------------------

async function efetchBatch(pmids) {
  const url = new URL(`${EUTILS_BASE}/efetch.fcgi`);
  const body = new URLSearchParams({
    db: 'pubmed',
    id: pmids.join(','),
    rettype: 'xml',
    retmode: 'xml',
    tool: TOOL_NAME,
    email: CONTACT_EMAIL,
  });
  if (API_KEY) body.set('api_key', API_KEY);
  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  return res.text();
}

async function efetchBatchArticles(pmids) {
  const xml = await efetchBatch(pmids);
  return matchAll(xml, 'PubmedArticle');
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ---------------------------------------------------------------------------
// Tiny hand-rolled XML helpers (no npm deps). PubMed's XML is regular enough
// that regex-based tag extraction is reliable as long as we split into
// per-article blocks first and never try to match a tag name that recurs at
// multiple nesting depths within the same block.
// ---------------------------------------------------------------------------

function decodeEntities(str) {
  if (!str) return str;
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, '&');
}

function stripTags(str) {
  if (!str) return '';
  return decodeEntities(str.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function matchFirst(xml, tag) {
  if (!xml) return null;
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = xml.match(re);
  return m ? m[1] : null;
}

function matchAll(xml, tag) {
  if (!xml) return [];
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}

function matchAllWithAttrs(xml, tag) {
  if (!xml) return [];
  const re = new RegExp(`<${tag}((?:\\s[^>]*)?)>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(xml))) out.push({ attrs: m[1] ?? '', content: m[2] });
  return out;
}

function getAttr(attrStr, name) {
  if (!attrStr) return null;
  const m = attrStr.match(new RegExp(`${name}="([^"]*)"`, 'i'));
  return m ? decodeEntities(m[1]) : null;
}

const MONTH_LOOKUP = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function monthToNumber(raw) {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    return n >= 1 && n <= 12 ? n : null;
  }
  return MONTH_LOOKUP[s.slice(0, 3)] ?? null;
}

function parseMedlineDate(raw) {
  if (!raw) return { year: null, month: null };
  const yearMatch = raw.match(/(\d{4})/);
  const monthMatch = raw.match(/[A-Za-z]{3,}/);
  return {
    year: yearMatch ? parseInt(yearMatch[1], 10) : null,
    month: monthMatch ? monthToNumber(monthMatch[0]) : null,
  };
}

// ---------------------------------------------------------------------------
// Derivations: campbelltown flag, campbelltownLed (D5), departments
// ---------------------------------------------------------------------------

// "Department of X, ... Campbelltown" and common variants. The stop-class
// `(?:(?!Campbelltown)[^,;.])+` grabs everything up to (but not including)
// the literal word "Campbelltown" or the next comma/semicolon/period,
// whichever comes first — this covers both comma-separated affiliations
// ("Department of Emergency Medicine, Campbelltown Hospital, NSW") and
// run-on ones ("Dept of Medicine Immunology & Allergy Campbelltown Hospital").
const STOP_CLASS = '(?:(?!Campbelltown)[^,;.])+';
const DEPT_PATTERNS = [
  new RegExp(`Department of (${STOP_CLASS})`, 'i'),
  new RegExp(`Dept\\.? of (${STOP_CLASS})`, 'i'),
  new RegExp(`Division of (${STOP_CLASS})`, 'i'),
  new RegExp(`Unit of (${STOP_CLASS})`, 'i'),
  // Fallback: capture a title-cased phrase immediately preceding a common
  // unit/ward/service noun, e.g. "General Medical Ward, Campbelltown Hospital".
  /([A-Z][\w&'\-/ ]{2,60}?(?:Unit|Ward|Service|Clinic|Program|Institute|Centre|Center))(?=\s*[,;.]|\s+Campbelltown|$)/,
];

// Small words stay lowercase in title case (except as the first word); a
// short acronym allowlist stays fully uppercase regardless of position.
const SMALL_WORDS = new Set(['of', 'and', 'the', 'for', 'in']);
const PRESERVE_ACRONYMS = new Set(['ICU', 'ED', 'GP', 'ENT']);

// B4b: real title-case — lowercase the rest of each word (not just skip it),
// so "EMERGENCY MEDICINE" -> "Emergency Medicine" instead of staying
// uppercase after the first letter. Operates per contiguous letter-run
// (rather than per whitespace-split word) so punctuation-joined compounds
// like "Immunology/Allergy" or "Diabetes & Endocrinology" title-case each
// side correctly, and so "MacArthur"/"MACARTHUR"/"macarthur" all collapse to
// the single correct "Macarthur" spelling (one unbroken letter-run titled
// the same way regardless of input casing).
function normaliseDeptName(raw) {
  const cleaned = raw.replace(/\s+/g, ' ').trim().replace(/^[,;.\s]+|[,;.\s]+$/g, '');
  if (!cleaned) return '';
  let isFirstWord = true;
  return cleaned.replace(/[A-Za-z]+(?:['-][A-Za-z]+)*/g, (word) => {
    const isFirst = isFirstWord;
    isFirstWord = false;
    const upper = word.toUpperCase();
    if (PRESERVE_ACRONYMS.has(upper)) return upper;
    const lower = word.toLowerCase();
    if (!isFirst && SMALL_WORDS.has(lower)) return lower;
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  });
}

// B4a: split a raw <Affiliation> string into segments so a department phrase
// found near a DIFFERENT institution (e.g. "Department of Cardiology,
// Liverpool Hospital; Department of Medicine, Campbelltown Hospital") can't
// bleed into the Campbelltown department list. NLM affiliation strings that
// concatenate more than one institution typically join them with "; ", so
// splitting on semicolons and only searching segments that actually mention
// Campbelltown Hospital (via the canonical isCampbelltownHospital matcher,
// not the loose bare-word check) anchors extraction to the right segment.
function splitAffiliationSegments(aff) {
  const segments = aff.split(';').map((s) => s.trim()).filter(Boolean);
  return segments.length > 0 ? segments : [aff];
}

function deriveDepartments(rawAuthors) {
  const found = new Set();
  for (const author of rawAuthors) {
    for (const aff of author.affiliations) {
      for (const segment of splitAffiliationSegments(aff)) {
        if (!isCampbelltownHospital(segment)) continue;
        for (const pattern of DEPT_PATTERNS) {
          const m = segment.match(pattern);
          if (m && m[1]) {
            const name = applyDeptAlias(normaliseDeptName(m[1]));
            if (name && name.length >= 3 && name.length <= 60 && !/^\d+$/.test(name)) {
              found.add(name);
            }
            break; // first matching pattern wins for this segment
          }
        }
      }
    }
  }
  return [...found].sort((a, b) => a.localeCompare(b));
}

// D5: badge "Campbelltown-led" when the first author, last author, or any
// author whose affiliation string flags them as corresponding has a
// Campbelltown Hospital affiliation.
function computeCampbelltownLed(rawAuthors) {
  if (rawAuthors.length === 0) return false;
  const isCampbelltownAuthor = (a) => a.affiliations.some(isCampbelltownHospital);
  const first = rawAuthors[0];
  const last = rawAuthors[rawAuthors.length - 1];
  if (isCampbelltownAuthor(first) || isCampbelltownAuthor(last)) return true;
  return rawAuthors.some(
    (a) => isCampbelltownAuthor(a) && a.affiliations.some((aff) => /corresponding/i.test(aff)),
  );
}

// ---------------------------------------------------------------------------
// Parse a single <PubmedArticle>...</PubmedArticle> block into our contract
// ---------------------------------------------------------------------------

function parsePublication(articleXml) {
  const pmidRaw = matchFirst(articleXml, 'PMID');
  const pmid = pmidRaw ? stripTags(pmidRaw) : '';
  if (!pmid) return null;

  const title = stripTags(matchFirst(articleXml, 'ArticleTitle') ?? '');
  if (!title) return null;

  const journalBlock = matchFirst(articleXml, 'Journal') ?? '';
  const journal = stripTags(matchFirst(journalBlock, 'Title') ?? '') || null;
  const journalAbbrev = stripTags(matchFirst(journalBlock, 'ISOAbbreviation') ?? '') || null;

  let year = null;
  let month = null;
  const pubDateBlock = matchFirst(journalBlock, 'PubDate');
  if (pubDateBlock) {
    const y = matchFirst(pubDateBlock, 'Year');
    const m = matchFirst(pubDateBlock, 'Month');
    if (y) year = parseInt(stripTags(y), 10);
    if (m) month = monthToNumber(stripTags(m));
    if (!year) {
      const medline = matchFirst(pubDateBlock, 'MedlineDate');
      if (medline) {
        const parsed = parseMedlineDate(stripTags(medline));
        year = parsed.year;
        month = month ?? parsed.month;
      }
    }
  }
  if (!year) {
    const articleDateBlock = matchFirst(articleXml, 'ArticleDate');
    if (articleDateBlock) {
      const y = matchFirst(articleDateBlock, 'Year');
      const m = matchFirst(articleDateBlock, 'Month');
      if (y) year = parseInt(stripTags(y), 10);
      if (m) month = month ?? monthToNumber(stripTags(m));
    }
  }

  // DOI: prefer PubmedData/ArticleIdList (canonical), fall back to ELocationID.
  let doi = null;
  const articleIds = matchAllWithAttrs(articleXml, 'ArticleId');
  const doiId = articleIds.find((a) => (getAttr(a.attrs, 'IdType') || '').toLowerCase() === 'doi');
  if (doiId) doi = stripTags(doiId.content) || null;
  if (!doi) {
    const elocs = matchAllWithAttrs(articleXml, 'ELocationID');
    const doiEloc = elocs.find((a) => (getAttr(a.attrs, 'EIdType') || '').toLowerCase() === 'doi');
    if (doiEloc) doi = stripTags(doiEloc.content) || null;
  }

  // Abstract: concatenate structured sections, label-prefixed if labelled.
  // B1: only compose "Label: text" when text is non-empty — a Label with no
  // text must not survive as a dangling "LABEL: " fragment.
  const abstractBlock = matchFirst(articleXml, 'Abstract');
  let abstract = '';
  if (abstractBlock) {
    const parts = matchAllWithAttrs(abstractBlock, 'AbstractText');
    abstract = parts
      .map(({ attrs, content }) => {
        const text = stripTags(content);
        if (!text) return '';
        const label = getAttr(attrs, 'Label');
        return label ? `${label}: ${text}` : text;
      })
      .filter(Boolean)
      .join(' ');
  }
  abstract = truncate(abstract, 1200);

  const keywords = [...new Set(matchAll(articleXml, 'Keyword').map(stripTags).filter(Boolean))];

  const authorListBlock = matchFirst(articleXml, 'AuthorList') ?? '';
  const authorBlocks = matchAllWithAttrs(authorListBlock, 'Author').map((a) => a.content);
  const rawAuthors = authorBlocks
    .map((block) => {
      const lastName = stripTags(matchFirst(block, 'LastName') ?? '');
      const initials = stripTags(matchFirst(block, 'Initials') ?? '');
      const collective = stripTags(matchFirst(block, 'CollectiveName') ?? '');
      const name = collective || [lastName, initials].filter(Boolean).join(' ');
      const affiliations = matchAll(block, 'Affiliation').map(stripTags).filter(Boolean);
      return { name, affiliations };
    })
    .filter((a) => a.name);

  const authors = rawAuthors.map((a) => ({
    name: a.name,
    campbelltown: a.affiliations.some(isCampbelltownHospital),
  }));

  return {
    pmid,
    doi,
    title,
    journal,
    journalAbbrev,
    year,
    month,
    authors,
    campbelltownLed: computeCampbelltownLed(rawAuthors),
    departments: deriveDepartments(rawAuthors),
    keywords,
    abstract,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const toDate = new Date().toISOString().slice(0, 10);

  if (CONTACT_EMAIL === PLACEHOLDER_CONTACT_EMAIL) {
    console.warn('!'.repeat(78));
    console.warn('WARNING: NCBI_CONTACT_EMAIL is not set — requests are identifying as');
    console.warn(`"${PLACEHOLDER_CONTACT_EMAIL}". NCBI's usage policy requires a real, monitored`);
    console.warn('contact address. Set the NCBI_CONTACT_EMAIL environment variable (repo');
    console.warn('variable "NCBI_CONTACT_EMAIL" in .github/workflows/harvest.yml) before relying');
    console.warn('on the scheduled harvest.');
    console.warn('!'.repeat(78));
  }

  const existing = loadExistingItems(OUT_FILE, { fresh: args.fresh });

  let fromDate = args.from;
  if (fromDate) {
    console.log(`Using explicit --from ${fromDate}.`);
  } else if (args.fresh) {
    // B3 scope: incremental derivation only applies when NOT --fresh — a
    // fresh run has (by definition) nothing stored to derive a window from.
    fromDate = DEFAULT_FROM_DATE;
    console.log(`--fresh set with no --from — using default window start ${fromDate}.`);
  } else {
    const derived = deriveIncrementalFromDate(existing.items);
    if (derived) {
      fromDate = derived.from;
      console.log(
        `No --from given — deriving incremental window from existing data (latest stored ` +
          `publication date ~${derived.latestLabel}, minus ${INCREMENTAL_OVERLAP_DAYS}-day overlap): --from ${fromDate}.`,
      );
    } else {
      fromDate = DEFAULT_FROM_DATE;
      console.log(`No --from given and no existing data found — using default window start ${fromDate}.`);
    }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) {
    throw new Error(`Derived --from is not YYYY-MM-DD: "${fromDate}"`);
  }

  console.log(`Searching PubMed for ${AFFILIATION_TERM} from ${fromDate} to ${toDate}...`);
  if (!API_KEY) {
    console.log('No NCBI_API_KEY set — throttling to the anonymous 3 req/s limit.');
  }

  const pmids = await esearchAllPmids(AFFILIATION_TERM, fromDate, toDate);
  console.log(`ESearch matched ${pmids.length} PMIDs.`);

  const batches = chunk(pmids, EFETCH_BATCH_SIZE);
  const fetched = [];
  const shortfalls = [];
  for (let i = 0; i < batches.length; i += 1) {
    console.log(`EFetch batch ${i + 1}/${batches.length} (${batches[i].length} PMIDs)...`);
    let articleBlocks = await efetchBatchArticles(batches[i]);
    // B2: EFetch occasionally returns fewer <PubmedArticle> records than PMIDs
    // requested (transient upstream issue). Retry the batch once; if still
    // short, warn loudly and carry on rather than failing the whole run.
    if (articleBlocks.length !== batches[i].length) {
      console.warn(
        `WARNING: batch ${i + 1} returned ${articleBlocks.length}/${batches[i].length} ` +
          'articles — retrying this batch once...',
      );
      articleBlocks = await efetchBatchArticles(batches[i]);
      if (articleBlocks.length !== batches[i].length) {
        const shortfall = batches[i].length - articleBlocks.length;
        console.warn(
          `WARNING: batch ${i + 1} still short by ${shortfall} article(s) after retry ` +
            `(requested ${batches[i].length}, got ${articleBlocks.length}). Continuing.`,
        );
        shortfalls.push({ batch: i + 1, requested: batches[i].length, got: articleBlocks.length, shortfall });
      }
    }
    for (const block of articleBlocks) {
      const pub = parsePublication(block);
      if (pub) fetched.push(pub);
    }
  }

  const { items: merged, added, updated } = upsertByKey(
    existing.items,
    fetched,
    (p) => p.pmid,
    defaultMerge,
  );
  merged.sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || (b.month ?? 0) - (a.month ?? 0));

  console.log('--- Summary ---');
  console.log(`Fetched from PubMed : ${fetched.length}`);
  console.log(`New                 : ${added}`);
  console.log(`Updated (changed)   : ${updated}`);
  console.log(`Total in file       : ${merged.length}`);
  const ledCount = merged.filter((p) => p.campbelltownLed).length;
  console.log(`Campbelltown-led    : ${ledCount}`);
  const deptCount = new Set(merged.flatMap((p) => p.departments ?? [])).size;
  console.log(`Unique departments  : ${deptCount}`);
  const noDeptCount = merged.filter((p) => (p.departments ?? []).length === 0).length;
  console.log(`No department parsed: ${noDeptCount}`);
  if (shortfalls.length > 0) {
    console.log(`--- EFetch shortfalls (${shortfalls.length} batch(es) — see WARNINGs above) ---`);
    for (const s of shortfalls) {
      console.log(`  Batch ${s.batch}: requested ${s.requested}, got ${s.got} (short by ${s.shortfall})`);
    }
  }

  if (args.dryRun) {
    console.log('Dry run: publications.json was not written.');
    return;
  }

  writeDataFile(OUT_FILE, 'pubmed', merged);
}

main().catch((err) => {
  console.error('harvest-pubmed failed:', err);
  process.exitCode = 1;
});
