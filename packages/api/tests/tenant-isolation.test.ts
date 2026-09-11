import { beforeEach, describe, expect, it } from 'vitest';
import { runInGlobalScope, runInTenantScope } from '../src/db/scoped-db.js';
import { TenantScopeViolationError } from '../src/lib/errors.js';
import { api, bearer, loginAs, useCapturingEmails } from './helpers/api.js';
import { createSuperadmin, createTenantWithUsers, createUser } from './helpers/factories.js';
import { rawQuery, readAuditActions } from './helpers/database.js';

/**
 * The definition of done for Phase 0.
 *
 * Every test here asks the same question from a different angle: can somebody
 * belonging to Tenant A reach anything belonging to Tenant B — including by
 * knowing or guessing the exact id of the thing they want?
 */
describe('tenant isolation', () => {
  let tenantA: Awaited<ReturnType<typeof createTenantWithUsers>>;
  let tenantB: Awaited<ReturnType<typeof createTenantWithUsers>>;
  let ownerAToken: string;

  beforeEach(async () => {
    useCapturingEmails();
    tenantA = await createTenantWithUsers('Empresa A');
    tenantB = await createTenantWithUsers('Empresa B');
    ownerAToken = await loginAs(tenantA.owner.email);
  });

  describe('through the HTTP API, knowing the exact target id', () => {
    it('cannot read another tenant by id', async () => {
      const response = await api()
        .get(`/tenants/${tenantB.tenant.id}`)
        .set('Authorization', bearer(ownerAToken));

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('TENANT_NOT_FOUND');
    });

    it('can read its own tenant by id', async () => {
      const response = await api()
        .get(`/tenants/${tenantA.tenant.id}`)
        .set('Authorization', bearer(ownerAToken))
        .expect(200);

      expect(response.body.tenant.id).toBe(tenantA.tenant.id);
    });

    it('sees only its own tenant when listing', async () => {
      const response = await api()
        .get('/tenants')
        .set('Authorization', bearer(ownerAToken))
        .expect(200);

      expect(response.body.tenants).toHaveLength(1);
      expect(response.body.tenants[0].id).toBe(tenantA.tenant.id);
    });

    it('sees only its own invitations when listing', async () => {
      const superadminToken = await loginAs((await createSuperadmin()).email);

      await api()
        .post('/invitations')
        .set('Authorization', bearer(superadminToken))
        .send({
          email: 'convidado-b@empresa.com.br',
          role: 'CLIENT_MEMBER',
          tenantId: tenantB.tenant.id,
        })
        .expect(201);

      const response = await api()
        .get('/invitations')
        .set('Authorization', bearer(ownerAToken))
        .expect(200);

      expect(response.body.invitations).toHaveLength(0);
    });

    it('cannot plant a user in another tenant by passing its id', async () => {
      // A CLIENT_OWNER naming somebody else's tenant in the request body is
      // ignored, not obeyed: the invitation is pinned to their own tenant.
      const response = await api()
        .post('/invitations')
        .set('Authorization', bearer(ownerAToken))
        .send({
          email: 'infiltrado@empresa.com.br',
          role: 'CLIENT_MEMBER',
          tenantId: tenantB.tenant.id,
        })
        .expect(201);

      expect(response.body.invitation.tenantId).toBe(tenantA.tenant.id);
      expect(response.body.invitation.tenantId).not.toBe(tenantB.tenant.id);
    });

    it('cannot escalate its own role through an invitation', async () => {
      const response = await api()
        .post('/invitations')
        .set('Authorization', bearer(ownerAToken))
        .send({ email: 'novo-dono@empresa.com.br', role: 'CLIENT_OWNER' });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('ROLE_NOT_INVITABLE');
    });

    it('cannot mint a Kosmos staff account', async () => {
      const response = await api()
        .post('/invitations')
        .set('Authorization', bearer(ownerAToken))
        .send({ email: 'falso-admin@empresa.com.br', role: 'SUPERADMIN' });

      expect(response.status).toBe(403);
    });

    it('refuses a CLIENT_MEMBER outright', async () => {
      const memberToken = await loginAs(tenantA.member.email);

      const response = await api()
        .post('/invitations')
        .set('Authorization', bearer(memberToken))
        .send({ email: 'qualquer@empresa.com.br', role: 'CLIENT_MEMBER' });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('INSUFFICIENT_ROLE');
    });

    it('cannot create a tenant', async () => {
      const response = await api()
        .post('/tenants')
        .set('Authorization', bearer(ownerAToken))
        .send({ name: 'Empresa Fantasma', slug: 'empresa-fantasma' });

      expect(response.status).toBe(403);
    });
  });

  describe('at the data-access layer, bypassing the API entirely', () => {
    it('throws when a tenant-scoped query names another tenant', async () => {
      await expect(
        runInTenantScope(tenantA.tenant.id, (db) =>
          db.raw.user.findMany({ where: { tenantId: tenantB.tenant.id } }),
        ),
      ).rejects.toThrow(TenantScopeViolationError);
    });

    it('throws when a tenant-scoped query has no tenant filter at all', async () => {
      await expect(
        runInTenantScope(tenantA.tenant.id, (db) => db.raw.user.findMany({})),
      ).rejects.toThrow(TenantScopeViolationError);
    });

    it('throws when a write targets another tenant', async () => {
      await expect(
        runInTenantScope(tenantA.tenant.id, (db) =>
          db.raw.user.create({
            data: {
              tenantId: tenantB.tenant.id,
              email: 'plantado@empresa.com.br',
              passwordHash: 'irrelevante',
              name: 'Plantado',
              role: 'CLIENT_MEMBER',
            },
          }),
        ),
      ).rejects.toThrow(TenantScopeViolationError);
    });

    it('throws when no scope has been established at all', async () => {
      const { prisma } = await import('../src/db/prisma.js');
      await expect(prisma.user.findMany({})).rejects.toThrow(TenantScopeViolationError);
    });

    it('still guards queries running inside a transaction', async () => {
      const { prisma } = await import('../src/db/prisma.js');

      await expect(
        runInTenantScope(tenantA.tenant.id, () =>
          prisma.$transaction((tx) => tx.user.findMany({ where: { tenantId: tenantB.tenant.id } })),
        ),
      ).rejects.toThrow(TenantScopeViolationError);
    });

    it('silently corrects a forged tenant id rather than obeying it', async () => {
      const rows = await runInTenantScope(tenantA.tenant.id, (db) =>
        db.user.findMany({ where: { tenantId: tenantB.tenant.id } }),
      );

      // ScopedDb merges its own filter last, so the forged value never reaches
      // the database: the caller gets their own tenant's rows, never Tenant B's.
      expect(rows).toHaveLength(2);
      expect(rows.every((row) => row.tenantId === tenantA.tenant.id)).toBe(true);
    });

    it('returns only its own rows when correctly scoped', async () => {
      const rows = await runInTenantScope(tenantA.tenant.id, (db) => db.user.findMany({}));

      expect(rows).toHaveLength(2);
      expect(rows.every((row) => row.tenantId === tenantA.tenant.id)).toBe(true);
    });
  });

  describe('Kosmos staff', () => {
    it('sees every tenant', async () => {
      const token = await loginAs((await createSuperadmin()).email);

      const response = await api().get('/tenants').set('Authorization', bearer(token)).expect(200);

      expect(response.body.tenants.length).toBeGreaterThanOrEqual(2);
    });

    it('records an audit entry when reaching into one specific tenant', async () => {
      const token = await loginAs((await createSuperadmin()).email);

      await api()
        .post('/invitations')
        .set('Authorization', bearer(token))
        .send({ email: 'novo@empresa.com.br', role: 'CLIENT_MEMBER', tenantId: tenantB.tenant.id })
        .expect(201);

      const actions = await readAuditActions();
      expect(actions).toContain('TENANT_SCOPE_OVERRIDDEN');

      const overrides = await rawQuery<{ tenant_id: string; after: { reason: string } }>(
        `SELECT tenant_id, after FROM audit_logs WHERE action = 'TENANT_SCOPE_OVERRIDDEN'`,
      );

      expect(overrides).toHaveLength(1);
      expect(overrides[0]?.tenant_id).toBe(tenantB.tenant.id);
      expect(overrides[0]?.after.reason).toBe('invitation:create');
    });

    it('does not record an override merely for listing tenants', async () => {
      const token = await loginAs((await createSuperadmin()).email);

      await api().get('/tenants').set('Authorization', bearer(token)).expect(200);

      const actions = await readAuditActions();
      expect(actions).not.toContain('TENANT_SCOPE_OVERRIDDEN');
    });

    it('records one override per request, not one per query', async () => {
      const token = await loginAs((await createSuperadmin()).email);

      await api()
        .post('/invitations')
        .set('Authorization', bearer(token))
        .send({ email: 'um@empresa.com.br', role: 'CLIENT_MEMBER', tenantId: tenantB.tenant.id })
        .expect(201);

      const overrides = await rawQuery(
        `SELECT id FROM audit_logs WHERE action = 'TENANT_SCOPE_OVERRIDDEN'`,
      );

      // The request runs several tenant-scoped queries; only one row should exist.
      expect(overrides).toHaveLength(1);
    });
  });

  describe('the database itself', () => {
    it('refuses a SUPERADMIN that belongs to a tenant', async () => {
      await expect(createUser({ tenantId: tenantA.tenant.id, role: 'SUPERADMIN' })).rejects.toThrow(
        /users_tenant_role_consistency/,
      );
    });

    it('refuses a CLIENT_OWNER with no tenant', async () => {
      await expect(createUser({ tenantId: null, role: 'CLIENT_OWNER' })).rejects.toThrow(
        /users_tenant_role_consistency/,
      );
    });

    it('refuses an email that is not normalised', async () => {
      await expect(
        runInGlobalScope('system:test-fixture', (db) =>
          db.raw.user.create({
            data: {
              tenantId: tenantA.tenant.id,
              email: 'MiXeD@Case.Com',
              passwordHash: 'irrelevante',
              name: 'Misto',
              role: 'CLIENT_MEMBER',
            },
          }),
        ),
      ).rejects.toThrow(/users_email_normalised/);
    });
  });
});
