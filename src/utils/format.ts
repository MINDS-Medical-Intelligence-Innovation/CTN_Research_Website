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

/** Recruitment/trial status -> a short, human label. */
export function statusLabel(status: string): string {
  return status
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Trial phase code (e.g. "PHASE3", "NA") -> display label. */
export function phaseLabel(phase?: string): string {
  if (!phase) return 'Not applicable';
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
