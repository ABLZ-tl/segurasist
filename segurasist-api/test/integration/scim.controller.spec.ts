/**
 * Integration tests for the SCIM 2.0 controller — S5-1 Sprint 5 iter 1.
 *
 * Boots a minimal Nest app with `ScimModule` only (no AuthModule, no
 * Throttler, no Prisma) so the suite stays self-contained and fast.
 *
 * Coverage:
 *   1) auth: missing / wrong bearer → 401 with SCIM error envelope.
 *   2) auth: correct tenant bearer → 200.
 *   3) GET ServiceProviderConfig returns capabilities document.
 *   4) POST /Users creates a user, surfaces SCIM resource shape.
 *   5) POST /Users with the same externalId twice → 409 uniqueness.
 *   6) GET /Users with `userName eq "..."` filter returns the match.
 *   7) PATCH /Users replace `active=false` flips the flag.
 *   8) PUT /Users replace updates name + email.
 *   9) DELETE /Users soft-deletes (subsequent GET → 404).
 *  10) Cross-tenant isolation: tenantA's bearer cannot read tenantB's user.
 *  11) GET /Groups returns 404 (iter 1 stub).
 *
 * The audit-context factory is mocked by injecting a stub provider; the
 * controller calls `void this.auditCtx.fromRequest()` only as a no-op
 * in iter 1 (real audit wireup is iter 2 once the enum migration lands).
 */
import type { Server } from 'node:http';
import { Module } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuditContextFactory } from '@modules/audit/audit-context.factory';
import { ScimController } from '@modules/scim/scim.controller';
import { ScimService } from '@modules/scim/scim.service';

const TENANT_A = 'tenant-aaa';
const TENANT_B = 'tenant-bbb';
const TOKEN_A = 'tokenA-secret';
const TOKEN_B = 'tokenB-secret';

@Module({
  controllers: [ScimController],
  providers: [
    ScimService,
    {
      provide: AuditContextFactory,
      useValue: { fromRequest: () => ({}) },
    },
  ],
})
class ScimTestModule {}

describe('SCIM v2 controller (S5-1 iter 1)', () => {
  let app: NestFastifyApplication;
  let server: Server;

  beforeAll(async () => {
    process.env.SCIM_TENANT_TOKENS = `${TENANT_A}:${TOKEN_A},${TENANT_B}:${TOKEN_B}`;
    const moduleRef = await Test.createTestingModule({ imports: [ScimTestModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.enableVersioning();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    if (app) await app.close();
    delete process.env.SCIM_TENANT_TOKENS;
  });

  // -------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------
  it('rejects requests without an Authorization header', async () => {
    const res = await request(server).get('/v1/scim/v2/Users');
    expect(res.status).toBe(401);
    expect(res.body?.schemas?.[0]).toBe('urn:ietf:params:scim:api:messages:2.0:Error');
  });

  it('rejects an unknown bearer token', async () => {
    const res = await request(server)
      .get('/v1/scim/v2/Users')
      .set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
  });

  it('accepts a valid tenant bearer for ServiceProviderConfig', async () => {
    const res = await request(server)
      .get('/v1/scim/v2/ServiceProviderConfig')
      .set('Authorization', `Bearer ${TOKEN_A}`);
    expect(res.status).toBe(200);
    expect(res.body.schemas[0]).toContain('ServiceProviderConfig');
    expect(res.body.patch.supported).toBe(true);
    expect(res.body.filter.supported).toBe(true);
  });

  // -------------------------------------------------------------------
  // Create
  // -------------------------------------------------------------------
  it('creates a user via POST /Users and returns a SCIM resource', async () => {
    const res = await request(server)
      .post('/v1/scim/v2/Users')
      .set('Authorization', `Bearer ${TOKEN_A}`)
      .send({
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        externalId: 'idp-user-1',
        userName: 'alice@example.test',
        name: { givenName: 'Alice', familyName: 'Smith' },
        emails: [{ value: 'alice@example.test', primary: true }],
        roles: [{ value: 'admin_mac', primary: true }],
        active: true,
      });
    expect(res.status).toBe(201);
    expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.userName).toBe('alice@example.test');
    expect(res.body.roles[0].value).toBe('admin_mac');
    expect(res.body.meta.resourceType).toBe('User');
  });

  it('returns 409 when the same externalId is created twice', async () => {
    const dup = await request(server)
      .post('/v1/scim/v2/Users')
      .set('Authorization', `Bearer ${TOKEN_A}`)
      .send({
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        externalId: 'idp-user-1', // SAME as previous test
        userName: 'alice2@example.test',
        emails: [{ value: 'alice2@example.test' }],
      });
    expect(dup.status).toBe(409);
    expect(dup.body?.message?.scimType ?? dup.body?.scimType).toBe('uniqueness');
  });

  // -------------------------------------------------------------------
  // Filter
  // -------------------------------------------------------------------
  it('lists users with a userName eq filter', async () => {
    const res = await request(server)
      .get('/v1/scim/v2/Users')
      .query({ filter: 'userName eq "alice@example.test"' })
      .set('Authorization', `Bearer ${TOKEN_A}`);
    expect(res.status).toBe(200);
    expect(res.body.totalResults).toBe(1);
    expect(res.body.Resources[0].userName).toBe('alice@example.test');
  });

  // -------------------------------------------------------------------
  // PATCH + PUT
  // -------------------------------------------------------------------
  it('PATCH replace deactivates a user', async () => {
    const list = await request(server)
      .get('/v1/scim/v2/Users')
      .query({ filter: 'userName eq "alice@example.test"' })
      .set('Authorization', `Bearer ${TOKEN_A}`);
    const id = list.body.Resources[0].id as string;
    const res = await request(server)
      .patch(`/v1/scim/v2/Users/${id}`)
      .set('Authorization', `Bearer ${TOKEN_A}`)
      .send({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', value: { active: false } }],
      });
    expect(res.status).toBe(200);
    expect(res.body.active).toBe(false);
  });

  it('PUT replaces name + email', async () => {
    const list = await request(server)
      .get('/v1/scim/v2/Users')
      .query({ filter: 'userName eq "alice@example.test"' })
      .set('Authorization', `Bearer ${TOKEN_A}`);
    const id = list.body.Resources[0].id as string;
    const res = await request(server)
      .put(`/v1/scim/v2/Users/${id}`)
      .set('Authorization', `Bearer ${TOKEN_A}`)
      .send({
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: 'alice@example.test',
        name: { givenName: 'Alicia', familyName: 'Renamed' },
        emails: [{ value: 'alicia@example.test' }],
      });
    expect(res.status).toBe(200);
    expect(res.body.name.givenName).toBe('Alicia');
    expect(res.body.emails[0].value).toBe('alicia@example.test');
  });

  // -------------------------------------------------------------------
  // DELETE — soft delete
  // -------------------------------------------------------------------
  it('DELETE removes the user (subsequent GET returns 404)', async () => {
    const list = await request(server)
      .get('/v1/scim/v2/Users')
      .query({ filter: 'userName eq "alice@example.test"' })
      .set('Authorization', `Bearer ${TOKEN_A}`);
    const id = list.body.Resources[0].id as string;
    const del = await request(server)
      .delete(`/v1/scim/v2/Users/${id}`)
      .set('Authorization', `Bearer ${TOKEN_A}`);
    expect(del.status).toBe(204);
    const get = await request(server)
      .get(`/v1/scim/v2/Users/${id}`)
      .set('Authorization', `Bearer ${TOKEN_A}`);
    expect(get.status).toBe(404);
  });

  // -------------------------------------------------------------------
  // Cross-tenant isolation
  // -------------------------------------------------------------------
  it('isolates users across tenants — tenant B cannot see tenant A users', async () => {
    // Create a user in tenant B.
    const created = await request(server)
      .post('/v1/scim/v2/Users')
      .set('Authorization', `Bearer ${TOKEN_B}`)
      .send({
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        externalId: 'idp-tenantB-user',
        userName: 'bob@b.example.test',
        emails: [{ value: 'bob@b.example.test' }],
      });
    expect(created.status).toBe(201);
    const idB = created.body.id as string;

    // Try to read it with tenant A's token — should 404 (the user is
    // scoped to tenantB, so tenantA's view does not contain it).
    const cross = await request(server)
      .get(`/v1/scim/v2/Users/${idB}`)
      .set('Authorization', `Bearer ${TOKEN_A}`);
    expect(cross.status).toBe(404);
  });

  // -------------------------------------------------------------------
  // Groups stub
  // -------------------------------------------------------------------
  it('GET /Groups returns 404 (iter 1 stub)', async () => {
    const res = await request(server)
      .get('/v1/scim/v2/Groups')
      .set('Authorization', `Bearer ${TOKEN_A}`);
    expect(res.status).toBe(404);
  });
});
