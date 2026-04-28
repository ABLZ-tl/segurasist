/**
 * `@segurasist/security` — consolidated cookie / origin / proxy primitives.
 *
 * Apps and other workspace packages should import from the subpath exports
 * (`@segurasist/security/cookie`, `/origin`, `/proxy`) when possible to keep
 * tree-shaking precise. The flat re-export here exists for callers that want
 * a single import line.
 */
export * from './cookie';
export * from './origin';
export * from './proxy';
export * from './jwt';
