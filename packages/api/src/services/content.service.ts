import { prisma } from '../db/prisma.js';
import type { DbClient } from '../db/prisma.js';
import type { ResourceType } from '../generated/prisma/enums.js';
import { BadRequestError, ConflictError, NotFoundError } from '../lib/errors.js';
import { slugify, uniqueSlug } from '../lib/slug.js';
import {
  countAssignmentsForTrack,
  listAssignmentsForTrack,
} from '../repositories/assignment.repository.js';
import * as content from '../repositories/content.repository.js';
import type { RequestContext } from '../types/request-context.js';
import { metadataOf } from '../types/request-context.js';
import { AuditAction, AuditEntity } from './audit.actions.js';
import { audit } from './audit.service.js';
import type { PublicTrack } from './content.mapper.js';
import { toAdminLesson, toPublicModule, toPublicTrack } from './content.mapper.js';
import { toPublicTenant, type PublicTenant } from './user.mapper.js';
import { runAsContext } from './scope.service.js';

/**
 * Kosmos-authored course content.
 *
 * Every function here is reachable only by a SUPERADMIN — the route layer
 * enforces that before any of this runs — so they all execute in the global
 * scope that `runAsContext` opens for Kosmos staff. There is no tenant to pin
 * to: this is the shared library, and who may *see* a track is a separate
 * question answered by assignment.service.ts.
 */

// ── Tracks ────────────────────────────────────────────────────────────────

export interface CreateTrackCommand {
  readonly title: string;
  readonly slug?: string | null;
  readonly description?: string | null;
}

export function createTrack(
  context: RequestContext,
  command: CreateTrackCommand,
): Promise<PublicTrack> {
  return runAsContext(context, async (db) => {
    const slug = await resolveSlug(db.raw, command.slug, command.title);

    const track = await prisma.$transaction(async (tx) => {
      const created = await content.createTrack(tx, {
        title: command.title,
        slug,
        description: command.description ?? null,
      });

      await audit(tx, {
        action: AuditAction.TRACK_CREATED,
        actor: { id: context.userId, email: context.email, role: context.role },
        tenantId: null,
        entityType: AuditEntity.TRACK,
        entityId: created.id,
        after: { title: created.title, slug: created.slug },
        request: metadataOf(context),
      });

      return created;
    });

    return toPublicTrack(track);
  });
}

async function resolveSlug(
  client: DbClient,
  requested: string | null | undefined,
  title: string,
): Promise<string> {
  const taken = await content.takenTrackSlugs(client);

  if (requested) {
    // An explicitly chosen slug is never silently altered — a link that was
    // shared and then quietly changed underneath is worse than an error.
    if (taken.has(requested)) {
      throw new ConflictError('A track with this slug already exists', 'TRACK_SLUG_TAKEN');
    }
    return requested;
  }

  return uniqueSlug(slugify(title), taken);
}

export function listTracks(context: RequestContext): Promise<PublicTrack[]> {
  return runAsContext(context, async (db) => {
    const tracks = await content.listTracks(db.raw);

    // One extra query per track would be N+1; counts come back in one pass.
    const [moduleCounts, lessonCounts, assignmentCounts] = await Promise.all([
      db.raw.module.groupBy({ by: ['trackId'], _count: { _all: true } }),
      db.raw.lesson.groupBy({ by: ['moduleId'], _count: { _all: true } }),
      db.raw.trackAssignment.groupBy({ by: ['trackId'], _count: { _all: true } }),
    ]);

    const modules = await db.raw.module.findMany({ select: { id: true, trackId: true } });
    const moduleToTrack = new Map(modules.map((module) => [module.id, module.trackId]));

    const lessonsPerTrack = new Map<string, number>();
    for (const row of lessonCounts) {
      const trackId = moduleToTrack.get(row.moduleId);
      if (!trackId) continue;
      lessonsPerTrack.set(trackId, (lessonsPerTrack.get(trackId) ?? 0) + row._count._all);
    }

    const modulesPerTrack = new Map(moduleCounts.map((row) => [row.trackId, row._count._all]));
    const assignmentsPerTrack = new Map(
      assignmentCounts.map((row) => [row.trackId, row._count._all]),
    );

    return tracks.map((track) => ({
      ...toPublicTrack(track),
      moduleCount: modulesPerTrack.get(track.id) ?? 0,
      lessonCount: lessonsPerTrack.get(track.id) ?? 0,
      assignedTenantCount: assignmentsPerTrack.get(track.id) ?? 0,
    }));
  });
}

export function getTrack(context: RequestContext, trackId: string): Promise<PublicTrack> {
  return runAsContext(context, async (db) => {
    const track = await content.findTrackWithContent(db.raw, trackId);
    if (!track) throw trackNotFound();

    const assignedTenantCount = await countAssignmentsForTrack(db.raw, trackId);

    return toPublicTrack(track, { forAdmin: true, assignedTenantCount });
  });
}

export interface UpdateTrackCommand {
  readonly title?: string;
  readonly description?: string | null;
}

export function updateTrack(
  context: RequestContext,
  trackId: string,
  command: UpdateTrackCommand,
): Promise<PublicTrack> {
  return runAsContext(context, async (db) => {
    const existing = await content.findTrackById(db.raw, trackId);
    if (!existing) throw trackNotFound();

    const track = await prisma.$transaction(async (tx) => {
      const updated = await content.updateTrack(tx, trackId, {
        ...(command.title === undefined ? {} : { title: command.title }),
        ...(command.description === undefined ? {} : { description: command.description }),
      });

      await audit(tx, {
        action: AuditAction.TRACK_UPDATED,
        actor: { id: context.userId, email: context.email, role: context.role },
        tenantId: null,
        entityType: AuditEntity.TRACK,
        entityId: trackId,
        before: { title: existing.title, description: existing.description },
        after: { title: updated.title, description: updated.description },
        request: metadataOf(context),
      });

      return updated;
    });

    return toPublicTrack(track);
  });
}

export function deleteTrack(
  context: RequestContext,
  trackId: string,
  force = false,
): Promise<void> {
  return runAsContext(context, async (db) => {
    const track = await content.findTrackById(db.raw, trackId);
    if (!track) throw trackNotFound();

    // Two guards, both about not destroying something a client can see. `force`
    // (a strong confirm on the web) waives both: the schema then cascades the
    // track's modules, lessons, assignments and all watched progress with it.
    if (!force) {
      if (track.published) {
        throw new ConflictError(
          'Unpublish the track before deleting it',
          'TRACK_PUBLISHED_CANNOT_DELETE',
        );
      }

      const assignments = await countAssignmentsForTrack(db.raw, trackId);
      if (assignments > 0) {
        throw new ConflictError(
          'This track is assigned to at least one client',
          'TRACK_ASSIGNED_CANNOT_DELETE',
        );
      }
    }

    await prisma.$transaction(async (tx) => {
      await content.deleteTrack(tx, trackId);

      await audit(tx, {
        action: AuditAction.TRACK_DELETED,
        actor: { id: context.userId, email: context.email, role: context.role },
        tenantId: null,
        entityType: AuditEntity.TRACK,
        entityId: trackId,
        before: { title: track.title, slug: track.slug, forced: force },
        request: metadataOf(context),
      });
    });
  });
}

// ── Publishing ────────────────────────────────────────────────────────────

export interface PublishProblem {
  readonly code: string;
  readonly message: string;
  readonly entityType?: string;
  readonly entityId?: string;
}

/**
 * What must be true before a client is allowed to see a track.
 *
 * Returns every problem rather than the first, so the admin fixes the whole
 * list in one pass instead of rediscovering it one failure at a time.
 */
export async function findPublishProblems(
  client: DbClient,
  trackId: string,
): Promise<PublishProblem[]> {
  const track = await content.findTrackWithContent(client, trackId);
  if (!track) throw trackNotFound();

  const problems: PublishProblem[] = [];

  if (track.modules.length === 0) {
    problems.push({
      code: 'TRACK_HAS_NO_MODULES',
      message: 'A trilha precisa de pelo menos um módulo.',
    });
  }

  for (const module of track.modules) {
    if (module.lessons.length === 0) {
      problems.push({
        code: 'MODULE_HAS_NO_LESSONS',
        message: `O módulo "${module.title}" não tem nenhuma aula.`,
        entityType: AuditEntity.MODULE,
        entityId: module.id,
      });
    }

    for (const lesson of module.lessons) {
      // A required lesson with no video is a wall the client cannot get past.
      if (lesson.isRequired && !lesson.externalVideoId) {
        problems.push({
          code: 'LESSON_MISSING_VIDEO',
          message: `A aula obrigatória "${lesson.title}" ainda não tem vídeo.`,
          entityType: AuditEntity.LESSON,
          entityId: lesson.id,
        });
      }
    }
  }

  return problems;
}

export function checkTrackReadiness(
  context: RequestContext,
  trackId: string,
): Promise<{ ready: boolean; problems: PublishProblem[] }> {
  return runAsContext(context, async (db) => {
    const problems = await findPublishProblems(db.raw, trackId);
    return { ready: problems.length === 0, problems };
  });
}

export function publishTrack(context: RequestContext, trackId: string): Promise<PublicTrack> {
  return runAsContext(context, async (db) => {
    const problems = await findPublishProblems(db.raw, trackId);

    if (problems.length > 0) {
      throw new BadRequestError(
        'This track is not ready to be published',
        'TRACK_NOT_READY',
        problems,
      );
    }

    const track = await prisma.$transaction(async (tx) => {
      const updated = await content.updateTrack(tx, trackId, { published: true });

      await audit(tx, {
        action: AuditAction.TRACK_PUBLISHED,
        actor: { id: context.userId, email: context.email, role: context.role },
        tenantId: null,
        entityType: AuditEntity.TRACK,
        entityId: trackId,
        after: { title: updated.title },
        request: metadataOf(context),
      });

      return updated;
    });

    return toPublicTrack(track);
  });
}

export function unpublishTrack(context: RequestContext, trackId: string): Promise<PublicTrack> {
  return runAsContext(context, async (db) => {
    const existing = await content.findTrackById(db.raw, trackId);
    if (!existing) throw trackNotFound();

    const track = await prisma.$transaction(async (tx) => {
      const updated = await content.updateTrack(tx, trackId, { published: false });

      await audit(tx, {
        action: AuditAction.TRACK_UNPUBLISHED,
        actor: { id: context.userId, email: context.email, role: context.role },
        tenantId: null,
        entityType: AuditEntity.TRACK,
        entityId: trackId,
        after: { title: updated.title },
        request: metadataOf(context),
      });

      return updated;
    });

    return toPublicTrack(track);
  });
}

// ── Modules ───────────────────────────────────────────────────────────────

export interface ModuleCommand {
  readonly title: string;
  readonly description?: string | null;
}

export function createModule(context: RequestContext, trackId: string, command: ModuleCommand) {
  return runAsContext(context, async (db) => {
    const track = await content.findTrackById(db.raw, trackId);
    if (!track) throw trackNotFound();

    const module = await prisma.$transaction(async (tx) => {
      const created = await content.createModule(tx, {
        trackId,
        title: command.title,
        description: command.description ?? null,
        order: await content.nextModuleOrder(tx, trackId),
      });

      await audit(tx, {
        action: AuditAction.MODULE_CREATED,
        actor: { id: context.userId, email: context.email, role: context.role },
        tenantId: null,
        entityType: AuditEntity.MODULE,
        entityId: created.id,
        after: { trackId, title: created.title, order: created.order },
        request: metadataOf(context),
      });

      return created;
    });

    return toPublicModule(module);
  });
}

export function updateModule(
  context: RequestContext,
  moduleId: string,
  command: Partial<ModuleCommand>,
) {
  return runAsContext(context, async (db) => {
    const existing = await content.findModuleById(db.raw, moduleId);
    if (!existing) throw moduleNotFound();

    const module = await prisma.$transaction(async (tx) => {
      const updated = await content.updateModule(tx, moduleId, {
        ...(command.title === undefined ? {} : { title: command.title }),
        ...(command.description === undefined ? {} : { description: command.description }),
      });

      await audit(tx, {
        action: AuditAction.MODULE_UPDATED,
        actor: { id: context.userId, email: context.email, role: context.role },
        tenantId: null,
        entityType: AuditEntity.MODULE,
        entityId: moduleId,
        before: { title: existing.title },
        after: { title: updated.title },
        request: metadataOf(context),
      });

      return updated;
    });

    return toPublicModule(module);
  });
}

export function deleteModule(
  context: RequestContext,
  moduleId: string,
  force = false,
): Promise<void> {
  return runAsContext(context, async (db) => {
    const module = await content.findModuleById(db.raw, moduleId);
    if (!module) throw moduleNotFound();

    // Deleting a module cascades to its lessons, and lessons cascade to
    // progress. The guard stops a careless click from erasing watched history;
    // `force` is the deliberate override that lets it through anyway.
    if (!force) {
      const watched = await content.countProgressForModule(db.raw, moduleId);
      if (watched > 0) {
        throw new ConflictError(
          'Clients have already started lessons in this module',
          'MODULE_HAS_PROGRESS',
        );
      }
    }

    await prisma.$transaction(async (tx) => {
      await content.deleteModule(tx, moduleId);
      await renumber(tx, 'module', { trackId: module.trackId });

      await audit(tx, {
        action: AuditAction.MODULE_DELETED,
        actor: { id: context.userId, email: context.email, role: context.role },
        tenantId: null,
        entityType: AuditEntity.MODULE,
        entityId: moduleId,
        before: { trackId: module.trackId, title: module.title, forced: force },
        request: metadataOf(context),
      });
    });
  });
}

export function reorderModules(
  context: RequestContext,
  trackId: string,
  orderedIds: readonly string[],
) {
  return runAsContext(context, async (db) => {
    const track = await content.findTrackById(db.raw, trackId);
    if (!track) throw trackNotFound();

    const current = await content.listModules(db.raw, trackId);
    assertSameSet(
      current.map((module) => module.id),
      orderedIds,
      'MODULE_ORDER_MISMATCH',
    );

    await prisma.$transaction(async (tx) => {
      await applyOrder(tx, 'module', orderedIds);

      await audit(tx, {
        action: AuditAction.MODULES_REORDERED,
        actor: { id: context.userId, email: context.email, role: context.role },
        tenantId: null,
        entityType: AuditEntity.TRACK,
        entityId: trackId,
        before: { order: current.map((module) => module.id) },
        after: { order: [...orderedIds] },
        request: metadataOf(context),
      });
    });

    const modules = await content.listModules(db.raw, trackId);
    return modules.map((module) => toPublicModule(module));
  });
}

// ── Lessons ───────────────────────────────────────────────────────────────

export interface LessonCommand {
  readonly title: string;
  readonly description?: string | null;
  readonly externalVideoId?: string | null;
  readonly durationSeconds?: number | null;
  readonly isRequired?: boolean;
}

export function createLesson(context: RequestContext, moduleId: string, command: LessonCommand) {
  return runAsContext(context, async (db) => {
    const module = await content.findModuleById(db.raw, moduleId);
    if (!module) throw moduleNotFound();

    const lesson = await prisma.$transaction(async (tx) => {
      const created = await content.createLesson(tx, {
        moduleId,
        title: command.title,
        description: command.description ?? null,
        externalVideoId: command.externalVideoId ?? null,
        durationSeconds: command.durationSeconds ?? null,
        isRequired: command.isRequired ?? true,
        order: await content.nextLessonOrder(tx, moduleId),
      });

      await audit(tx, {
        action: AuditAction.LESSON_CREATED,
        actor: { id: context.userId, email: context.email, role: context.role },
        tenantId: null,
        entityType: AuditEntity.LESSON,
        entityId: created.id,
        after: { moduleId, title: created.title, order: created.order },
        request: metadataOf(context),
      });

      return created;
    });

    return toAdminLesson(lesson);
  });
}

export function updateLesson(
  context: RequestContext,
  lessonId: string,
  command: Partial<LessonCommand>,
) {
  return runAsContext(context, async (db) => {
    const existing = await content.findLessonById(db.raw, lessonId);
    if (!existing) throw lessonNotFound();

    const lesson = await prisma.$transaction(async (tx) => {
      const updated = await content.updateLesson(tx, lessonId, {
        ...(command.title === undefined ? {} : { title: command.title }),
        ...(command.description === undefined ? {} : { description: command.description }),
        ...(command.externalVideoId === undefined ? {} : { externalVideoId: command.externalVideoId }),
        ...(command.durationSeconds === undefined
          ? {}
          : { durationSeconds: command.durationSeconds }),
        ...(command.isRequired === undefined ? {} : { isRequired: command.isRequired }),
      });

      await audit(tx, {
        action: AuditAction.LESSON_UPDATED,
        actor: { id: context.userId, email: context.email, role: context.role },
        tenantId: null,
        entityType: AuditEntity.LESSON,
        entityId: lessonId,
        before: { title: existing.title, hasVideo: existing.externalVideoId !== null },
        after: { title: updated.title, hasVideo: updated.externalVideoId !== null },
        request: metadataOf(context),
      });

      return updated;
    });

    return toAdminLesson(lesson);
  });
}

export function deleteLesson(
  context: RequestContext,
  lessonId: string,
  force = false,
): Promise<void> {
  return runAsContext(context, async (db) => {
    const lesson = await content.findLessonById(db.raw, lessonId);
    if (!lesson) throw lessonNotFound();

    // The guard protects watched history from a careless click. `force` is the
    // deliberate override (a strong confirm on the web): the DB then cascades
    // the lesson's progress and watch events away with it.
    if (!force) {
      const watched = await content.countProgressForLesson(db.raw, lessonId);
      if (watched > 0) {
        throw new ConflictError('Clients have already started this lesson', 'LESSON_HAS_PROGRESS');
      }
    }

    await prisma.$transaction(async (tx) => {
      await content.deleteLesson(tx, lessonId);
      await renumber(tx, 'lesson', { moduleId: lesson.moduleId });

      await audit(tx, {
        action: AuditAction.LESSON_DELETED,
        actor: { id: context.userId, email: context.email, role: context.role },
        tenantId: null,
        entityType: AuditEntity.LESSON,
        entityId: lessonId,
        before: { moduleId: lesson.moduleId, title: lesson.title, forced: force },
        request: metadataOf(context),
      });
    });
  });
}

export function reorderLessons(
  context: RequestContext,
  moduleId: string,
  orderedIds: readonly string[],
) {
  return runAsContext(context, async (db) => {
    const module = await content.findModuleById(db.raw, moduleId);
    if (!module) throw moduleNotFound();

    const current = await content.listLessons(db.raw, moduleId);
    assertSameSet(
      current.map((lesson) => lesson.id),
      orderedIds,
      'LESSON_ORDER_MISMATCH',
    );

    await prisma.$transaction(async (tx) => {
      await applyOrder(tx, 'lesson', orderedIds);

      await audit(tx, {
        action: AuditAction.LESSONS_REORDERED,
        actor: { id: context.userId, email: context.email, role: context.role },
        tenantId: null,
        entityType: AuditEntity.MODULE,
        entityId: moduleId,
        before: { order: current.map((lesson) => lesson.id) },
        after: { order: [...orderedIds] },
        request: metadataOf(context),
      });
    });

    const lessons = await content.listLessons(db.raw, moduleId);
    return lessons.map((lesson) => toAdminLesson(lesson));
  });
}

// ── Resources ─────────────────────────────────────────────────────────────

export interface ResourceCommand {
  readonly type: ResourceType;
  readonly title: string;
  readonly url: string;
  readonly fileSizeBytes?: number | null;
}

export function createResource(
  context: RequestContext,
  lessonId: string,
  command: ResourceCommand,
) {
  return runAsContext(context, async (db) => {
    const lesson = await content.findLessonById(db.raw, lessonId);
    if (!lesson) throw lessonNotFound();

    const resource = await prisma.$transaction(async (tx) => {
      const created = await content.createResource(tx, {
        lessonId,
        type: command.type,
        title: command.title,
        url: command.url,
        fileSizeBytes: command.fileSizeBytes ?? null,
        order: await content.nextResourceOrder(tx, lessonId),
      });

      await audit(tx, {
        action: AuditAction.RESOURCE_CREATED,
        actor: { id: context.userId, email: context.email, role: context.role },
        tenantId: null,
        entityType: AuditEntity.RESOURCE,
        entityId: created.id,
        after: { lessonId, title: created.title, type: created.type },
        request: metadataOf(context),
      });

      return created;
    });

    return resource;
  });
}

export function deleteResource(context: RequestContext, resourceId: string): Promise<void> {
  return runAsContext(context, async (db) => {
    const resource = await content.findResourceById(db.raw, resourceId);
    if (!resource) throw new NotFoundError('Resource not found', 'RESOURCE_NOT_FOUND');

    await prisma.$transaction(async (tx) => {
      await content.deleteResource(tx, resourceId);

      await audit(tx, {
        action: AuditAction.RESOURCE_DELETED,
        actor: { id: context.userId, email: context.email, role: context.role },
        tenantId: null,
        entityType: AuditEntity.RESOURCE,
        entityId: resourceId,
        before: { lessonId: resource.lessonId, title: resource.title },
        request: metadataOf(context),
      });
    });
  });
}

// ── Assignment listing (Kosmos side) ──────────────────────────────────────

export function listTrackAssignments(
  context: RequestContext,
  trackId: string,
): Promise<PublicTenant[]> {
  return runAsContext(context, async (db) => {
    const track = await content.findTrackById(db.raw, trackId);
    if (!track) throw trackNotFound();

    const assignments = await listAssignmentsForTrack(db.raw, trackId);
    return assignments.map((assignment) => toPublicTenant(assignment.tenant));
  });
}

// ── Ordering internals ────────────────────────────────────────────────────

type OrderedModel = 'module' | 'lesson';

/**
 * Write a new order without ever colliding with the unique constraint.
 *
 * `@@unique([trackId, order])` means two rows in the same parent cannot share
 * a position even for an instant, so moving item 3 to position 1 cannot be a
 * single update — the row already sitting at 1 is in the way. PostgreSQL only
 * defers constraint checks for constraints declared DEFERRABLE, and a Prisma
 * `@@unique` is a plain unique index, which is checked per statement.
 *
 * So this parks every row in negative space first, where nothing can collide
 * because no legitimate position is ever negative, and only then writes the
 * final 0..n-1. Both passes happen in the caller's transaction, so a failure
 * halfway leaves the original order untouched.
 */
async function applyOrder(
  tx: DbClient,
  model: OrderedModel,
  orderedIds: readonly string[],
): Promise<void> {
  // Branching per model rather than holding a delegate in a variable: the two
  // Prisma delegates have incompatible generic signatures, so their union is
  // not callable.
  const write = async (id: string, order: number): Promise<void> => {
    if (model === 'module') {
      await tx.module.update({ where: { id }, data: { order } });
    } else {
      await tx.lesson.update({ where: { id }, data: { order } });
    }
  };

  // Pass one: park everything in negative space, where nothing can collide.
  for (const [index, id] of orderedIds.entries()) {
    await write(id, -(index + 1));
  }

  // Pass two: every row is now negative, so 0..n-1 is free.
  for (const [index, id] of orderedIds.entries()) {
    await write(id, index);
  }
}

/**
 * Close the gap left by a deletion, so positions stay 0..n-1.
 *
 * Without this, deleting the middle of three items leaves 0 and 2, and the
 * next thing appended lands at 3 — harmless to the database, confusing to
 * anyone reading the rows, and a trap for code that assumes contiguity.
 */
async function renumber(
  tx: DbClient,
  model: OrderedModel,
  parent: { trackId?: string; moduleId?: string },
): Promise<void> {
  if (model === 'module') {
    const rows = await tx.module.findMany({
      where: { trackId: parent.trackId as string },
      orderBy: { order: 'asc' },
      select: { id: true },
    });
    await applyOrder(
      tx,
      'module',
      rows.map((row) => row.id),
    );
    return;
  }

  const rows = await tx.lesson.findMany({
    where: { moduleId: parent.moduleId as string },
    orderBy: { order: 'asc' },
    select: { id: true },
  });
  await applyOrder(
    tx,
    'lesson',
    rows.map((row) => row.id),
  );
}

/**
 * A reorder must name exactly the children that exist — no more, no fewer, and
 * nothing borrowed from another parent. Anything else means the client's view
 * is stale, and applying it would silently drop or steal an item.
 */
function assertSameSet(
  actual: readonly string[],
  requested: readonly string[],
  code: string,
): void {
  const actualSet = new Set(actual);
  const requestedSet = new Set(requested);

  const sameSize = actualSet.size === requestedSet.size && requested.length === requestedSet.size;
  const sameMembers = sameSize && [...requestedSet].every((id) => actualSet.has(id));

  if (!sameMembers) {
    throw new BadRequestError('The requested order does not match the items that exist', code, {
      expected: [...actualSet],
      received: [...requested],
    });
  }
}

function trackNotFound(): NotFoundError {
  return new NotFoundError('Track not found', 'TRACK_NOT_FOUND');
}

function moduleNotFound(): NotFoundError {
  return new NotFoundError('Module not found', 'MODULE_NOT_FOUND');
}

function lessonNotFound(): NotFoundError {
  return new NotFoundError('Lesson not found', 'LESSON_NOT_FOUND');
}
