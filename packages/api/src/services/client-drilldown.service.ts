import { prisma } from '../db/prisma.js';
import { createScopedDb } from '../db/scoped-db.js';
import { NotFoundError } from '../lib/errors.js';
import {
  findClientTenant,
  listClientAssignedTracks,
  listClientMembers,
  listClientProgress,
} from '../repositories/client-drilldown.repository.js';
import type { RequestContext } from '../types/request-context.js';
import { metadataOf } from '../types/request-context.js';
import { AuditAction, AuditEntity } from './audit.actions.js';
import { audit } from './audit.service.js';
import { runAsSuperadminOnTenant } from './scope.service.js';

export type MemberLessonStatus = 'completed' | 'in_progress';

export interface DrilldownMember {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: string;
  readonly status: string;
  readonly lastLoginAt: string | null;
  readonly lessonsCompleted: number;
  readonly lessonsTotal: number;
  readonly percent: number;
  readonly lastActivityAt: string | null;
}

export interface DrilldownLesson {
  readonly id: string;
  readonly title: string;
  readonly isRequired: boolean;
}

export interface DrilldownModule {
  readonly id: string;
  readonly title: string;
  readonly lessons: DrilldownLesson[];
}

export interface DrilldownTrack {
  readonly id: string;
  readonly title: string;
  readonly published: boolean;
  readonly modules: DrilldownModule[];
}

/** One person's state on one lesson. Absence of a row means "not started". */
export interface DrilldownProgress {
  readonly userId: string;
  readonly lessonId: string;
  readonly status: MemberLessonStatus;
  readonly completedAt: string | null;
}

export interface ClientDrilldown {
  readonly tenant: {
    readonly id: string;
    readonly name: string;
    readonly status: string;
    readonly contractSignedAt: string | null;
    readonly createdAt: string;
  };
  readonly members: DrilldownMember[];
  readonly tracks: DrilldownTrack[];
  /** Sparse: only the (member, lesson) pairs that have any progress at all. */
  readonly progress: DrilldownProgress[];
  /**
   * Lessons this client cannot see — the per-client access denylist. The admin
   * screen shows every lesson and marks these as hidden; a lesson not listed
   * here is visible to the client.
   */
  readonly hiddenLessonIds: string[];
}

/**
 * One client's onboarding, lesson by lesson: who watched what.
 *
 * **This is the audited act.** Opening a named company's data is exactly what
 * `runAsSuperadminOnTenant` records — a `TENANT_SCOPE_OVERRIDDEN` line, once
 * per request, with who, when, from where, and why — and it pins every query
 * inside to that one tenant. The funnel overview stays unaudited because it is
 * staff glancing at everyone; this is staff reaching into one, which is the
 * line worth keeping.
 *
 * The matrix is assembled from a sparse progress list rather than a row per
 * (member × lesson): most cells are "not started", and sending those explicitly
 * would balloon the payload for no information. The client fills the blanks.
 */
export function getClientDrilldown(
  context: RequestContext,
  tenantId: string,
): Promise<ClientDrilldown> {
  return runAsSuperadminOnTenant(context, tenantId, 'client-drilldown', async (db) => {
    const tenant = await findClientTenant(db, tenantId);
    if (!tenant) throw new NotFoundError('Tenant not found', 'TENANT_NOT_FOUND');

    const [members, assignments, progress, hidden] = await Promise.all([
      listClientMembers(db),
      listClientAssignedTracks(db),
      listClientProgress(db),
      db.hiddenLesson.findMany({ select: { lessonId: true } }),
    ]);

    const tracks: DrilldownTrack[] = assignments.map((assignment) => ({
      id: assignment.track.id,
      title: assignment.track.title,
      published: assignment.track.published,
      modules: assignment.track.modules.map((module) => ({
        id: module.id,
        title: module.title,
        lessons: module.lessons.map((lesson) => ({
          id: lesson.id,
          title: lesson.title,
          isRequired: lesson.isRequired,
        })),
      })),
    }));

    // The denominator everyone is measured against: required lessons in the
    // tracks this client was assigned.
    const requiredLessonIds = new Set<string>();
    for (const track of tracks) {
      for (const module of track.modules) {
        for (const lesson of module.lessons) {
          if (lesson.isRequired) requiredLessonIds.add(lesson.id);
        }
      }
    }

    // Fold progress once into per-member tallies and the sparse matrix.
    const completedByUser = new Map<string, number>();
    const lastActivityByUser = new Map<string, Date>();
    const progressOut: DrilldownProgress[] = [];

    for (const row of progress) {
      const last = lastActivityByUser.get(row.userId);
      if (!last || row.updatedAt > last) lastActivityByUser.set(row.userId, row.updatedAt);

      if (row.completedAt && requiredLessonIds.has(row.lessonId)) {
        completedByUser.set(row.userId, (completedByUser.get(row.userId) ?? 0) + 1);
      }

      progressOut.push({
        userId: row.userId,
        lessonId: row.lessonId,
        status: row.completedAt ? 'completed' : 'in_progress',
        completedAt: row.completedAt ? row.completedAt.toISOString() : null,
      });
    }

    const lessonsTotal = requiredLessonIds.size;

    const membersOut: DrilldownMember[] = members.map((member) => {
      const completed = Math.min(completedByUser.get(member.id) ?? 0, lessonsTotal || Infinity);
      const percent = lessonsTotal > 0 ? Math.round((completed / lessonsTotal) * 100) : 0;
      const lastActivity = lastActivityByUser.get(member.id) ?? member.lastLoginAt;

      return {
        id: member.id,
        name: member.name,
        email: member.email,
        role: member.role,
        status: member.status,
        lastLoginAt: member.lastLoginAt ? member.lastLoginAt.toISOString() : null,
        lessonsCompleted: completed,
        lessonsTotal,
        percent,
        lastActivityAt: lastActivity ? lastActivity.toISOString() : null,
      };
    });

    return {
      tenant: {
        id: tenant.id,
        name: tenant.name,
        status: tenant.status,
        contractSignedAt: tenant.contractSignedAt ? tenant.contractSignedAt.toISOString() : null,
        createdAt: tenant.createdAt.toISOString(),
      },
      members: membersOut,
      tracks,
      progress: progressOut,
      hiddenLessonIds: hidden.map((row) => row.lessonId),
    };
  });
}

/**
 * Hide a lesson from, or show it to, one client company.
 *
 * The same audited reach-into-one-tenant as the drill-down, so it runs through
 * `runAsSuperadminOnTenant`, which pins every write to that tenant and records
 * the access. The change itself is a denylist row: hiding creates one (idempotent
 * — a second hide is a no-op), showing deletes it. The write and its audit share
 * one transaction, and the audit fires only on a real transition so repeating an
 * action does not litter the ledger.
 */
export function setClientLessonVisibility(
  context: RequestContext,
  tenantId: string,
  lessonId: string,
  visible: boolean,
): Promise<{ lessonId: string; hidden: boolean }> {
  return runAsSuperadminOnTenant(context, tenantId, 'client-lesson-access', async (db) => {
    const tenant = await findClientTenant(db, tenantId);
    if (!tenant) throw new NotFoundError('Tenant not found', 'TENANT_NOT_FOUND');

    // The lesson must exist; hiding a phantom id would fail the foreign key
    // anyway, and showing one is a no-op we would rather answer honestly.
    const lesson = await db.raw.lesson.findUnique({ where: { id: lessonId } });
    if (!lesson) throw new NotFoundError('Lesson not found', 'LESSON_NOT_FOUND');

    await prisma.$transaction(async (tx) => {
      const scopedTx = createScopedDb(tx, db.scope);

      const changed = visible
        ? (await scopedTx.hiddenLesson.deleteMany({ where: { lessonId } })).count > 0
        : (await scopedTx.hiddenLesson.createMany({ data: [{ lessonId, tenantId }], skipDuplicates: true }))
            .count > 0;

      if (changed) {
        await audit(tx, {
          action: AuditAction.LESSON_ACCESS_CHANGED,
          actor: { id: context.userId, email: context.email, role: context.role },
          tenantId,
          entityType: AuditEntity.LESSON,
          entityId: lessonId,
          after: { hidden: !visible, lessonTitle: lesson.title },
          request: metadataOf(context),
        });
      }
    });

    return { lessonId, hidden: !visible };
  });
}
