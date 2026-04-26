/**
 * L1 — verifica que la CSP de helmet se aplica a TODOS los responses, no
 * sólo en producción. La API REST NO renderiza HTML, así que la directiva
 * default-src 'none' es la opción más restrictiva válida.
 *
 * No bootstrappeamos toda la AppModule (que requiere docker stack); usamos
 * una mini-app NestJS con un controller stub y registramos helmet con la
 * misma config que `main.ts`.
 */
import type { Server } from 'node:http';
import helmet from '@fastify/helmet';
import { Controller, Get, Module } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import request from 'supertest';

@Controller({ path: 'health', version: undefined })
class StubHealthController {
  @Get('ready')
  ready(): { status: 'ok' } {
    return { status: 'ok' };
  }
}

@Module({ controllers: [StubHealthController] })
class StubModule {}

describe('Security headers (helmet CSP)', () => {
  let app: NestFastifyApplication;
  let server: Server;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [StubModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter({ trustProxy: true }));
    await app.register(helmet, {
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
        },
      },
      hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('GET /health/ready trae header Content-Security-Policy con directivas restrictivas', async () => {
    const res = await request(server).get('/health/ready');
    expect(res.status).toBe(200);
    const csp = res.headers['content-security-policy'];
    expect(csp).toBeDefined();
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("form-action 'none'");
  });

  it('Strict-Transport-Security está activo con includeSubDomains y preload', async () => {
    const res = await request(server).get('/health/ready');
    const hsts = res.headers['strict-transport-security'];
    expect(hsts).toBeDefined();
    expect(hsts).toMatch(/max-age=63072000/);
    expect(hsts).toMatch(/includeSubDomains/);
    expect(hsts).toMatch(/preload/);
  });
});
