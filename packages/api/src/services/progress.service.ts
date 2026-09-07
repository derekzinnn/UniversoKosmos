import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { createScopedDb, runInTenantScope } from '../db/scoped-db.js';
import type { ScopedDb } from '../db/scoped-db.js';
import { BadRequestError, ForbiddenError, NotFoundError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import {
  findAssignedTrackContainingLesson,
  listProgressForLessons,
  recordWatchEvent,
  upsertProgress,
} from '../repositories/progress.repository.js';
import type { RequestContext } from '../types/request-context.js';
import { metadataOf } from '../types/request-context.js';
import { AuditAction, AuditEntity } from './audit.actions.js';
import { audit } from './audit.service.js';
import { emailProvider } from './email/index.js';
import { trackCompletedNotification } from './email/templates.js';
import { applyHeartbeat } from './progress.rules.js';
import type { HeartbeatSettings } from './progress.rules.js';
import { isTrackComplete, lessonsInOrder, nextLessonId, unlockedLessonIds } from './unlock.js';
import type { UnlockModule } from './unlock.js';

/**
 * What a client has watched, and what that entitles them to open next.
 *
 * Two rules do the thinking, and both are pure and separately tested:
 * `progress.rules.ts` decides what a heartbeat is worth, and `unlock.ts`
 * decides what is open. This file only supplies them with facts and writes
 * down what they conclude.
 */

/** The lesson fields this service needs, on top of what the unlock rule needs. */
interface ProgressLesson {
  readonly id: string;
  readonly order: number;
  readonly isRequired: boolean;
  readonly durationSeconds: number | null;
}

export interface LessonProgressView {
  readonly lessonId: string;
  readonly locked: boolean;
  readonly completed: boolean;
  readonly maxPositionSeconds: number;
  readonly totalWatchedSeconds: number;
}

export interface TrackProgressView {
  readonly trackId: string;
  readonly completed: boolean;
  /** Where to send someone who presses "continue". Null when nothing is left. */
  readonly nextLessonId: string | null;
  readonly lessons: readonly LessonProgressView[];
}

export interface HeartbeatResult {
  readonly lessonId: string;
  readonly maxPositionSeconds: number;
  readonly totalWatchedSeconds: number;
  readonly completed: boolean;
  /** True only on the heartbeat that finished it, so the client can celebrate once. */
  readonly justCompleted: boolean;
  readonly trackCompleted: boolean;
  readonly unlockedLessonIds: readonly string[];
}

const heartbeatSettings: HeartbeatSettings = {
  firstHeartbeatAllowanceSeconds: env.HEARTBEAT_INTERVAL_SECONDS,
  maxCreditedPlaybackSpeed: env.MAX_CREDITED_PLAYBACK_SPEED,
  completionRatio: env.LESSON_COMPLETION_RATIO,
};

/**
 * Kosmos staff have no progress and cannot have any.
 *
 * They belong to no tenant, and every progress row carries one. Rather than
 * inventing a tenant for them or leaving the column null, watching is simply
 * not something a staff account does — they preview content instead, through
 * `issuePlayback`. Keeping this a hard edge means "who has watched what" has
 * exactly one kind of answer.
 */
function requireClient(context: RequestContext): string {
  if (context.role === 'SUPERADMIN' || !context.tenantId) {
    throw new ForbiddenError(
      'Kosmos staff accounts do not record progress',
      'STAFF_HAS_NO_PROGRESS',
    );
  }
  return context.tenantId;
}

function toUnlockModules(
  modules: readonly {
    id: string;
    order: number;
    lessons: readonly {
      id: string;
      order: number;
      isRequired: boolean;
      durationSeconds: number | null;
    }[];
  }[],
): UnlockModule<ProgressLesson>[] {
  return modules.map((module) => ({
    id: module.id,
    order: module.order,
    lessons: module.lessons.map((lesson) => ({
      id: lesson.id,
      order: lesson.order,
      isRequired: lesson.isRequired,
      durationSeconds: lesson.durationSeconds,
    })),
  }));
}

/**
 * Load the caller's track, their progress in it, and what that unlocks.
 *
 * The track is reached through TrackAssignment — the guarded side of the
 * relation — so the tenant filter is one the tripwire can actually see. A
 * lesson the caller's company was never given is indistinguishable from a
 * lesson that does not exist, which is the point: a 404 tells an attacker
 * nothing about what other companies were assigned.
 */
async function loadTrackState(db: ScopedDb, userId: string, lessonId: string) {
  const assignment = await findAssignedTrackContainingLesson(db, lessonId);
  if (!assignment) throw new NotFoundError('Lesson not found', 'LESSON_NOT_FOUND');

  const ordered = lessonsInOrder(toUnlockModules(assignment.track.modules));
  const lesson = ordered.find((candidate) => candidate.id === lessonId);

  // The query matched on this lesson, so the track contains it. If this ever
  // fires, the flattening lost a row and every unlock decision is suspect.
  if (!lesson) {
    throw new NotFoundError('Lesson not found', 'LESSON_NOT_FOUND');
  }

  const progressRows = await listProgressForLessons(
    db,
    userId,
    ordered.map((candidate) => candidate.id),
  );

  const completed = new Set(
    progressRows.filter((row) => row.completedAt !== null).map((row) => row.lessonId),
  );

  return { assignment, ordered, lesson, progressRows, completed };
}

/**
 * Record where a player has reached.
 *
 * Called every few seconds while a lesson plays. It writes two rows: one
 * immutable `WatchEvent` for the telemetry Phase 4 aggregates, and one
 * `LessonProgress` upsert holding the running totals. Both in a single
 * transaction with any audit row, so a lesson can never be recorded as
 * finished by a write that later rolled back.
 */
export function recordHeartbeat(
  context: RequestContext,
  lessonId: string,
  positionSeconds: number,
): Promise<HeartbeatResult> {
  const tenantId = requireClient(context);

  return runAsClient(context, async (db) => {
    const { assignment, ordered, lesson, progressRows, completed } = await loadTrackState(
      db,
      context.userId,
      lessonId,
    );

    // Checked on every heartbeat, not only when the player opens. A client
    // that keeps posting after being told no is exactly the case this exists
    // for, and the check costs nothing we have not already loaded.
    if (!unlockedLessonIds(ordered, completed).has(lessonId)) {
      throw new ForbiddenError('This lesson is not unlocked yet', 'LESSON_LOCKED');
    }

    const previous = progressRows.find((row) => row.lessonId === lessonId) ?? null;

    const outcome = applyHeartbeat({
      reportedPositionSeconds: positionSeconds,
      durationSeconds: lesson.durationSeconds,
      previous,
      now: new Date(),
      settings: heartbeatSettings,
    });

    const completedAfter =
      outcome.completedAt === null ? completed : new Set([...completed, lessonId]);

    const trackCompleted = isTrackComplete(ordered, completedAfter);
    const trackWasComplete = isTrackComplete(ordered, completed);

    await prisma.$transaction(async (tx) => {
      const scopedTx = createScopedDb(tx, db.scope);

      await recordWatchEvent(scopedTx, {
        userId: context.userId,
        lessonId,
        tenantId,
        positionSeconds: outcome.positionSeconds,
        ip: context.ip,
        userAgent: context.userAgent,
      });

      await upsertProgress(scopedTx, {
        userId: context.userId,
        lessonId,
        tenantId,
        maxPositionSeconds: outcome.maxPositionSeconds,
        totalWatchedSeconds: outcome.totalWatchedSeconds,
        completedAt: outcome.completedAt,
      });

      if (outcome.justCompleted) {
        await audit(tx, {
          action: AuditAction.LESSON_COMPLETED,
          actor: { id: context.userId, email: context.email, role: context.role },
          tenantId,
          entityType: AuditEntity.LESSON,
          entityId: lessonId,
          after: { totalWatchedSeconds: outcome.totalWatchedSeconds },
          request: metadataOf(context),
        });
      }

      // Only on the transition. Without the `trackWasComplete` guard, every
      // later heartbeat on an already-finished trilha would write another row.
      if (trackCompleted && !trackWasComplete) {
        await audit(tx, {
          action: AuditAction.TRACK_COMPLETED,
          actor: { id: context.userId, email: context.email, role: context.role },
          tenantId,
          entityType: AuditEntity.TRACK,
          entityId: assignment.trackId,
          after: { trackTitle: assignment.track.title, lessonCount: ordered.length },
          request: metadataOf(context),
        });
      }
    });

    // After the commit, best-effort: tell Kosmos a client just finished a
    // whole track. Awaited only for its scoped name lookups; the send itself
    // runs in the background inside the helper.
    if (trackCompleted && !trackWasComplete) {
      await notifyTrackCompleted(db, context, tenantId, assignment.trackId, assignment.track.title);
    }

    return {
      lessonId,
      maxPositionSeconds: outcome.maxPositionSeconds,
      totalWatchedSeconds: outcome.totalWatchedSeconds,
      completed: outcome.completedAt !== null,
      justCompleted: outcome.justCompleted,
      trackCompleted,
      unlockedLessonIds: [...unlockedLessonIds(ordered, completedAfter)],
    };
  });
}

export interface CompleteResult {
  readonly lessonId: string;
  readonly completed: true;
  readonly justCompleted: boolean;
  readonly trackCompleted: boolean;
  readonly nextLessonId: string | null;
  readonly unlockedLessonIds: readonly string[];
}

/**
 * Mark a lesson finished, from the client pressing "concluir" near the end.
 *
 * The button is the explicit version of what the heartbeat does automatically,
 * and it is gated the same way — by watched time, not by position. That is the
 * Phase 2 rule kept intact: reaching the end of the bar is not the same as
 * having watched, and "who finished onboarding" has to survive a dragged
 * scrubber. So a client who genuinely watched can close the lesson with one
 * press even if the last auto-check has not landed yet; a client who skipped
 * to the end is told to keep watching.
 *
 * Idempotent: pressing it on an already-finished lesson just confirms it.
 */
export function markLessonComplete(
  context: RequestContext,
  lessonId: string,
  reportedPositionSeconds: number,
): Promise<CompleteResult> {
  const tenantId = requireClient(context);

  return runAsClient(context, async (db) => {
    const { assignment, ordered, lesson, progressRows, completed } = await loadTrackState(
      db,
      context.userId,
      lessonId,
    );

    if (!unlockedLessonIds(ordered, completed).has(lessonId)) {
      throw new ForbiddenError('This lesson is not unlocked yet', 'LESSON_LOCKED');
    }

    const previous = progressRows.find((row) => row.lessonId === lessonId) ?? null;
    const alreadyDone = previous?.completedAt ?? null;

    // Where the client has reached — the furthest of what it reports now and
    // what earlier heartbeats recorded, clamped to the video length.
    const duration = lesson.durationSeconds;
    const reached = Math.max(
      previous?.maxPositionSeconds ?? 0,
      Math.min(Math.max(reportedPositionSeconds, 0), duration ?? reportedPositionSeconds),
    );

    /**
     * The gate for the explicit button is reaching the end, not watched time.
     *
     * This is a product choice, and a deliberate departure from the automatic
     * completion the heartbeat still does by watched time: pressing "concluir"
     * with the last tenth of the bar left is exactly what Kosmos wants a client
     * to be able to do, even after skipping. Onboarding is not a paid course a
     * viewer games — it is a contract client working through their own setup —
     * so "reached the end" is the right, and the owner's chosen, bar. A lesson
     * whose length is unknown still cannot be closed: there is no "end" to reach.
     */
    if (alreadyDone === null) {
      if (duration === null || reached < duration * heartbeatSettings.completionRatio) {
        throw new BadRequestError(
          'Reach the end of the video before marking the lesson complete',
          'LESSON_NOT_NEAR_END',
        );
      }
    }

    const now = new Date();
    const completedAt = alreadyDone ?? now;
    const justCompleted = alreadyDone === null;

    const completedAfter = new Set([...completed, lessonId]);
    const trackCompleted = isTrackComplete(ordered, completedAfter);
    const trackWasComplete = isTrackComplete(ordered, completed);

    await prisma.$transaction(async (tx) => {
      const scopedTx = createScopedDb(tx, db.scope);

      await upsertProgress(scopedTx, {
        userId: context.userId,
        lessonId,
        tenantId,
        maxPositionSeconds: Math.round(reached),
        totalWatchedSeconds: previous?.totalWatchedSeconds ?? 0,
        completedAt,
      });

      if (justCompleted) {
        await audit(tx, {
          action: AuditAction.LESSON_COMPLETED,
          actor: { id: context.userId, email: context.email, role: context.role },
          tenantId,
          entityType: AuditEntity.LESSON,
          entityId: lessonId,
          after: { via: 'explicit', totalWatchedSeconds: previous?.totalWatchedSeconds ?? 0 },
          request: metadataOf(context),
        });
      }

      if (trackCompleted && !trackWasComplete) {
        await audit(tx, {
          action: AuditAction.TRACK_COMPLETED,
          actor: { id: context.userId, email: context.email, role: context.role },
          tenantId,
          entityType: AuditEntity.TRACK,
          entityId: assignment.trackId,
          after: { trackTitle: assignment.track.title, lessonCount: ordered.length },
          request: metadataOf(context),
        });
      }
    });

    // The explicit "concluir" that closes the last lesson: alert Kosmos, after
    // the commit. Awaited only for its scoped name lookups; the send runs in
    // the background inside the helper.
    if (trackCompleted && !trackWasComplete) {
      await notifyTrackCompleted(db, context, tenantId, assignment.trackId, assignment.track.title);
    }

    return {
      lessonId,
      completed: true,
      justCompleted,
      trackCompleted,
      nextLessonId: nextLessonId(ordered, completedAfter),
      unlockedLessonIds: [...unlockedLessonIds(ordered, completedAfter)],
    };
  });
}

/**
 * The caller's progress through the trilha containing a given lesson.
 *
 * Keyed by lesson rather than by track because that is what the player has in
 * hand, and because reaching the track any other way than through the
 * assignment is the mistake CLAUDE.md warns about.
 */
export function describeTrackProgress(
  context: RequestContext,
  lessonId: string,
): Promise<TrackProgressView> {
  requireClient(context);

  return runAsClient(context, async (db) => {
    const { assignment, ordered, progressRows, completed } = await loadTrackState(
      db,
      context.userId,
      lessonId,
    );

    const unlocked = unlockedLessonIds(ordered, completed);
    const byLesson = new Map(progressRows.map((row) => [row.lessonId, row]));

    return {
      trackId: assignment.trackId,
      completed: isTrackComplete(ordered, completed),
      nextLessonId: nextLessonId(ordered, completed),
      lessons: ordered.map((lesson) => {
        const row = byLesson.get(lesson.id);
        return {
          lessonId: lesson.id,
          locked: !unlocked.has(lesson.id),
          completed: row?.completedAt != null,
          maxPositionSeconds: row?.maxPositionSeconds ?? 0,
          totalWatchedSeconds: row?.totalWatchedSeconds ?? 0,
        };
      }),
    };
  });
}

/**
 * Run pinned to the caller's own tenant.
 *
 * Deliberately not `runAsContext`: that one sends a SUPERADMIN into global
 * scope, which is right for authoring and wrong here. Every function in this
 * file has already refused staff callers, so reaching this with no tenant id
 * would be a bug rather than a case to handle gracefully.
 */
function runAsClient<T>(context: RequestContext, fn: (db: ScopedDb) => Promise<T>): Promise<T> {
  return runInTenantScope(requireClient(context), fn);
}

/**
 * Best-effort internal alert that a client finished a whole track.
 *
 * The names it needs are read here, awaited, because those reads are
 * tenant-scoped and the guard requires the scope to still be active — so the
 * caller must `await` this before its own callback returns. The email *send*,
 * which touches no database, is then fired without awaiting: it must never add
 * latency to the client's completion nor fail it, so a delivery problem is
 * logged, never raised (the same spirit as `auditDetached`).
 */
async function notifyTrackCompleted(
  db: ScopedDb,
  context: RequestContext,
  tenantId: string,
  trackId: string,
  trackTitle: string,
): Promise<void> {
  try {
    const [tenant, user] = await Promise.all([
      db.tenant.findFirst({ where: { id: tenantId } }),
      db.user.findFirst({ where: { id: context.userId } }),
    ]);

    const base = env.WEB_APP_URL.replace(/\/+$/, '');
    const message = trackCompletedNotification({
      to: env.TRACK_COMPLETION_NOTIFY_EMAIL,
      clientName: user?.name ?? 'Cliente',
      clientEmail: context.email ?? user?.email ?? '',
      tenantName: tenant?.name ?? 'Cliente',
      trackTitle,
      drilldownUrl: `${base}/admin/clients/${tenantId}`,
    });

    // The send needs no scope, so let it run in the background — the client's
    // response does not wait on Resend, and a failure only logs.
    void emailProvider()
      .send(message)
      .catch((error: unknown) => {
        logger.error({ error, tenantId, trackId }, 'Failed to send track-completion notification');
      });
  } catch (error) {
    logger.error({ error, tenantId, trackId }, 'Failed to prepare track-completion notification');
  }
}
