/**
 * Cursor codec para paginación keyset de `/v1/users`. Mismo patrón que
 * `modules/insureds/cursor.ts` — cliente lo trata como string opaco; el server
 * decodifica para armar `(createdAt, id) < cursor` y mantener orden estable
 * cuando varias filas comparten `created_at`.
 */
export interface UserCursor {
  id: string;
  createdAt: string;
}

export function encodeCursor(c: UserCursor): string {
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): UserCursor | null {
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as Partial<UserCursor>;
    if (typeof parsed.id !== 'string' || typeof parsed.createdAt !== 'string') {
      return null;
    }
    return { id: parsed.id, createdAt: parsed.createdAt };
  } catch {
    return null;
  }
}
