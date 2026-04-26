/**
 * Cursor codec para `/v1/audit/log` — keyset por (occurredAt DESC, id DESC).
 * Mismo esquema que insureds/users: base64url(JSON.stringify({id, occurredAt})).
 */
export interface AuditCursor {
  id: string;
  occurredAt: string;
}

export function encodeAuditCursor(c: AuditCursor): string {
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
}

export function decodeAuditCursor(raw: string): AuditCursor | null {
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as Partial<AuditCursor>;
    if (typeof parsed.id !== 'string' || typeof parsed.occurredAt !== 'string') return null;
    return { id: parsed.id, occurredAt: parsed.occurredAt };
  } catch {
    return null;
  }
}
