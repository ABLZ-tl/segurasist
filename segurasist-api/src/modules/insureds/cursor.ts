/**
 * S2-06 — Cursor codec for insureds list pagination.
 *
 * Encoding: base64url(JSON.stringify({id, createdAt})).
 * El cliente lo trata como string opaco. El servidor lo decodifica para
 * armar el WHERE compuesto:
 *
 *   WHERE (created_at, id) < (cursor.createdAt, cursor.id)
 *   ORDER BY created_at DESC, id DESC
 *
 * Usamos compound key (createdAt, id) para evitar duplicados/saltos cuando
 * varias filas comparten el mismo created_at.
 */

export interface InsuredCursor {
  id: string;
  createdAt: string;
}

export function encodeCursor(c: InsuredCursor): string {
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): InsuredCursor | null {
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as Partial<InsuredCursor>;
    if (typeof parsed.id !== 'string' || typeof parsed.createdAt !== 'string') {
      return null;
    }
    return { id: parsed.id, createdAt: parsed.createdAt };
  } catch {
    return null;
  }
}
