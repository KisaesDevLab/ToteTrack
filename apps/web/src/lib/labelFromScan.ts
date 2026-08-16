import { normalizeLabelId } from '@totetrack/shared';

/** Pull a label out of whatever the QR contained: our deep link (…/b/A-014) or plain text like "A-014". */
export function labelFromScan(text: string): string | null {
  const m = /\/b\/([^/?#\s]+)/i.exec(text);
  if (m) return normalizeLabelId(decodeURIComponent(m[1]!));
  return normalizeLabelId(text);
}
