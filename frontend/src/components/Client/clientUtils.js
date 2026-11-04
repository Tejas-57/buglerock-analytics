// Shared helpers for the client dashboard.

// PAN is a government ID: show the five letters and the check letter, hide the digits.
// ABCDE1234F -> ABCDE••••F. Anything that is not a well-formed PAN keeps only its first two and last characters.
export function maskPan(pan) {
  if (!pan) return '';
  const p = String(pan).trim().toUpperCase();
  if (/^[A-Z]{5}\d{4}[A-Z]$/.test(p)) return `${p.slice(0, 5)}••••${p.slice(9)}`;
  if (p.length <= 3) return '•'.repeat(p.length);
  return `${p.slice(0, 2)}${'•'.repeat(p.length - 3)}${p.slice(-1)}`;
}
