import { beforeEach, describe, expect, it } from 'vitest';
import { FakeVideoProvider } from '../src/services/video/fake-video-provider.js';
import { setVideoProvider } from '../src/services/video/index.js';
import { api, bearer, loginAs, useCapturingEmails } from './helpers/api.js';
import { readAuditActions } from './helpers/database.js';
import {
  assignTrackToTenant,
  createSuperadmin,
  createTenantWithUsers,
  createTrackWithLessons,
} from './helpers/factories.js';

/**
 * Per-client lesson access — the denylist.
 *
 * A track is one shared library; hiding a lesson is per client. The rules that
 * matter and are proved here: a hidden lesson vanishes from the client's list,
 * 404s on every playback/progress path (server-enforced, not just the UI),
 * drops out of the unlock sequence and the completion count, and one client's
 * hidden set never touches another's.
 */

beforeEach(() => {
  setVideoProvider(new FakeVideoProvider());
  useCapturingEmails();
});

function hide(superToken: string, tenantId: string, lessonId: string, visible: boolean) {
  return api()
    .patch(`/clients/${tenantId}/lessons/${lessonId}/visibility`)
    .set('Authorization', bearer(superToken))
    .send({ visible });
}

async function setup(lessonCount = 3) {
  const { tenant, owner } = await createTenantWithUsers();
  const { track, lessons } = await createTrackWithLessons(lessonCount, { durationSeconds: 50 });
  await assignTrackToTenant(track.id, tenant.id);
  const superToken = await loginAs((await createSuperadmin()).email);
  const ownerToken = await loginAs(owner.email);
  return { tenant, owner, track, lessons, superToken, ownerToken };
}

function lessonIdsIn(body: unknown): string[] {
  const tracks = (body as { tracks: { modules: { lessons: { id: string }[] }[] }[] }).tracks;
  return tracks.flatMap((track) => track.modules.flatMap((m) => m.lessons.map((l) => l.id)));
}

describe('per-client lesson access', () => {
  it('drops a hidden lesson from the client’s track list', async () => {
    const { tenant, lessons, superToken, ownerToken } = await setup(3);

    await hide(superToken, tenant.id, lessons[1]!.id, false).expect(200);

    const response = await api()
      .get('/tracks/mine')
      .set('Authorization', bearer(ownerToken))
      .expect(200);

    const ids = lessonIdsIn(response.body);
    expect(ids).toContain(lessons[0]!.id);
    expect(ids).not.toContain(lessons[1]!.id);
    expect(ids).toContain(lessons[2]!.id);
  });

  it('404s a hidden lesson on every client path', async () => {
    const { tenant, lessons, superToken, ownerToken } = await setup(3);
    await hide(superToken, tenant.id, lessons[1]!.id, false).expect(200);

    const auth = bearer(ownerToken);
    await api().get(`/lessons/${lessons[1]!.id}/playback`).set('Authorization', auth).expect(404);
    await api().get(`/lessons/${lessons[1]!.id}/progress`).set('Authorization', auth).expect(404);
    await api()
      .post(`/lessons/${lessons[1]!.id}/heartbeat`)
      .set('Authorization', auth)
      .send({ positionSeconds: 10 })
      .expect(404);
    await api()
      .post(`/lessons/${lessons[1]!.id}/complete`)
      .set('Authorization', auth)
      .send({ positionSeconds: 48 })
      .expect(404);
  });

  it('removes a hidden lesson from the unlock path and the completion count', async () => {
    const { tenant, lessons, superToken, ownerToken } = await setup(3);
    const auth = bearer(ownerToken);

    // Hide the middle lesson: the visible path is now [1, 3].
    await hide(superToken, tenant.id, lessons[1]!.id, false).expect(200);

    // Finishing lesson 1 must unlock lesson 3 directly, skipping the hidden one.
    await api()
      .post(`/lessons/${lessons[0]!.id}/heartbeat`)
      .set('Authorization', auth)
      .send({ positionSeconds: 50 })
      .expect(200);

    await api().get(`/lessons/${lessons[2]!.id}/playback`).set('Authorization', auth).expect(200);

    // And finishing lessons 1 and 3 completes the whole trilha — the hidden
    // lesson does not stand between the client and 100%.
    const done = await api()
      .post(`/lessons/${lessons[2]!.id}/heartbeat`)
      .set('Authorization', auth)
      .send({ positionSeconds: 50 })
      .expect(200);

    expect(
      (done.body as { progress: { trackCompleted: boolean } }).progress.trackCompleted,
    ).toBe(true);
  });

  it('keeps one client’s hidden set from touching another’s', async () => {
    const { track, lessons } = await createTrackWithLessons(3, { durationSeconds: 50 });

    const a = await createTenantWithUsers('Alfa');
    const b = await createTenantWithUsers('Beta');
    await assignTrackToTenant(track.id, a.tenant.id);
    await assignTrackToTenant(track.id, b.tenant.id);

    const superToken = await loginAs((await createSuperadmin()).email);
    await hide(superToken, a.tenant.id, lessons[1]!.id, false).expect(200);

    const aList = await api()
      .get('/tracks/mine')
      .set('Authorization', bearer(await loginAs(a.owner.email)))
      .expect(200);
    const bList = await api()
      .get('/tracks/mine')
      .set('Authorization', bearer(await loginAs(b.owner.email)))
      .expect(200);

    expect(lessonIdsIn(aList.body)).not.toContain(lessons[1]!.id);
    expect(lessonIdsIn(bList.body)).toContain(lessons[1]!.id);
  });

  it('reports the hidden set in the drill-down and audits the change', async () => {
    const { tenant, lessons, superToken } = await setup(3);

    await hide(superToken, tenant.id, lessons[1]!.id, false).expect(200);

    const drill = await api()
      .get(`/clients/${tenant.id}`)
      .set('Authorization', bearer(superToken))
      .expect(200);
    expect((drill.body as { hiddenLessonIds: string[] }).hiddenLessonIds).toContain(lessons[1]!.id);
    expect(await readAuditActions()).toContain('LESSON_ACCESS_CHANGED');

    // Showing it again clears the row.
    await hide(superToken, tenant.id, lessons[1]!.id, true).expect(200);
    const after = await api()
      .get(`/clients/${tenant.id}`)
      .set('Authorization', bearer(superToken))
      .expect(200);
    expect((after.body as { hiddenLessonIds: string[] }).hiddenLessonIds).not.toContain(
      lessons[1]!.id,
    );
  });

  it('lets only Kosmos staff change a client’s access', async () => {
    const { tenant, lessons, ownerToken } = await setup(3);

    await api()
      .patch(`/clients/${tenant.id}/lessons/${lessons[1]!.id}/visibility`)
      .set('Authorization', bearer(ownerToken))
      .send({ visible: false })
      .expect(403);
  });
});
