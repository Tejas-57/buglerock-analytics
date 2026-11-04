// Shared helpers for the client dashboard.

const DAY_MS = 86400000;
const REVIEW_WARN_DAYS = 30;

// DB dates arrive as 'YYYY-MM-DD'; parse as a local date so the day does not shift.
export function parseDate(s) {
  if (!s) return null;
  const d = new Date(`${String(s).slice(0, 10)}T00:00:00`);
  return isNaN(d.getTime()) ? null : d;
}

export function fmtDate(s) {
  const d = parseDate(s);
  return d ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
}

// Whole days from today to the date (negative once it has passed).
export function daysFromToday(s, today = new Date()) {
  const d = parseDate(s);
  if (!d) return null;
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((d - t) / DAY_MS);
}

// The stored suitability_status never changes by itself. Work out what it should be today from
// valid_until and next_review_date. Returns { status, level, message } where level is
// 'info' | 'warn' | 'danger' | null (null = nothing to flag).
export function effectiveSuitability(c, today = new Date()) {
  const stored = c.suitability_status || 'draft';
  if (stored === 'draft') {
    return { status: 'draft', level: 'info', message: 'Draft profile. Complete the risk assessment to unlock a suitable recommendation.' };
  }
  if (stored === 'indicative') {
    return { status: 'indicative', level: 'info', message: 'Indicative profile. Good for preparing a proposal, but it cannot be finalised as a suitable recommendation.' };
  }

  const untilDays = daysFromToday(c.valid_until, today);
  const reviewDays = daysFromToday(c.next_review_date, today);

  if (untilDays !== null && untilDays < 0) {
    return { status: 'expired', level: 'danger', message: `Risk assessment expired on ${fmtDate(c.valid_until)} (${-untilDays} days ago). Reassess before any new recommendation.` };
  }
  if (reviewDays !== null && reviewDays < 0) {
    return { status: 'review_due', level: 'danger', message: `Review overdue by ${-reviewDays} days (was due ${fmtDate(c.next_review_date)}).` };
  }
  if (untilDays !== null && untilDays <= REVIEW_WARN_DAYS) {
    return { status: 'review_due', level: 'warn', message: `Risk assessment is valid until ${fmtDate(c.valid_until)} (${untilDays} days left).` };
  }
  if (reviewDays !== null && reviewDays <= REVIEW_WARN_DAYS) {
    return { status: 'review_due', level: 'warn', message: `Review due ${reviewDays === 0 ? 'today' : `in ${reviewDays} days`} (${fmtDate(c.next_review_date)}).` };
  }
  return { status: stored, level: null, message: '' };
}

// Values stored by the profile form (CIPStep1 HORIZON_OPTIONS) -> display text and the length in
// years used for illustrative projections (upper end of each band; 10 for "7+").
export const HORIZON_META = {
  short:    { label: 'Short-term (1–3 yrs)',     years: 3 },
  medium:   { label: 'Medium-term (3–5 yrs)',    years: 5 },
  long:     { label: 'Long-term (5–7 yrs)',      years: 7 },
  veryLong: { label: 'Very long-term (7+ yrs)',  years: 10 },
};

// PAN is a government ID: show the five letters and the check letter, hide the digits.
// ABCDE1234F -> ABCDE••••F. Anything that is not a well-formed PAN keeps only its first two and last characters.
export function maskPan(pan) {
  if (!pan) return '';
  const p = String(pan).trim().toUpperCase();
  if (/^[A-Z]{5}\d{4}[A-Z]$/.test(p)) return `${p.slice(0, 5)}••••${p.slice(9)}`;
  if (p.length <= 3) return '•'.repeat(p.length);
  return `${p.slice(0, 2)}${'•'.repeat(p.length - 3)}${p.slice(-1)}`;
}
