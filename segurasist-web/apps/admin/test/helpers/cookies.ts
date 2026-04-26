/**
 * Helper for tests that exercise server-only modules importing
 * `next/headers`. The vitest setup wires `cookies()` to a shared in-memory
 * jar — this helper just gives test files a typed handle to seed it.
 */

import { cookieJar } from '../setup';

export function setSessionCookie(name: string, value: string | undefined): void {
  cookieJar.__setCookie(name, value);
}

export function clearAllCookies(): void {
  cookieJar.__reset();
}
