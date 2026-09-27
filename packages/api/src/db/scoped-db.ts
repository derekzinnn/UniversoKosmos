import type { Prisma } from '../generated/prisma/client.js';
import type { DbClient } from './prisma.js';
import { prisma } from './prisma.js';
import type { GlobalScopeReason, TenantScope } from './tenant-scope.js';
import { withGlobalScope, withTenantScope } from './tenant-scope.js';

/**
 * A database handle that already knows whose data it is allowed to touch.
 *
 * Callers never write `where: { tenantId }` themselves. The filter is merged
 * in *after* whatever the caller passed, so passing a different tenantId does
 * not override it — it is silently replaced with the correct one, and the
 * tripwire in tenant-guard.ts fails the query if anything slips past.
 */
export interface ScopedDb {
  readonly scope: TenantScope;
  /**
   * Escape hatch for models that carry no tenant column (refresh tokens,
   * password resets, Kosmos-authored content). Still subject to the guard.
   */
  readonly raw: DbClient;

  readonly tenant: {
    findFirst(args?: Prisma.TenantFindFirstArgs): Promise<Prisma.TenantModel | null>;
    findMany(args?: Prisma.TenantFindManyArgs): Promise<Prisma.TenantModel[]>;
    count(args?: Prisma.TenantCountArgs): Promise<number>;
  };

  readonly user: {
    findFirst(args?: Prisma.UserFindFirstArgs): Promise<Prisma.UserModel | null>;
    findMany(args?: Prisma.UserFindManyArgs): Promise<Prisma.UserModel[]>;
    count(args?: Prisma.UserCountArgs): Promise<number>;
    create(data: Prisma.UserUncheckedCreateInput): Promise<Prisma.UserModel>;
    update(args: Prisma.UserUpdateArgs): Promise<Prisma.UserModel>;
    updateMany(args: Prisma.UserUpdateManyArgs): Promise<{ count: number }>;
  };

  readonly invitation: {
    findFirst(args?: Prisma.InvitationFindFirstArgs): Promise<Prisma.InvitationModel | null>;
    findMany(args?: Prisma.InvitationFindManyArgs): Promise<Prisma.InvitationModel[]>;
    count(args?: Prisma.InvitationCountArgs): Promise<number>;
    create(data: Prisma.InvitationUncheckedCreateInput): Promise<Prisma.InvitationModel>;
    update(args: Prisma.InvitationUpdateArgs): Promise<Prisma.InvitationModel>;
    updateMany(args: Prisma.InvitationUpdateManyArgs): Promise<{ count: number }>;
  };

  /**
   * The bridge between Kosmos-authored content and a client company.
   *
   * Track, Module, Lesson and Resource carry no tenant column — they are one
   * shared library, not a copy per client — so the guard cannot check them.
   * TrackAssignment is the piece that does carry tenancy, and reading a
   * client's tracks *through it* is what keeps the guard in the loop.
   *
   * Read CLAUDE.md → "Known limits" before writing the mirror-image query
   * (`track.findMany({ where: { assignments: { some: { tenantId } } } })`).
   * Prisma reports that as a single operation on an unscoped model, so the
   * tripwire never sees the tenant filter and cannot tell you if you forgot it.
   */
  readonly trackAssignment: {
    findFirst(
      args?: Prisma.TrackAssignmentFindFirstArgs,
    ): Promise<Prisma.TrackAssignmentModel | null>;
    /**
     * Generic over its arguments so an `include` still types the result.
     * The flat-model signature used elsewhere in this file is fine for
     * scalar reads, but it would throw away the joined `track` payload that
     * the client-facing listing depends on.
     */
    findMany<T extends Prisma.TrackAssignmentFindManyArgs>(
      args?: Prisma.SelectSubset<T, Prisma.TrackAssignmentFindManyArgs>,
    ): Promise<Prisma.TrackAssignmentGetPayload<T>[]>;
    count(args?: Prisma.TrackAssignmentCountArgs): Promise<number>;
    create(data: Prisma.TrackAssignmentUncheckedCreateInput): Promise<Prisma.TrackAssignmentModel>;
    deleteMany(args: Prisma.TrackAssignmentDeleteManyArgs): Promise<{ count: number }>;
  };

  /**
   * What one person has watched of one lesson.
   *
   * `upsert` is the primitive a heartbeat needs. Two players reporting at the
   * same instant would race a find-then-create straight into a duplicate-key
   * error on `@@unique([userId, lessonId])`; PostgreSQL settles that contest
   * and application code cannot. There is no delete: erasing what somebody
   * watched is not a thing this service does.
   */
  readonly lessonProgress: {
    findFirst(
      args?: Prisma.LessonProgressFindFirstArgs,
    ): Promise<Prisma.LessonProgressModel | null>;
    findMany(args?: Prisma.LessonProgressFindManyArgs): Promise<Prisma.LessonProgressModel[]>;
    count(args?: Prisma.LessonProgressCountArgs): Promise<number>;
    upsert(args: Prisma.LessonProgressUpsertArgs): Promise<Prisma.LessonProgressModel>;
  };

  /**
   * Raw telemetry: one row per heartbeat, never revisited.
   *
   * Create and read only. A watch event is evidence that something happened,
   * and the aggregate that anybody actually queries lives in LessonProgress —
   * which is why this table can grow without bound and why its id is a BigInt
   * sequence rather than a UUID.
   */
  readonly watchEvent: {
    create(data: Prisma.WatchEventUncheckedCreateInput): Promise<Prisma.WatchEventModel>;
    findMany(args?: Prisma.WatchEventFindManyArgs): Promise<Prisma.WatchEventModel[]>;
    count(args?: Prisma.WatchEventCountArgs): Promise<number>;
  };

  /**
   * Which lessons are hidden from this tenant — the per-client access denylist.
   *
   * A row means "this lesson does not exist for this client". The client reads
   * it to filter their own path; staff write it (scoped to the one tenant they
   * are configuring). `createMany` and `deleteMany` are the primitives the
   * "set the whole track's access at once" operation needs.
   */
  readonly hiddenLesson: {
    findMany(args?: Prisma.HiddenLessonFindManyArgs): Promise<Prisma.HiddenLessonModel[]>;
    count(args?: Prisma.HiddenLessonCountArgs): Promise<number>;
    create(data: Prisma.HiddenLessonUncheckedCreateInput): Promise<Prisma.HiddenLessonModel>;
    createMany(args: Prisma.HiddenLessonCreateManyArgs): Promise<{ count: number }>;
    deleteMany(args: Prisma.HiddenLessonDeleteManyArgs): Promise<{ count: number }>;
  };
}

export function createScopedDb(client: DbClient, scope: TenantScope): ScopedDb {
  // In global scope both filters are empty objects, so spreading them changes
  // nothing and the caller's own clauses stand.
  const byTenantId = scope.kind === 'tenant' ? { tenantId: scope.tenantId } : {};
  const byId = scope.kind === 'tenant' ? { id: scope.tenantId } : {};

  /** True when a caller named a tenant id that this scope cannot see. */
  const asksForAnotherTenant = (requestedId: unknown): boolean =>
    scope.kind === 'tenant' && typeof requestedId === 'string' && requestedId !== scope.tenantId;

  return {
    scope,
    raw: client,

    /**
     * Tenant is the one model whose scope field is also its primary key, and
     * that makes plain overriding the wrong move. Merging `id` last would turn
     * "show me tenant B" into "show me tenant A" and answer 200 with the
     * caller's own record — no data leaks, but the API lies about which record
     * it returned. Asking for a tenant you cannot see must read as absent, so
     * a conflicting id short-circuits to empty and the caller gets a 404.
     */
    tenant: {
      findFirst: (args = {}) =>
        asksForAnotherTenant(args.where?.id)
          ? Promise.resolve(null)
          : client.tenant.findFirst({ ...args, where: { ...args.where, ...byId } }),
      findMany: (args = {}) =>
        asksForAnotherTenant(args.where?.id)
          ? Promise.resolve([])
          : client.tenant.findMany({ ...args, where: { ...args.where, ...byId } }),
      count: (args = {}) =>
        asksForAnotherTenant(args.where?.id)
          ? Promise.resolve(0)
          : client.tenant.count({ ...args, where: { ...args.where, ...byId } }),
    },

    user: {
      findFirst: (args = {}) =>
        client.user.findFirst({ ...args, where: { ...args.where, ...byTenantId } }),
      findMany: (args = {}) =>
        client.user.findMany({ ...args, where: { ...args.where, ...byTenantId } }),
      count: (args = {}) => client.user.count({ ...args, where: { ...args.where, ...byTenantId } }),
      create: (data) => client.user.create({ data: { ...data, ...byTenantId } }),
      update: (args) => client.user.update({ ...args, where: { ...args.where, ...byTenantId } }),
      updateMany: (args) =>
        client.user.updateMany({ ...args, where: { ...args.where, ...byTenantId } }),
    },

    invitation: {
      findFirst: (args = {}) =>
        client.invitation.findFirst({ ...args, where: { ...args.where, ...byTenantId } }),
      findMany: (args = {}) =>
        client.invitation.findMany({ ...args, where: { ...args.where, ...byTenantId } }),
      count: (args = {}) =>
        client.invitation.count({ ...args, where: { ...args.where, ...byTenantId } }),
      create: (data) => client.invitation.create({ data: { ...data, ...byTenantId } }),
      update: (args) =>
        client.invitation.update({ ...args, where: { ...args.where, ...byTenantId } }),
      updateMany: (args) =>
        client.invitation.updateMany({ ...args, where: { ...args.where, ...byTenantId } }),
    },

    trackAssignment: {
      findFirst: (args = {}) =>
        client.trackAssignment.findFirst({ ...args, where: { ...args.where, ...byTenantId } }),
      findMany: ((args: Prisma.TrackAssignmentFindManyArgs = {}) =>
        client.trackAssignment.findMany({
          ...args,
          where: { ...args.where, ...byTenantId },
        })) as ScopedDb['trackAssignment']['findMany'],
      count: (args = {}) =>
        client.trackAssignment.count({ ...args, where: { ...args.where, ...byTenantId } }),
      create: (data) => client.trackAssignment.create({ data: { ...data, ...byTenantId } }),
      deleteMany: (args) =>
        client.trackAssignment.deleteMany({ ...args, where: { ...args.where, ...byTenantId } }),
    },

    lessonProgress: {
      findFirst: (args = {}) =>
        client.lessonProgress.findFirst({ ...args, where: { ...args.where, ...byTenantId } }),
      findMany: (args = {}) =>
        client.lessonProgress.findMany({ ...args, where: { ...args.where, ...byTenantId } }),
      count: (args = {}) =>
        client.lessonProgress.count({ ...args, where: { ...args.where, ...byTenantId } }),
      // Both halves are pinned: `where` so the lookup cannot find another
      // tenant's row, `create` so the insert cannot write one. The guard
      // checks exactly these two for an upsert.
      upsert: (args) =>
        client.lessonProgress.upsert({
          ...args,
          where: { ...args.where, ...byTenantId },
          create: { ...args.create, ...byTenantId } as Prisma.LessonProgressUncheckedCreateInput,
        }),
    },

    watchEvent: {
      create: (data) => client.watchEvent.create({ data: { ...data, ...byTenantId } }),
      findMany: (args = {}) =>
        client.watchEvent.findMany({ ...args, where: { ...args.where, ...byTenantId } }),
      count: (args = {}) =>
        client.watchEvent.count({ ...args, where: { ...args.where, ...byTenantId } }),
    },

    hiddenLesson: {
      findMany: (args = {}) =>
        client.hiddenLesson.findMany({ ...args, where: { ...args.where, ...byTenantId } }),
      count: (args = {}) =>
        client.hiddenLesson.count({ ...args, where: { ...args.where, ...byTenantId } }),
      create: (data) => client.hiddenLesson.create({ data: { ...data, ...byTenantId } }),
      // Every row in the batch is pinned to the active tenant, so the guard's
      // per-row data check passes and no row can be written for another tenant.
      createMany: (args) =>
        client.hiddenLesson.createMany({
          ...args,
          data: (Array.isArray(args.data) ? args.data : [args.data]).map((row) => ({
            ...row,
            ...byTenantId,
          })) as Prisma.HiddenLessonCreateManyInput[],
        }),
      deleteMany: (args) =>
        client.hiddenLesson.deleteMany({ ...args, where: { ...args.where, ...byTenantId } }),
    },
  };
}

/** Run `fn` pinned to one tenant, with a matching ScopedDb. */
export function runInTenantScope<T>(
  tenantId: string,
  fn: (db: ScopedDb) => Promise<T>,
  client: DbClient = prisma,
): Promise<T> {
  return withTenantScope(tenantId, () => fn(createScopedDb(client, { kind: 'tenant', tenantId })));
}

/** Run `fn` with tenant isolation lifted, for a named and justified reason. */
export function runInGlobalScope<T>(
  reason: GlobalScopeReason,
  fn: (db: ScopedDb) => Promise<T>,
  client: DbClient = prisma,
): Promise<T> {
  return withGlobalScope(reason, () => fn(createScopedDb(client, { kind: 'global', reason })));
}
