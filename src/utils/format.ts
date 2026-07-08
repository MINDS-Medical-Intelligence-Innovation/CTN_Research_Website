const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function formatDate(date: Date): string {
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

export function formatMonthYear(month?: number, year?: number): string {
  if (!year) return '';
  if (!month || month < 1 || month > 12) return String(year);
  return `${MONTHS[month - 1]} ${year}`;
}

// Explicit labels for every status value observed in trials.json (RECRUITING,
// ACTIVE_NOT_RECRUITING, ENROLLING_BY_INVITATION, COMPLETED, UNKNOWN,
// TERMINATED) plus a couple of other ClinicalTrials.gov OverallStatus values
// that could plausibly show up in a future sync (WITHDRAWN, NOT_YET_RECRUITING,
// SUSPENDED). Falls through to the generic split/title-case for anything else
// so an unrecognised status still renders as a readable label rather than
// disappearing.
const STATUS_LABELS: Record<string, string> = {
  RECRUITING: 'Recruiting',
  ACTIVE_NOT_RECRUITING: 'Active, not recruiting',
  ENROLLING_BY_INVITATION: 'Enrolling by invitation',
  NOT_YET_RECRUITING: 'Not yet recruiting',
  COMPLETED: 'Completed',
  TERMINATED: 'Terminated',
  WITHDRAWN: 'Withdrawn',
  SUSPENDED: 'Suspended',
  UNKNOWN: 'Status unknown',
};

/** Recruitment/trial status -> a short, human label. */
export function statusLabel(status: string): string {
  if (STATUS_LABELS[status]) return STATUS_LABELS[status];
  return status
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Trial phase code (e.g. "PHASE3", "NA") -> display label. */
function singlePhaseLabel(phase: string): string {
  const map: Record<string, string> = {
    NA: 'Not applicable',
    EARLY_PHASE1: 'Early Phase 1',
    PHASE1: 'Phase 1',
    PHASE2: 'Phase 2',
    PHASE3: 'Phase 3',
    PHASE4: 'Phase 4',
  };
  return map[phase] ?? phase.replace('PHASE', 'Phase ');
}

/**
 * Trial phase code -> display label. Handles composite values joined with
 * "/" (e.g. real ClinicalTrials.gov data includes "PHASE1/PHASE2" and
 * "PHASE2/PHASE3") by mapping each token through the same lookup and
 * rejoining with " / " — e.g. "PHASE1/PHASE2" -> "Phase 1 / Phase 2".
 */
export function phaseLabel(phase?: string): string {
  if (!phase) return 'Not applicable';
  if (phase.includes('/')) {
    return phase.split('/').map((token) => singlePhaseLabel(token.trim())).join(' / ');
  }
  return singlePhaseLabel(phase);
}

/** Project "type" enum value -> display label. */
export function projectTypeLabel(type: string): string {
  const map: Record<string, string> = {
    audit: 'Audit',
    qi: 'Quality improvement',
    'case-report': 'Case report',
    retrospective: 'Retrospective study',
    prospective: 'Prospective study',
    'systematic-review': 'Systematic review',
    other: 'Other',
  };
  return map[type] ?? type;
}
