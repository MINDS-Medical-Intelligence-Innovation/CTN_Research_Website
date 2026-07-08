#!/usr/bin/env node
/**
 * scripts/harvest-pubmed.mjs
 *
 * Harvests publications affiliated with Campbelltown Hospital from PubMed via NCBI's
 * E-utilities (https://eutils.ncbi.nlm.nih.gov/entrez/eutils/) and upserts them into
 * src/data/publications.json.
 *
 * Zero npm dependencies — Node 22's global `fetch` only.
 *
 * Usage:
 *   node scripts/harvest-pubmed.mjs [--from YYYY-MM-DD] [--dry-run] [--fresh]
 *
 *   --from YYYY-MM-DD   Only search for publications with a publication date on or after
 *                       this date (default: 2020-01-01, see docs/DECISIONS.md D2).
 *   --dry-run           Fetch and print the summary, but do not write publications.json.
 *   --fresh             Ignore the existing publications.json contents and start the merge
 *                       from an empty list (used for the initial seed run — see docs/PIPELINES.md).
 *
 * Env vars:
 *   NCBI_API_KEY   Optional. An NCBI API key raises the request-rate ceiling from 3rps to
 *                  10rps (see https://www.ncbi.nlm.nih.gov/books/NBK25497/). Without it we
 *                  throttle conservatively under the anonymous 3rps limit.
 *
 * NCBI etiquette (https://www.ncbi.nlm.nih.gov/books/NBK25497/): every request identifies
 * itself with tool= and email= parameters, and requests are throttled and retried with
 * exponential backoff on 429/5xx responses.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const EUTILS_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const AFFILIATION_TERM = '"Campbelltown Hospital"[Affiliation]';
const TOOL_NAME = 'ctn-research-site';
// TODO(owner): replace with a real, monitored contact address before relying on the
// scheduled GitHub Actions harvest (.github/workflows/harvest.yml) — NCBI's usage
// policy requires a genuine contact email in case they need to reach us.
const CONTACT_EMAIL = 'REPLACE@example.com';

const DEFAULT_FROM_DATE = '2020-01-01';
const OUT_FILE = new URL('../src/data/publications.json', import.meta.url);

const API_KEY = process.env.NCBI_API_KEY || '';
// Anonymous cap is 3 req/s; with a key it's 10 req/s. Stay safely under either.
const MIN_INTERVAL_MS = API_KEY ? 120 : 350;
const ESEARCH_PAGE_SIZE = 500;
const EFETCH_BATCH_SIZE = 200;
const MAX_RETRIES = 3;

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { from: DEFAULT_FROM_DATE, dryRun: false, fresh: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--from') {
      args.from = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--from=')) {
      args.from = arg.slice('--from='.length);
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--fresh') {
      args.fresh = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.from)) {
    throw new Error(`--from must be YYYY-MM-DD, got "${args.from}"`);
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/harvest-pubmed.mjs [--from YYYY-MM-DD] [--dry-run] [--fresh]`);
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

function truncate(str, maxLen) {
  if (!str) return '';
  const clean = str.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  const cut = clean.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(' ');
  const trimmed = lastSpace > maxLen * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${trimmed.trimEnd()}…`;
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

function normaliseDeptName(raw) {
  const cleaned = raw.replace(/\s+/g, ' ').trim().replace(/^[,;.\s]+|[,;.\s]+$/g, '');
  if (!cleaned) return '';
  return cleaned
    .split(' ')
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

function isCampbelltownAffiliation(aff) {
  return /campbelltown/i.test(aff);
}

function deriveDepartments(rawAuthors) {
  const found = new Set();
  for (const author of rawAuthors) {
    for (const aff of author.affiliations) {
      if (!isCampbelltownAffiliation(aff)) continue;
      for (const pattern of DEPT_PATTERNS) {
        const m = aff.match(pattern);
        if (m && m[1]) {
          const name = normaliseDeptName(m[1]);
          if (name && name.length >= 3 && name.length <= 60 && !/^\d+$/.test(name)) {
            found.add(name);
          }
          break; // first matching pattern wins for this affiliation string
        }
      }
    }
  }
  return [...found].sort((a, b) => a.localeCompare(b));
}

// D5: badge "Campbelltown-led" when the first author, last author, or any
// author whose affiliation string flags them as corresponding has a
// Campbelltown affiliation.
function computeCampbelltownLed(rawAuthors) {
  if (rawAuthors.length === 0) return false;
  const isCampbelltownAuthor = (a) => a.affiliations.some(isCampbelltownAffiliation);
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
  const abstractBlock = matchFirst(articleXml, 'Abstract');
  let abstract = '';
  if (abstractBlock) {
    const parts = matchAllWithAttrs(abstractBlock, 'AbstractText');
    abstract = parts
      .map(({ attrs, content }) => {
        const label = getAttr(attrs, 'Label');
        const text = stripTags(content);
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
    campbelltown: a.affiliations.some(isCampbelltownAffiliation),
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
// Merge: upsert by pmid, never delete, sort by (year, month) desc
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

function mergePublications(existingItems, fetchedItems) {
  const byPmid = new Map(existingItems.map((p) => [p.pmid, p]));
  let added = 0;
  let updated = 0;
  for (const pub of fetchedItems) {
    if (byPmid.has(pub.pmid)) {
      updated += 1;
    } else {
      added += 1;
    }
    byPmid.set(pub.pmid, pub);
  }
  const merged = [...byPmid.values()].sort(
    (a, b) => (b.year ?? 0) - (a.year ?? 0) || (b.month ?? 0) - (a.month ?? 0),
  );
  return { merged, added, updated };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const toDate = new Date().toISOString().slice(0, 10);

  console.log(`Searching PubMed for "${AFFILIATION_TERM}" from ${args.from} to ${toDate}...`);
  if (!API_KEY) {
    console.log('No NCBI_API_KEY set — throttling to the anonymous 3 req/s limit.');
  }

  const pmids = await esearchAllPmids(AFFILIATION_TERM, args.from, toDate);
  console.log(`ESearch matched ${pmids.length} PMIDs.`);

  const batches = chunk(pmids, EFETCH_BATCH_SIZE);
  const fetched = [];
  for (let i = 0; i < batches.length; i += 1) {
    console.log(`EFetch batch ${i + 1}/${batches.length} (${batches[i].length} PMIDs)...`);
    const xml = await efetchBatch(batches[i]);
    const articleBlocks = matchAll(xml, 'PubmedArticle');
    for (const block of articleBlocks) {
      const pub = parsePublication(block);
      if (pub) fetched.push(pub);
    }
  }

  const existing = loadExisting(args.fresh);
  const { merged, added, updated } = mergePublications(existing.items, fetched);

  console.log('--- Summary ---');
  console.log(`Fetched from PubMed : ${fetched.length}`);
  console.log(`New                 : ${added}`);
  console.log(`Updated (refreshed) : ${updated}`);
  console.log(`Total in file       : ${merged.length}`);
  const ledCount = merged.filter((p) => p.campbelltownLed).length;
  console.log(`Campbelltown-led    : ${ledCount}`);

  if (args.dryRun) {
    console.log('Dry run: publications.json was not written.');
    return;
  }

  const output = {
    generated: new Date().toISOString(),
    source: 'pubmed',
    items: merged,
  };
  writeFileSync(OUT_FILE, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Wrote ${merged.length} publications to ${OUT_FILE.pathname}`);
}

main().catch((err) => {
  console.error('harvest-pubmed failed:', err);
  process.exitCode = 1;
});
