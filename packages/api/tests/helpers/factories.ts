import { runInGlobalScope } from '../../src/db/scoped-db.js';
import type { Prisma } from '../../src/generated/prisma/client.js';
import type { Role } from '../../src/generated/prisma/enums.js';
import { hashPassword } from '../../src/lib/password.js';

export const TEST_PASSWORD = 'uma-senha-de-teste-longa';

let counter = 0;
function unique(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}-${Date.now().toString(36)}`;
}

/**
 * Fixtures run in an explicitly named global scope. Building data across
 * several tenants is exactly what the tenant guard is designed to stop, so
 * the tests have to say out loud that they are doing it on purpose.
 */
export function createTenant(overrides: { name?: string; slug?: string } = {}) {
  return runInGlobalScope('system:test-fixture', (db) =>
    db.raw.tenant.create({
      data: {
        name: overrides.name ?? 'Empresa de Teste',
        slug: overrides.slug ?? unique('empresa'),
      },
    }),
  );
}

interface CreateUserOptions {
  readonly tenantId: string | null;
  readonly role: Role;
  readonly email?: string;
  readonly name?: string;
  readonly password?: string;
  readonly status?: 'ACTIVE' | 'SUSPENDED';
}

export function createUser(options: CreateUserOptions): Promise<Prisma.UserModel> {
  return runInGlobalScope('system:test-fixture', async (db) =>
    db.raw.user.create({
      data: {
        tenantId: options.tenantId,
        email: options.email ?? `${unique('user')}@teste.com.br`,
        passwordHash: await hashPassword(options.password ?? TEST_PASSWORD),
        name: options.name ?? 'Usuario de Teste',
        role: options.role,
        status: options.status ?? 'ACTIVE',
      },
    }),
  );
}

/** A tenant with an owner and a member, which most tests need. */
export async function createTenantWithUsers(name = 'Empresa') {
  const tenant = await createTenant({ name });

  const [owner, member] = await Promise.all([
    createUser({ tenantId: tenant.id, role: 'CLIENT_OWNER' }),
    createUser({ tenantId: tenant.id, role: 'CLIENT_MEMBER' }),
  ]);

  return { tenant, owner, member };
}

export function createSuperadmin(): Promise<Prisma.UserModel> {
  return createUser({ tenantId: null, role: 'SUPERADMIN' });
}

/**
 * A published track with one module and one lesson that carries a video, so
 * it satisfies every publish rule. Content is Kosmos-global, so no tenant
 * scope is needed to build it.
 */
export async function createPublishedTrack(title = 'Trilha de Onboarding') {
  return runInGlobalScope('system:test-fixture', async (db) => {
    const track = await db.raw.track.create({
      data: { title, slug: unique('trilha'), published: true },
    });

    const module = await db.raw.module.create({
      data: { trackId: track.id, title: 'Primeiros passos', order: 0 },
    });

    const lesson = await db.raw.lesson.create({
      data: {
        moduleId: module.id,
        title: 'Boas-vindas',
        order: 0,
        externalVideoId: 'external-video-1',
        durationSeconds: 300,
      },
    });

    return { track, module, lesson };
  });
}

/**
 * A published track with several lessons in one module, for exercising the
 * unlock rule — which needs somewhere to walk to.
 *
 * Every lesson carries a video and a duration, so completion is computable.
 * A lesson with no duration can be watched but never closes, and a test built
 * on one would be asserting the wrong thing.
 */
export async function createTrackWithLessons(
  lessonCount = 3,
  options: { published?: boolean; durationSeconds?: number } = {},
) {
  return runInGlobalScope('system:test-fixture', async (db) => {
    const track = await db.raw.track.create({
      data: {
        title: 'Trilha Sequencial',
        slug: unique('trilha'),
        published: options.published ?? true,
      },
    });

    const module = await db.raw.module.create({
      data: { trackId: track.id, title: 'Modulo Unico', order: 0 },
    });

    const lessons = [];
    for (let index = 0; index < lessonCount; index += 1) {
      lessons.push(
        await db.raw.lesson.create({
          data: {
            moduleId: module.id,
            title: `Aula ${String(index + 1)}`,
            order: index,
            externalVideoId: `external-video-${String(index + 1)}`,
            durationSeconds: options.durationSeconds ?? 100,
          },
        }),
      );
    }

    return { track, module, lessons };
  });
}

/**
 * A published track laid out as two modules, each with `lessonsPerModule`
 * required lessons, for exercising the per-module completion transition — the
 * moment an *earlier* module closes while the trilha as a whole is not yet
 * done. Every lesson carries a video and a duration so completion is
 * computable. Returns the lessons grouped by module, in order.
 */
export async function createTrackWithTwoModules(
  lessonsPerModule = 2,
  options: { durationSeconds?: number } = {},
) {
  return runInGlobalScope('system:test-fixture', async (db) => {
    const track = await db.raw.track.create({
      data: { title: 'Trilha de Dois Modulos', slug: unique('trilha'), published: true },
    });

    const modules: { id: string; lessons: Prisma.LessonModel[] }[] = [];
    for (let moduleIndex = 0; moduleIndex < 2; moduleIndex += 1) {
      const module = await db.raw.module.create({
        data: { trackId: track.id, title: `Modulo ${String(moduleIndex + 1)}`, order: moduleIndex },
      });

      const lessons: Prisma.LessonModel[] = [];
      for (let index = 0; index < lessonsPerModule; index += 1) {
        lessons.push(
          await db.raw.lesson.create({
            data: {
              moduleId: module.id,
              title: `M${String(moduleIndex + 1)} Aula ${String(index + 1)}`,
              order: index,
              externalVideoId: unique('external-video'),
              durationSeconds: options.durationSeconds ?? 100,
            },
          }),
        );
      }
      modules.push({ id: module.id, lessons });
    }

    return { track, modules };
  });
}

/** Mark a lesson finished directly, so a test can start from "step 2". */
export function completeLesson(userId: string, lessonId: string, tenantId: string) {
  return runInGlobalScope('system:test-fixture', (db) =>
    db.raw.lessonProgress.create({
      data: {
        userId,
        lessonId,
        tenantId,
        maxPositionSeconds: 100,
        totalWatchedSeconds: 100,
        completedAt: new Date(),
      },
    }),
  );
}

export function assignTrackToTenant(trackId: string, tenantId: string) {
  return runInGlobalScope('system:test-fixture', (db) =>
    db.raw.trackAssignment.create({ data: { trackId, tenantId } }),
  );
}

/** Attach a video id to a lesson, bypassing the API, for a fixture. */
export function updateLessonVideo(lessonId: string, externalVideoId: string) {
  return runInGlobalScope('system:test-fixture', (db) =>
    db.raw.lesson.update({ where: { id: lessonId }, data: { externalVideoId } }),
  );
}
