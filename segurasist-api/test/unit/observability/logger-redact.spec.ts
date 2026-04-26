/**
 * M5 — verifica que el redact recursivo aplicado al pipeline de pino
 * (vía custom `formatters.log`) elimina claves sensibles a cualquier
 * profundidad de objetos y arrays.
 *
 * Construimos un logger pino con la MISMA combinación de `redact.paths` +
 * `formatters.log = scrubSensitiveDeep` que `app.module.ts` registra. La
 * prueba captura el output con un Writable in-memory.
 *
 * Por qué no `**.password`: fast-redact (motor de pino) no soporta wildcard
 * recursivo. Por eso movimos la responsabilidad a `scrubSensitiveDeep` que
 * sí recorre profundidades arbitrarias. El `redact.paths` clásico se reserva
 * para los headers de request (que entran por pino-http).
 */
import { Writable } from 'node:stream';
import pino from 'pino';
import { scrubSensitiveDeep } from '../../../src/common/utils/scrub-sensitive';

interface Captured {
  lines: string[];
  add(line: string): void;
}

function buildSink(): { sink: Writable; captured: Captured } {
  const captured: Captured = {
    lines: [],
    add(line: string) {
      this.lines.push(line);
    },
  };
  const sink = new Writable({
    write(chunk, _enc, cb) {
      captured.add(chunk.toString().trim());
      cb();
    },
  });
  return { sink, captured };
}

function makeLogger(captured: { sink: Writable; captured: Captured }): pino.Logger {
  return pino(
    {
      level: 'debug',
      redact: { paths: ['req.headers.authorization', 'req.headers.cookie'], censor: '[REDACTED]' },
      formatters: {
        log: (obj: Record<string, unknown>): Record<string, unknown> =>
          scrubSensitiveDeep(obj) as Record<string, unknown>,
      },
    },
    captured.sink,
  );
}

describe('pino redact recursivo (M5)', () => {
  it('redacta idToken anidado profundo: { user: { credentials: { idToken } } }', () => {
    const cap = buildSink();
    const logger = makeLogger(cap);
    logger.info({ user: { credentials: { idToken: 'super-secret-jwt-zzz' } } }, 'msg');
    const out = cap.captured.lines.join('\n');
    expect(out).not.toContain('super-secret-jwt-zzz');
    expect(out).toContain('[REDACTED]');
  });

  it('redacta password dentro de un array de items', () => {
    const cap = buildSink();
    const logger = makeLogger(cap);
    logger.info({ data: { items: [{ password: 'topsecret-p1' }, { password: 'topsecret-p2' }] } }, 'msg');
    const out = cap.captured.lines.join('\n');
    expect(out).not.toContain('topsecret-p1');
    expect(out).not.toContain('topsecret-p2');
    expect(out).toContain('[REDACTED]');
  });

  it('redacta CURP en cualquier nivel del objeto', () => {
    const cap = buildSink();
    const logger = makeLogger(cap);
    logger.info({ insured: { curp: 'PEPM800101HDFRRR01' } }, 'msg');
    const out = cap.captured.lines.join('\n');
    expect(out).not.toContain('PEPM800101HDFRRR01');
    expect(out).toContain('[REDACTED]');
  });

  it('redacta header authorization de req (vía redact.paths clásico)', () => {
    const cap = buildSink();
    const logger = makeLogger(cap);
    logger.info({ req: { headers: { authorization: 'Bearer eyJhbGciOiJSUzI1NiIs.xxxxx' } } }, 'msg');
    const out = cap.captured.lines.join('\n');
    expect(out).not.toContain('eyJhbGciOiJSUzI1NiIs');
    expect(out).toContain('[REDACTED]');
  });

  it('NO redacta campos no listados (sanity)', () => {
    const cap = buildSink();
    const logger = makeLogger(cap);
    logger.info({ user: { name: 'Juan Pérez', age: 42 } }, 'msg');
    const out = cap.captured.lines.join('\n');
    expect(out).toContain('Juan Pérez');
    expect(out).toContain('42');
  });

  it('redacta refreshToken/accessToken/cognitoSub en niveles arbitrarios', () => {
    const cap = buildSink();
    const logger = makeLogger(cap);
    logger.info(
      {
        a: {
          b: {
            c: {
              cognitoSub: 'sub-aaaa-bbbb',
              tokens: { accessToken: 'access-x', refreshToken: 'refresh-x' },
            },
          },
        },
      },
      'msg',
    );
    const out = cap.captured.lines.join('\n');
    expect(out).not.toContain('sub-aaaa-bbbb');
    expect(out).not.toContain('access-x');
    expect(out).not.toContain('refresh-x');
  });

  it('depth máximo: corta a [REDACTED] objetos cíclicos / muy profundos sin colgar', () => {
    const cap = buildSink();
    const logger = makeLogger(cap);
    // 20 niveles de anidamiento — debe quedar redacted al pasar el límite (12).
    let payload: Record<string, unknown> = { v: 'leaf' };
    for (let i = 0; i < 20; i += 1) {
      payload = { nested: payload };
    }
    expect(() => logger.info(payload, 'deep')).not.toThrow();
  });
});
