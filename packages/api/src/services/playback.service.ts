import { env } from '../config/env.js';
import { runInGlobalScope, runInTenantScope } from '../db/scoped-db.js';
import type { ScopedDb } from '../db/scoped-db.js';
import { ForbiddenError, NotFoundError } from '../lib/errors.js';
import {
  findAssignedTrackContainingLesson,
  listProgressForLessons,
} from '../repositories/progress.repository.js';
import type { RequestContext } from '../types/request-context.js';
import { lessonsInOrder, unlockedLessonIds } from './unlock.js';
import { videoProvider } from './video/index.js';

/**
 * Handing out the right to play one video, for a few minutes.
 *
 * The rule this file exists to enforce: **a client never receives a video
 * id.** They receive a URL that is already signed, already bound to them, and
 * already expiring. That is why `toPublicLesson` has always sent
 * `hasVideo: boolean` instead of `externalVideoId` — if the id reached the
 * browser, everything below would be decoration.
 */

export interface PlaybackTicket {
  readonly lessonId: string;
  readonly url: string;
  readonly expiresAt: string;
  readonly durationSeconds: number | null;
  /** Where this viewer had reached, so the player can offer to resume. */
  readonly resumeAtSeconds: number;
}

/**
 * Deliberately not audited.
 *
 * Every press of play would write a row, and a log that grows with viewing
 * rather than with decisions is a log nobody reads. The telemetry for "who
 * watched what" is `watch_events`, which exists precisely so the audit ledger
 * does not have to carry it. What does get audited is the milestone —
 * `LESSON_COMPLETED` — written by the heartbeat.
 */
export function issuePlayback(context: RequestContext, lessonId: string): Promise<PlaybackTicket> {
  return context.role === 'SUPERADMIN'
    ? issueForStaff(context, lessonId)
    : issueForClient(context, lessonId);
}

/**
 * Kosmos staff previewing their own content.
 *
 * No assignment to check and no unlock rule to apply — staff authored the
 * lesson and are not working through it. The URL is still signed and still
 * short-lived: staff are not a reason to mint a link that outlives the tab.
 */
function issueForStaff(context: RequestContext, lessonId: string): Promise<PlaybackTicket> {
  return runInGlobalScope('superadmin:playback-preview', async (db) => {
    // Lesson carries no tenant column — it is one shared library — so the
    // guard has nothing to check here and reading it directly is correct.
    const lesson = await db.raw.lesson.findUnique({ where: { id: lessonId } });
    if (!lesson) throw new NotFoundError('Lesson not found', 'LESSON_NOT_FOUND');

    const ticket = await mint(context, lesson.id, lesson.externalVideoId, lesson.durationSeconds);
    return { ...ticket, resumeAtSeconds: 0 };
  });
}

function issueForClient(context: RequestContext, lessonId: string): Promise<PlaybackTicket> {
  if (!context.tenantId) {
    // Unreachable: the database CHECK constraint ties a null tenant to
    // SUPERADMIN, and that branch was taken above.
    throw new ForbiddenError('Account has no tenant assigned', 'TENANT_MISSING');
  }

  return runInTenantScope(context.tenantId, async (db: ScopedDb) => {
    const assignment = await findAssignedTrackContainingLesson(db, lessonId);

    // A lesson the caller's company was never given reads as absent rather
    // than forbidden. A 403 here would confirm the lesson exists, which is
    // exactly what somebody probing ids is trying to learn.
    if (!assignment) throw new NotFoundError('Lesson not found', 'LESSON_NOT_FOUND');

    // Lessons hidden from this client are removed from the path, so unlock is
    // computed over what they can actually see and a hidden lesson mints no URL
    // — it 404s like an unassigned one rather than confirming it exists.
    const hiddenLessonIds = new Set(
      (await db.hiddenLesson.findMany({ select: { lessonId: true } })).map((row) => row.lessonId),
    );
    const ordered = lessonsInOrder(
      assignment.track.modules.map((module) => ({
        id: module.id,
        order: module.order,
        lessons: module.lessons.map((lesson) => ({
          id: lesson.id,
          order: lesson.order,
          isRequired: lesson.isRequired,
          durationSeconds: lesson.durationSeconds,
          externalVideoId: lesson.externalVideoId,
        })),
      })),
    ).filter((candidate) => !hiddenLessonIds.has(candidate.id));

    const lesson = ordered.find((candidate) => candidate.id === lessonId);
    if (!lesson) throw new NotFoundError('Lesson not found', 'LESSON_NOT_FOUND');

    const progressRows = await listProgressForLessons(
      db,
      context.userId,
      ordered.map((candidate) => candidate.id),
    );

    const completed = new Set(
      progressRows.filter((row) => row.completedAt !== null).map((row) => row.lessonId),
    );

    // The unlock rule is enforced here, not only in the UI. A locked lesson
    // whose id somebody typed by hand must not mint a playable URL.
    if (!unlockedLessonIds(ordered, completed).has(lessonId)) {
      throw new ForbiddenError('This lesson is not unlocked yet', 'LESSON_LOCKED');
    }

    const ticket = await mint(context, lesson.id, lesson.externalVideoId, lesson.durationSeconds);

    return {
      ...ticket,
      resumeAtSeconds:
        progressRows.find((row) => row.lessonId === lessonId)?.maxPositionSeconds ?? 0,
    };
  });
}

async function mint(
  context: RequestContext,
  lessonId: string,
  videoId: string | null,
  durationSeconds: number | null,
): Promise<Omit<PlaybackTicket, 'resumeAtSeconds'>> {
  if (!videoId) {
    throw new NotFoundError('This lesson has no video attached', 'LESSON_HAS_NO_VIDEO');
  }

  const signed = await videoProvider().signPlaybackUrl(videoId, {
    expiresInSeconds: env.PLAYBACK_URL_TTL_SECONDS,
    viewer: {
      userId: context.userId,
      email: context.email,
      // The provider burns this into the watermark. `name` is not on
      // RequestContext — the token carries identity, not a display name — and
      // the email is what makes a leaked recording traceable anyway.
      name: context.email,
      tenantId: context.tenantId,
      ip: context.ip,
    },
  });

  return {
    lessonId,
    url: signed.url,
    expiresAt: signed.expiresAt.toISOString(),
    durationSeconds,
  };
}
