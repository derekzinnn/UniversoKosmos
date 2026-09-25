import { prisma } from '../db/prisma.js';
import { createScopedDb } from '../db/scoped-db.js';
import { ConflictError, NotFoundError } from '../lib/errors.js';
import {
  createAssignment,
  findAssignment,
  listAssignedTracks,
  removeAssignment,
} from '../repositories/assignment.repository.js';
import { findTrackById } from '../repositories/content.repository.js';
import { listProgressForLessons } from '../repositories/progress.repository.js';
import { findTenantById } from '../repositories/tenant.repository.js';
import type { RequestContext } from '../types/request-context.js';
import { metadataOf } from '../types/request-context.js';
import { AuditAction, AuditEntity } from './audit.actions.js';
import { audit } from './audit.service.js';
import type { PublicTrack } from './content.mapper.js';
import { toPublicTrack } from './content.mapper.js';
import { isTrackComplete, lessonsInOrder, nextLessonId } from './unlock.js';
import { runAsContext, runAsSuperadminOnTenant } from './scope.service.js';

/**
 * Who is allowed to see which track.
 *
 * Assigning is the moment Kosmos-authored content becomes visible to one named
 * client, so it runs through `runAsSuperadminOnTenant` — the scope override is
 * explicit, and the audit log records which staff member opened which client's
 * door and when.
 */

export function assignTrack(
  context: RequestContext,
  trackId: string,
  tenantId: string,
): Promise<void> {
  return runAsSuperadminOnTenant(context, tenantId, 'track:assign', async (db) => {
    const track = await findTrackById(db.raw, trackId);
    if (!track) throw new NotFoundError('Track not found', 'TRACK_NOT_FOUND');

    const tenant = await findTenantById(db, tenantId);
    if (!tenant) throw new NotFoundError('Tenant not found', 'TENANT_NOT_FOUND');

    const existing = await findAssignment(db, trackId, tenantId);
    if (existing) {
      throw new ConflictError('This track is already assigned to that client', 'ALREADY_ASSIGNED');
    }

    await prisma.$transaction(async (tx) => {
      const scopedTx = createScopedDb(tx, db.scope);

      await createAssignment(scopedTx, {
        trackId,
        tenantId,
        assignedByUserId: context.userId,
      });

      await audit(tx, {
        action: AuditAction.TRACK_ASSIGNED,
        actor: { id: context.userId, email: context.email, role: context.role },
        tenantId,
        entityType: AuditEntity.TRACK_ASSIGNMENT,
        entityId: trackId,
        after: { trackId, trackTitle: track.title, tenantName: tenant.name },
        request: metadataOf(context),
      });
    });
  });
}

export function unassignTrack(
  context: RequestContext,
  trackId: string,
  tenantId: string,
): Promise<void> {
  return runAsSuperadminOnTenant(context, tenantId, 'track:unassign', async (db) => {
    const track = await findTrackById(db.raw, trackId);
    if (!track) throw new NotFoundError('Track not found', 'TRACK_NOT_FOUND');

    await prisma.$transaction(async (tx) => {
      const scopedTx = createScopedDb(tx, db.scope);

      const removed = await removeAssignment(scopedTx, trackId, tenantId);
      if (!removed) {
        throw new NotFoundError('This track is not assigned to that client', 'NOT_ASSIGNED');
      }

      await audit(tx, {
        action: AuditAction.TRACK_UNASSIGNED,
        actor: { id: context.userId, email: context.email, role: context.role },
        tenantId,
        entityType: AuditEntity.TRACK_ASSIGNMENT,
        entityId: trackId,
        before: { trackId, trackTitle: track.title },
        request: metadataOf(context),
      });
    });
  });
}

/**
 * The tracks the caller's own company can actually see.
 *
 * Read through TrackAssignment, which carries the tenant column, so the guard
 * checks the filter. Published-only: an unpublished track is a draft, and a
 * client landing in a half-authored trilha is worse than seeing nothing.
 *
 * Kosmos staff have no tenant of their own, so this returns nothing for them —
 * they use the authoring endpoints instead. That is deliberate rather than an
 * oversight: it keeps "what a client sees" a question with exactly one answer.
 */
/**
 * A client's trilha, with how far through it they are.
 *
 * Progress is counted over *required* lessons only, matching the completion
 * rule: an optional extra never stands between a client and 100%. `percent` is
 * that fraction rounded, `nextLesson` is where "continuar" should go, and
 * `started` is whether they have any watch history at all — the difference
 * between "Em andamento" and a fresh trilha the classroom has not touched yet.
 */
export interface TrackProgressSummary {
  readonly totalLessons: number;
  readonly completedLessons: number;
  readonly percent: number;
  readonly completed: boolean;
  readonly started: boolean;
  readonly nextLessonId: string | null;
}

export interface MyTrack extends PublicTrack {
  readonly progress: TrackProgressSummary;
}

export function listMyTracks(context: RequestContext): Promise<MyTrack[]> {
  return runAsContext(context, async (db) => {
    if (context.role === 'SUPERADMIN') return [];

    const assignments = await listAssignedTracks(db);

    // The per-client access denylist: lessons this tenant should not see are
    // removed from every track before anything is counted or returned, and a
    // module left with no visible lesson is dropped so no empty heading shows.
    const hiddenLessonIds = new Set(
      (await db.hiddenLesson.findMany({ select: { lessonId: true } })).map((row) => row.lessonId),
    );
    const tracks = assignments.map((assignment) => ({
      ...assignment.track,
      modules: (assignment.track.modules ?? [])
        .map((module) => ({
          ...module,
          lessons: module.lessons.filter((lesson) => !hiddenLessonIds.has(lesson.id)),
        }))
        .filter((module) => module.lessons.length > 0),
    }));

    // One progress query for every lesson across every trilha, rather than one
    // per track: the classroom already proved these rows are cheap to read.
    const allLessonIds = tracks.flatMap((track) =>
      (track.modules ?? []).flatMap((module) => module.lessons.map((lesson) => lesson.id)),
    );
    const progressRows = await listProgressForLessons(db, context.userId, allLessonIds);
    const completed = new Set(
      progressRows.filter((row) => row.completedAt !== null).map((row) => row.lessonId),
    );
    const started = new Set(progressRows.map((row) => row.lessonId));

    return tracks.map((track) => {
      const ordered = lessonsInOrder(
        (track.modules ?? []).map((module) => ({
          id: module.id,
          order: module.order,
          lessons: module.lessons.map((lesson) => ({
            id: lesson.id,
            order: lesson.order,
            isRequired: lesson.isRequired,
          })),
        })),
      );

      const required = ordered.filter((lesson) => lesson.isRequired);
      const doneRequired = required.filter((lesson) => completed.has(lesson.id)).length;
      const percent =
        required.length === 0 ? 0 : Math.round((doneRequired / required.length) * 100);

      return {
        ...toPublicTrack(track, { forAdmin: false }),
        progress: {
          totalLessons: required.length,
          completedLessons: doneRequired,
          percent,
          completed: isTrackComplete(ordered, completed),
          started: ordered.some((lesson) => started.has(lesson.id)),
          nextLessonId: nextLessonId(ordered, completed),
        },
      };
    });
  });
}
