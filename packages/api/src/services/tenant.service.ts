import { prisma } from '../db/prisma.js';
import { runInGlobalScope } from '../db/scoped-db.js';
import { ConflictError, NotFoundError } from '../lib/errors.js';
import {
  findTenantById,
  listTenants as selectTenants,
  updateTenant as persistTenantUpdate,
} from '../repositories/tenant.repository.js';
import type { RequestContext } from '../types/request-context.js';
import { metadataOf } from '../types/request-context.js';
import { AuditAction, AuditEntity } from './audit.actions.js';
import { audit } from './audit.service.js';
import { runAsContext } from './scope.service.js';
import type { PublicTenant } from './user.mapper.js';
import { toPublicTenant } from './user.mapper.js';

export interface CreateTenantCommand {
  readonly name: string;
  readonly slug: string;
  readonly contractSignedAt?: string | null;
}

/**
 * Creating a client company.
 *
 * This is the one entity that has to exist before anything else can: without
 * a tenant there is nobody to invite a CLIENT_OWNER into. Only Kosmos staff
 * can do it, which the route enforces before this is ever called.
 */
export async function createTenant(
  context: RequestContext,
  command: CreateTenantCommand,
): Promise<PublicTenant> {
  return runInGlobalScope('superadmin:tenant-create', async (db) => {
    const clash = await db.tenant.findFirst({ where: { slug: command.slug } });
    if (clash) {
      throw new ConflictError('A tenant with this slug already exists', 'TENANT_SLUG_TAKEN');
    }

    const tenant = await prisma.$transaction(async (tx) => {
      const created = await tx.tenant.create({
        data: {
          name: command.name,
          slug: command.slug,
          contractSignedAt: command.contractSignedAt ? new Date(command.contractSignedAt) : null,
        },
      });

      await audit(tx, {
        action: AuditAction.TENANT_CREATED,
        actor: { id: context.userId, email: context.email, role: context.role },
        tenantId: created.id,
        entityType: AuditEntity.TENANT,
        entityId: created.id,
        after: { name: created.name, slug: created.slug },
        request: metadataOf(context),
      });

      return created;
    });

    return toPublicTenant(tenant);
  });
}

/**
 * Renaming a client company. Kosmos staff only, which the route enforces.
 *
 * Runs in a global scope because staff have no tenant of their own; the
 * before/after names are recorded so the audit log shows exactly what a name
 * used to be. The slug is untouched — a rename must not break a shared link.
 */
export function updateTenant(
  context: RequestContext,
  id: string,
  command: { readonly name: string },
): Promise<PublicTenant> {
  return runInGlobalScope('superadmin:tenant-update', async (db) => {
    const existing = await findTenantById(db, id);
    if (!existing) throw new NotFoundError('Tenant not found', 'TENANT_NOT_FOUND');

    const tenant = await prisma.$transaction(async (tx) => {
      const updated = await persistTenantUpdate(tx, id, { name: command.name });

      await audit(tx, {
        action: AuditAction.TENANT_UPDATED,
        actor: { id: context.userId, email: context.email, role: context.role },
        tenantId: id,
        entityType: AuditEntity.TENANT,
        entityId: id,
        before: { name: existing.name },
        after: { name: updated.name },
        request: metadataOf(context),
      });

      return updated;
    });

    return toPublicTenant(tenant);
  });
}

/**
 * Archiving a client — the reversible "remove". Kosmos staff only.
 *
 * The project does not erase history, so this suspends rather than deletes: the
 * tenant's status becomes SUSPENDED, which locks its people out at login (see
 * `auth.service`) while every assignment, every watched second and every audit
 * row stays exactly where it was. `reactivateTenant` is the way back. A
 * hard-delete was deliberately not built — a company's onboarding record is the
 * kind of thing you regret losing, and nothing here needs it gone.
 */
export function archiveTenant(context: RequestContext, id: string): Promise<PublicTenant> {
  return setTenantArchived(context, id, true);
}

export function reactivateTenant(context: RequestContext, id: string): Promise<PublicTenant> {
  return setTenantArchived(context, id, false);
}

function setTenantArchived(
  context: RequestContext,
  id: string,
  archived: boolean,
): Promise<PublicTenant> {
  const reason = archived ? 'superadmin:tenant-archive' : 'superadmin:tenant-reactivate';
  return runInGlobalScope(reason, async (db) => {
    const existing = await findTenantById(db, id);
    if (!existing) throw new NotFoundError('Tenant not found', 'TENANT_NOT_FOUND');

    // Reactivation restores ACTIVE, not the original ONBOARDING: a client being
    // un-archived has already been onboarded far enough to have existed, and
    // ACTIVE is the honest state to return them to.
    const nextStatus = archived ? 'SUSPENDED' : 'ACTIVE';
    if (existing.status === nextStatus) {
      throw new ConflictError(
        archived ? 'Tenant is already archived' : 'Tenant is not archived',
        archived ? 'TENANT_ALREADY_ARCHIVED' : 'TENANT_NOT_ARCHIVED',
      );
    }

    const tenant = await prisma.$transaction(async (tx) => {
      const updated = await persistTenantUpdate(tx, id, { status: nextStatus });

      await audit(tx, {
        action: archived ? AuditAction.TENANT_ARCHIVED : AuditAction.TENANT_REACTIVATED,
        actor: { id: context.userId, email: context.email, role: context.role },
        tenantId: id,
        entityType: AuditEntity.TENANT,
        entityId: id,
        before: { status: existing.status },
        after: { status: updated.status },
        request: metadataOf(context),
      });

      return updated;
    });

    return toPublicTenant(tenant);
  });
}

/**
 * Permanently delete a client — the irreversible counterpart to archiving.
 *
 * Guarded twice: only a client that is already **archived** (SUSPENDED) can be
 * deleted, so "remove for good" is always a two-step, deliberate act — archive
 * first, then delete. Everything the company owns goes with it, in one
 * transaction: `User` and `Invitation` are `onDelete: Restrict`, so they are
 * removed by hand first (deleting a user cascades its tokens, progress and
 * watch events); the tenant row goes last and its remaining children —
 * assignments, and any stray progress/watch — cascade with it.
 *
 * The audit line is written in the same transaction, and because `audit_logs`
 * has no foreign key to `tenants`, the record of the deletion outlives the
 * company it describes. Runs in a named global scope: staff own no tenant, and
 * the tripwire permits scoped deletes only because the scope is explicitly
 * global here.
 */
export function deleteTenant(context: RequestContext, id: string): Promise<void> {
  return runInGlobalScope('superadmin:tenant-delete', async (db) => {
    const existing = await findTenantById(db, id);
    if (!existing) throw new NotFoundError('Tenant not found', 'TENANT_NOT_FOUND');

    if (existing.status !== 'SUSPENDED') {
      throw new ConflictError(
        'A client must be archived before it can be permanently deleted',
        'TENANT_NOT_ARCHIVED',
      );
    }

    await prisma.$transaction(async (tx) => {
      // Restrict-guarded children first…
      await tx.invitation.deleteMany({ where: { tenantId: id } });
      await tx.user.deleteMany({ where: { tenantId: id } });
      // …then the tenant, whose assignments/progress/watch cascade with it.
      await tx.tenant.delete({ where: { id } });

      await audit(tx, {
        action: AuditAction.TENANT_DELETED,
        actor: { id: context.userId, email: context.email, role: context.role },
        tenantId: id,
        entityType: AuditEntity.TENANT,
        entityId: id,
        before: { name: existing.name, slug: existing.slug, status: existing.status },
        request: metadataOf(context),
      });
    });
  });
}

export function listTenants(context: RequestContext): Promise<PublicTenant[]> {
  return runAsContext(context, async (db) => {
    const tenants = await selectTenants(db);
    return tenants.map(toPublicTenant);
  });
}

/**
 * A client user reading this can only ever get their own company back: the
 * scope pins `where.id` to their tenant, so a guessed id returns nothing
 * rather than someone else's record.
 */
export function getTenant(context: RequestContext, id: string): Promise<PublicTenant> {
  return runAsContext(context, async (db) => {
    const tenant = await findTenantById(db, id);
    if (!tenant) throw new NotFoundError('Tenant not found', 'TENANT_NOT_FOUND');
    return toPublicTenant(tenant);
  });
}
