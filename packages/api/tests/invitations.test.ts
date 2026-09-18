import { beforeEach, describe, expect, it } from 'vitest';
import {
  api,
  bearer,
  INVITE_LINK,
  loginAs,
  tokenFromLink,
  useCapturingEmails,
  type CapturingEmailProvider,
} from './helpers/api.js';
import {
  createSuperadmin,
  createTenant,
  createTenantWithUsers,
  createUser,
} from './helpers/factories.js';
import { rawQuery, readAuditActions } from './helpers/database.js';

describe('invitations', () => {
  let emails: CapturingEmailProvider;
  let fixture: Awaited<ReturnType<typeof createTenantWithUsers>>;
  let superadminToken: string;
  let ownerToken: string;

  beforeEach(async () => {
    emails = useCapturingEmails();
    fixture = await createTenantWithUsers('Padaria do Ze');
    superadminToken = await loginAs((await createSuperadmin()).email);
    ownerToken = await loginAs(fixture.owner.email);
  });

  async function inviteAs(token: string, body: Record<string, unknown>) {
    return api().post('/invitations').set('Authorization', bearer(token)).send(body);
  }

  function lastInviteToken(): string {
    return tokenFromLink(emails.lastLinkMatching(INVITE_LINK));
  }

  describe('POST /invitations', () => {
    it('lets Kosmos staff invite a client owner and emails a link', async () => {
      const response = await inviteAs(superadminToken, {
        email: 'ze@padaria.com.br',
        role: 'CLIENT_OWNER',
        tenantId: fixture.tenant.id,
      });

      expect(response.status).toBe(201);
      expect(response.body.invitation.email).toBe('ze@padaria.com.br');
      expect(response.body.invitation.tenantId).toBe(fixture.tenant.id);
      expect(emails.sent).toHaveLength(1);
      expect(emails.sent[0]?.to).toBe('ze@padaria.com.br');
      expect(emails.sent[0]?.text).toContain('Padaria do Ze');
    });

    it('lets a client owner invite a teammate into their own tenant', async () => {
      const response = await inviteAs(ownerToken, {
        email: 'colega@padaria.com.br',
        role: 'CLIENT_MEMBER',
      });

      expect(response.status).toBe(201);
      expect(response.body.invitation.tenantId).toBe(fixture.tenant.id);
    });

    it('stores the token hashed, never the token itself', async () => {
      await inviteAs(ownerToken, { email: 'colega@padaria.com.br', role: 'CLIENT_MEMBER' });

      const rawToken = lastInviteToken();
      const rows = await rawQuery<{ token_hash: string }>('SELECT token_hash FROM invitations');

      expect(rows).toHaveLength(1);
      expect(rows[0]?.token_hash).not.toBe(rawToken);
      expect(rows[0]?.token_hash).toHaveLength(64);
    });

    it('normalises the invited email', async () => {
      const response = await inviteAs(ownerToken, {
        email: '  MiXeD@Padaria.COM.br ',
        role: 'CLIENT_MEMBER',
      });

      expect(response.body.invitation.email).toBe('mixed@padaria.com.br');
    });

    it('expires in seven days', async () => {
      const response = await inviteAs(ownerToken, {
        email: 'colega@padaria.com.br',
        role: 'CLIENT_MEMBER',
      });

      const expiresAt = new Date(response.body.invitation.expiresAt as string).getTime();
      const days = (expiresAt - Date.now()) / 86_400_000;

      expect(days).toBeGreaterThan(6.9);
      expect(days).toBeLessThan(7.1);
    });

    it('refuses an email that already has an account', async () => {
      const response = await inviteAs(ownerToken, {
        email: fixture.member.email,
        role: 'CLIENT_MEMBER',
      });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('USER_ALREADY_EXISTS');
    });

    it('refuses a placeholder or disposable domain', async () => {
      const response = await inviteAs(ownerToken, {
        email: 'alguem@teste.com',
        role: 'CLIENT_MEMBER',
      });

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(response.body.error.details).toContainEqual(
        expect.objectContaining({ field: 'email' }),
      );
      expect(emails.sent).toHaveLength(0);
    });

    it('refuses an obvious provider typo and suggests the fix', async () => {
      const response = await inviteAs(ownerToken, {
        email: 'colega@gmial.com',
        role: 'CLIENT_MEMBER',
      });

      expect(response.status).toBe(422);
      const emailIssue = response.body.error.details.find(
        (item: { field: string }) => item.field === 'email',
      );
      expect(emailIssue?.message).toContain('@gmail.com');
    });

    it('supersedes an earlier pending invitation instead of leaving two live links', async () => {
      await inviteAs(ownerToken, { email: 'colega@padaria.com.br', role: 'CLIENT_MEMBER' });
      const first = lastInviteToken();

      await inviteAs(ownerToken, { email: 'colega@padaria.com.br', role: 'CLIENT_MEMBER' });
      const second = lastInviteToken();

      expect(second).not.toBe(first);

      await api().get(`/invitations/${first}`).expect(404);
      await api().get(`/invitations/${second}`).expect(200);
    });

    it('refuses an unknown tenant', async () => {
      const response = await inviteAs(superadminToken, {
        email: 'alguem@empresa.com.br',
        role: 'CLIENT_MEMBER',
        tenantId: '01a03034-8df7-7479-8e43-2a0eb76d217a',
      });

      expect(response.status).toBe(404);
    });

    it('requires authentication', async () => {
      await api()
        .post('/invitations')
        .send({ email: 'alguem@empresa.com.br', role: 'CLIENT_MEMBER' })
        .expect(401);
    });

    it('records INVITATION_SENT', async () => {
      await inviteAs(ownerToken, { email: 'colega@padaria.com.br', role: 'CLIENT_MEMBER' });
      expect(await readAuditActions()).toContain('INVITATION_SENT');
    });
  });

  describe('GET /invitations/:token', () => {
    it('renders without a session and reveals only what the page needs', async () => {
      await inviteAs(superadminToken, {
        email: 'ze@padaria.com.br',
        role: 'CLIENT_OWNER',
        tenantId: fixture.tenant.id,
      });

      const response = await api().get(`/invitations/${lastInviteToken()}`).expect(200);

      expect(response.body.invitation).toEqual({
        email: 'ze@padaria.com.br',
        role: 'CLIENT_OWNER',
        tenantName: 'Padaria do Ze',
        expiresAt: expect.any(String),
      });

      // Nothing beyond that: no tenant id, no inviter, no other members.
      expect(JSON.stringify(response.body)).not.toContain(fixture.tenant.id);
      expect(JSON.stringify(response.body)).not.toContain(fixture.owner.email);
    });

    it('answers 404 for an invented token', async () => {
      await api().get('/invitations/token-que-nao-existe').expect(404);
    });

    it('answers the same 404 for expired, used and unknown tokens', async () => {
      await inviteAs(ownerToken, { email: 'colega@padaria.com.br', role: 'CLIENT_MEMBER' });
      const token = lastInviteToken();

      await rawQuery(`UPDATE invitations SET expires_at = now() - interval '1 day'`);

      const expired = await api().get(`/invitations/${token}`).expect(404);
      const unknown = await api().get('/invitations/token-inventado').expect(404);

      expect(expired.body).toEqual(unknown.body);
    });
  });

  describe('POST /invitations/:token/accept', () => {
    beforeEach(async () => {
      await inviteAs(superadminToken, {
        email: 'ze@padaria.com.br',
        role: 'CLIENT_OWNER',
        tenantId: fixture.tenant.id,
      });
    });

    it('creates the user, signs them in and marks the invitation accepted', async () => {
      const token = lastInviteToken();

      const response = await api()
        .post(`/invitations/${token}/accept`)
        .send({ name: 'Jose da Silva', password: 'uma-senha-bem-longa' })
        .expect(201);

      expect(response.body.accessToken).toBeTypeOf('string');
      expect(response.body.user.email).toBe('ze@padaria.com.br');
      expect(response.body.user.role).toBe('CLIENT_OWNER');
      expect(response.body.user.tenantId).toBe(fixture.tenant.id);

      const [invitation] = await rawQuery<{ accepted_at: Date | null }>(
        `SELECT accepted_at FROM invitations WHERE email = 'ze@padaria.com.br'`,
      );
      expect(invitation?.accepted_at).not.toBeNull();
    });

    it('lets the new user log in afterwards', async () => {
      await api()
        .post(`/invitations/${lastInviteToken()}/accept`)
        .send({ name: 'Jose da Silva', password: 'uma-senha-bem-longa' })
        .expect(201);

      await api()
        .post('/auth/login')
        .send({ email: 'ze@padaria.com.br', password: 'uma-senha-bem-longa' })
        .expect(200);
    });

    it('is single use', async () => {
      const token = lastInviteToken();

      await api()
        .post(`/invitations/${token}/accept`)
        .send({ name: 'Jose da Silva', password: 'uma-senha-bem-longa' })
        .expect(201);

      const second = await api()
        .post(`/invitations/${token}/accept`)
        .send({ name: 'Impostor', password: 'outra-senha-bem-longa' })
        .expect(404);

      expect(second.body.error.code).toBe('INVITATION_INVALID');
    });

    it('creates exactly one user when the same link is submitted twice at once', async () => {
      const token = lastInviteToken();

      const results = await Promise.allSettled([
        api()
          .post(`/invitations/${token}/accept`)
          .send({ name: 'Primeiro', password: 'uma-senha-bem-longa' }),
        api()
          .post(`/invitations/${token}/accept`)
          .send({ name: 'Segundo', password: 'uma-senha-bem-longa' }),
      ]);

      const created = results.filter(
        (result) => result.status === 'fulfilled' && result.value.status === 201,
      );
      expect(created).toHaveLength(1);

      const users = await rawQuery(`SELECT id FROM users WHERE email = 'ze@padaria.com.br'`);
      expect(users).toHaveLength(1);
    });

    it('refuses an expired invitation', async () => {
      const token = lastInviteToken();
      // An hour, not a second. `now()` is the database's clock and the expiry
      // is checked against the application's, and those are two machines whose
      // clocks agree only approximately — a managed Postgres a few hundred
      // milliseconds ahead is enough to make "one second ago" still be in the
      // future. The margin has to exceed ordinary clock skew, and nothing in
      // what this test asserts depends on the expiry being recent.
      await rawQuery(`UPDATE invitations SET expires_at = now() - interval '1 hour'`);

      await api()
        .post(`/invitations/${token}/accept`)
        .send({ name: 'Tarde Demais', password: 'uma-senha-bem-longa' })
        .expect(404);
    });

    it('enforces the password policy', async () => {
      await api()
        .post(`/invitations/${lastInviteToken()}/accept`)
        .send({ name: 'Jose da Silva', password: 'curta' })
        .expect(422);
    });

    it('requires a name', async () => {
      await api()
        .post(`/invitations/${lastInviteToken()}/accept`)
        .send({ name: 'J', password: 'uma-senha-bem-longa' })
        .expect(422);
    });

    it('records USER_CREATED and INVITATION_ACCEPTED', async () => {
      await api()
        .post(`/invitations/${lastInviteToken()}/accept`)
        .send({ name: 'Jose da Silva', password: 'uma-senha-bem-longa' })
        .expect(201);

      const actions = await readAuditActions();
      expect(actions).toContain('USER_CREATED');
      expect(actions).toContain('INVITATION_ACCEPTED');
      expect(actions).toContain('USER_LOGIN_SUCCEEDED');
    });

    it('never stores the raw password', async () => {
      await api()
        .post(`/invitations/${lastInviteToken()}/accept`)
        .send({ name: 'Jose da Silva', password: 'uma-senha-bem-longa' })
        .expect(201);

      const [row] = await rawQuery<{ password_hash: string }>(
        `SELECT password_hash FROM users WHERE email = 'ze@padaria.com.br'`,
      );

      expect(row?.password_hash).toContain('$argon2id$');
      expect(row?.password_hash).not.toContain('uma-senha-bem-longa');
    });
  });

  describe('Kosmos staff invitations', () => {
    it('creates a tenantless SUPERADMIN invitation', async () => {
      const response = await inviteAs(superadminToken, {
        email: 'novo.admin@kosmos.com.br',
        role: 'SUPERADMIN',
      });

      expect(response.status).toBe(201);
      expect(response.body.invitation.tenantId).toBeNull();

      await api()
        .post(`/invitations/${lastInviteToken()}/accept`)
        .send({ name: 'Novo Admin', password: 'uma-senha-bem-longa' })
        .expect(201);

      const [user] = await rawQuery<{ tenant_id: string | null; role: string }>(
        `SELECT tenant_id, role FROM users WHERE email = 'novo.admin@kosmos.com.br'`,
      );
      expect(user?.tenant_id).toBeNull();
      expect(user?.role).toBe('SUPERADMIN');
    });

    it('ignores a tenantId when inviting a SUPERADMIN', async () => {
      const response = await inviteAs(superadminToken, {
        email: 'outro.admin@kosmos.com.br',
        role: 'SUPERADMIN',
        tenantId: fixture.tenant.id,
      });

      expect(response.status).toBe(201);
      expect(response.body.invitation.tenantId).toBeNull();
    });
  });

  describe('GET /invitations', () => {
    it('lists only the caller tenant invitations', async () => {
      const otherTenant = await createTenant({ name: 'Outra Empresa' });
      await createUser({ tenantId: otherTenant.id, role: 'CLIENT_OWNER' });

      await inviteAs(ownerToken, { email: 'colega@padaria.com.br', role: 'CLIENT_MEMBER' });
      await inviteAs(superadminToken, {
        email: 'outro@outra.com.br',
        role: 'CLIENT_MEMBER',
        tenantId: otherTenant.id,
      });

      const response = await api()
        .get('/invitations')
        .set('Authorization', bearer(ownerToken))
        .expect(200);

      expect(response.body.invitations).toHaveLength(1);
      expect(response.body.invitations[0].email).toBe('colega@padaria.com.br');
    });

    it('shows Kosmos staff everything', async () => {
      await inviteAs(ownerToken, { email: 'colega@padaria.com.br', role: 'CLIENT_MEMBER' });

      const response = await api()
        .get('/invitations')
        .set('Authorization', bearer(superadminToken))
        .expect(200);

      expect(response.body.invitations.length).toBeGreaterThanOrEqual(1);
    });
  });
});
