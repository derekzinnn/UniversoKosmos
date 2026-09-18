import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-error';
import { classroomApi } from '@/lib/classroom-api';
import { contentApi } from '@/lib/content-api';
import type * as ContentApi from '@/lib/content-api';
import { renderWithProviders } from '@/test/render';
import { LessonPage } from './LessonPage';

vi.mock('@/lib/classroom-api', () => ({
  classroomApi: { playback: vi.fn(), progress: vi.fn(), heartbeat: vi.fn(), complete: vi.fn() },
}));

vi.mock('@/lib/content-api', async (importOriginal) => ({
  ...(await importOriginal<typeof ContentApi>()),
  contentApi: { myTracks: vi.fn() },
}));

const playback = vi.mocked(classroomApi.playback);
const progress = vi.mocked(classroomApi.progress);
const complete = vi.mocked(classroomApi.complete);
const myTracks = vi.mocked(contentApi.myTracks);

/** A Panda position update, as it arrives on the window from their player. */
function pandaTime(currentTime: number): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      origin: 'https://player-vz.tv.pandavideo.com.br',
      data: { message: 'panda_timeupdate', currentTime },
    }),
  );
}

function lesson(id: string, title: string, order: number) {
  return {
    id,
    moduleId: 'module-1',
    title,
    description: null,
    order,
    durationSeconds: 600,
    isRequired: true,
    hasVideo: true,
    resources: [],
  };
}

const track = {
  id: 'track-1',
  slug: 'onboarding',
  title: 'Onboarding Kosmos',
  description: null,
  published: true,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  progress: {
    totalLessons: 3,
    completedLessons: 1,
    percent: 33,
    completed: false,
    started: true,
    nextLessonId: 'lesson-2',
  },
  modules: [
    {
      id: 'module-1',
      trackId: 'track-1',
      title: 'Primeiros passos',
      description: null,
      order: 0,
      lessons: [
        lesson('lesson-1', 'Bem-vindo', 0),
        lesson('lesson-2', 'Como funciona', 1),
        lesson('lesson-3', 'Configuração', 2),
      ],
    },
  ],
};

function renderLesson(lessonId = 'lesson-1') {
  return renderWithProviders(
    <Routes>
      <Route path="/aulas/:lessonId" element={<LessonPage />} />
    </Routes>,
    { route: `/aulas/${lessonId}`, auth: { status: 'authenticated' } },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // Theater mode is remembered in localStorage; clear it so one test's choice
  // does not leak into the next (which would hide the outline unexpectedly).
  localStorage.clear();

  // The heartbeat loop flushes a final beat on unmount; give the mock a
  // resolved promise so that `.catch` has something to attach to.
  vi.mocked(classroomApi.heartbeat).mockResolvedValue({
    progress: {
      lessonId: 'lesson-2',
      maxPositionSeconds: 0,
      totalWatchedSeconds: 0,
      completed: false,
      justCompleted: false,
      trackCompleted: false,
      unlockedLessonIds: [],
    },
  });

  myTracks.mockResolvedValue({ tracks: [track] });

  playback.mockResolvedValue({
    playback: {
      lessonId: 'lesson-1',
      url: 'https://video.invalid/signed',
      expiresAt: '2026-08-26T12:10:00.000Z',
      durationSeconds: 600,
      resumeAtSeconds: 0,
    },
  });

  // First done, second is current, third still locked.
  progress.mockResolvedValue({
    progress: {
      trackId: 'track-1',
      completed: false,
      nextLessonId: 'lesson-2',
      lessons: [
        {
          lessonId: 'lesson-1',
          locked: false,
          completed: true,
          maxPositionSeconds: 600,
          totalWatchedSeconds: 600,
        },
        {
          lessonId: 'lesson-2',
          locked: false,
          completed: false,
          maxPositionSeconds: 0,
          totalWatchedSeconds: 0,
        },
        {
          lessonId: 'lesson-3',
          locked: true,
          completed: false,
          maxPositionSeconds: 0,
          totalWatchedSeconds: 0,
        },
      ],
    },
  });
});

describe('LessonPage', () => {
  it('shows the lesson and the trilha it belongs to', async () => {
    renderLesson();

    expect(await screen.findByRole('heading', { name: 'Bem-vindo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Onboarding Kosmos/ })).toBeInTheDocument();
  });

  it('renders the outline with every lesson', async () => {
    renderLesson();

    const outline = await screen.findByRole('navigation', { name: 'Aulas da trilha' });
    expect(within(outline).getByText('Bem-vindo')).toBeInTheDocument();
    expect(within(outline).getByText('Como funciona')).toBeInTheDocument();
    expect(within(outline).getByText('Configuração')).toBeInTheDocument();
  });

  it('makes unlocked lessons navigable and locked ones not', async () => {
    renderLesson();

    const outline = await screen.findByRole('navigation', { name: 'Aulas da trilha' });

    expect(within(outline).getByRole('link', { name: /Como funciona/ })).toHaveAttribute(
      'href',
      '/aulas/lesson-2',
    );

    // The locked one must not be reachable by clicking it.
    expect(within(outline).queryByRole('link', { name: /Configuração/ })).not.toBeInTheDocument();
  });

  it('marks the lesson being watched as the current page', async () => {
    renderLesson('lesson-2');

    const outline = await screen.findByRole('navigation', { name: 'Aulas da trilha' });
    expect(within(outline).getByRole('link', { name: /Como funciona/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('plays the signed URL it was given, in the provider iframe', async () => {
    const { container } = renderLesson();

    await screen.findByRole('heading', { name: 'Bem-vindo' });

    // An iframe, not a <video>: Panda burns the watermark inside its own
    // player, so the URL is loaded in their frame rather than as a media file.
    const frame = container.querySelector('iframe');
    expect(frame).toHaveAttribute('src', 'https://video.invalid/signed');
  });

  it('explains a locked lesson instead of showing a broken player', async () => {
    progress.mockRejectedValue(new ApiError('LESSON_LOCKED', 403, 'locked'));

    renderLesson('lesson-3');

    expect(await screen.findByText('Esta aula ainda não foi liberada')).toBeInTheDocument();
    expect(screen.getByText(/Termine a aula anterior para liberar esta/)).toBeInTheDocument();
    // A locked lesson does not become unlocked by retrying, so no retry button.
    expect(screen.queryByRole('button', { name: 'Tentar novamente' })).not.toBeInTheDocument();
  });

  it('offers a retry when the playback URL could not be minted', async () => {
    playback.mockRejectedValue(new ApiError('LESSON_HAS_NO_VIDEO', 404, 'no video'));

    renderLesson();

    expect(await screen.findByText('Não conseguimos liberar o vídeo')).toBeInTheDocument();
    expect(screen.getByText(/Esta aula ainda não tem vídeo/)).toBeInTheDocument();
  });

  it('says so when the lesson is not in any assigned trilha', async () => {
    myTracks.mockResolvedValue({ tracks: [] });

    renderLesson();

    expect(await screen.findByText('Não encontramos esta aula')).toBeInTheDocument();
  });

  it('renders the lesson description below the video, with clickable links', async () => {
    myTracks.mockResolvedValue({
      tracks: [
        {
          ...track,
          modules: [
            {
              ...track.modules[0]!,
              lessons: [
                {
                  ...track.modules[0]!.lessons[0]!,
                  description: 'Baixe o [material de apoio](https://kosmos.example.com/guia).',
                },
                track.modules[0]!.lessons[1]!,
                track.modules[0]!.lessons[2]!,
              ],
            },
          ],
        },
      ],
    });

    renderLesson('lesson-1');
    await screen.findByRole('heading', { name: 'Bem-vindo' });

    const link = screen.getByRole('link', { name: 'material de apoio' });
    expect(link).toHaveAttribute('href', 'https://kosmos.example.com/guia');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('offers "concluir" only once the video reaches the end, and completes on click', async () => {
    const user = userEvent.setup();
    complete.mockResolvedValue({
      progress: {
        lessonId: 'lesson-2',
        completed: true,
        justCompleted: true,
        trackCompleted: false,
        nextLessonId: 'lesson-3',
        unlockedLessonIds: ['lesson-1', 'lesson-2', 'lesson-3'],
      },
    });

    renderLesson('lesson-2');
    await screen.findByRole('heading', { name: 'Como funciona' });

    // The button is there from the start, but greyed out and unclickable until
    // the video is near the end.
    const button = screen.getByRole('button', { name: /Marcar como concluída/ });
    act(() => pandaTime(120));
    expect(button).toBeDisabled();

    // Into the last tenth of a 600s lesson: it becomes clickable.
    act(() => pandaTime(560));
    expect(button).toBeEnabled();

    await user.click(button);
    // Completes the current lesson, reporting the position it had reached.
    expect(complete).toHaveBeenCalledWith('lesson-2', 560);
    expect(await screen.findByText(/Aula concluída/)).toBeInTheDocument();
  });

  it('toggles theater mode, hiding the outline and remembering the choice', async () => {
    const user = userEvent.setup();
    renderLesson('lesson-2');
    await screen.findByRole('heading', { name: 'Como funciona' });

    // The outline is there by default.
    expect(screen.getByRole('navigation', { name: 'Aulas da trilha' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Modo teatro' }));

    // In theater the outline is gone and the toggle offers the way back; the
    // player itself stays on screen.
    expect(screen.queryByRole('navigation', { name: 'Aulas da trilha' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sair do modo teatro' })).toBeInTheDocument();
    expect(localStorage.getItem('kosmos-theater')).toBe('1');

    await user.click(screen.getByRole('button', { name: 'Sair do modo teatro' }));
    expect(screen.getByRole('navigation', { name: 'Aulas da trilha' })).toBeInTheDocument();
    expect(localStorage.getItem('kosmos-theater')).toBe('0');
  });

  it('opens straight into theater mode when the viewer chose it before', async () => {
    localStorage.setItem('kosmos-theater', '1');

    renderLesson('lesson-2');
    await screen.findByRole('heading', { name: 'Como funciona' });

    expect(screen.queryByRole('navigation', { name: 'Aulas da trilha' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sair do modo teatro' })).toBeInTheDocument();
  });

  /** A single-module track with `count` lessons, for the outline window. */
  function manyLessonTrack(count: number) {
    return {
      ...track,
      modules: [
        {
          ...track.modules[0]!,
          lessons: Array.from({ length: count }, (_, i) => lesson(`lesson-${i + 1}`, `Aula ${i + 1}`, i)),
        },
      ],
    };
  }

  it('shows only the current lesson and the next five, revealing the rest on "carregar mais"', async () => {
    const user = userEvent.setup();
    myTracks.mockResolvedValue({ tracks: [manyLessonTrack(8)] });

    renderLesson('lesson-1');
    const outline = await screen.findByRole('navigation', { name: 'Aulas da trilha' });

    // From lesson 1: lessons 1–6 show, 7 and 8 are held back.
    expect(within(outline).getByText('Aula 6')).toBeInTheDocument();
    expect(within(outline).queryByText('Aula 7')).not.toBeInTheDocument();
    expect(within(outline).queryByText('Aula 8')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Carregar mais 2 aulas/ }));

    expect(within(outline).getByText('Aula 7')).toBeInTheDocument();
    expect(within(outline).getByText('Aula 8')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Carregar mais/ })).not.toBeInTheDocument();
  });

  it('starts the window at the current lesson, holding earlier ones back too', async () => {
    myTracks.mockResolvedValue({ tracks: [manyLessonTrack(8)] });

    renderLesson('lesson-3');
    const outline = await screen.findByRole('navigation', { name: 'Aulas da trilha' });

    // From lesson 3: lessons 3–8 show; 1 and 2 are behind "carregar mais".
    expect(within(outline).queryByText('Aula 1')).not.toBeInTheDocument();
    expect(within(outline).queryByText('Aula 2')).not.toBeInTheDocument();
    expect(within(outline).getByText('Aula 3')).toBeInTheDocument();
    expect(within(outline).getByText('Aula 8')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Carregar mais 2 aulas/ })).toBeInTheDocument();
  });

  it('does not offer "carregar mais" when the whole trilha already fits', async () => {
    myTracks.mockResolvedValue({ tracks: [manyLessonTrack(4)] });

    renderLesson('lesson-1');
    const outline = await screen.findByRole('navigation', { name: 'Aulas da trilha' });

    expect(within(outline).getByText('Aula 4')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Carregar mais/ })).not.toBeInTheDocument();
  });
});
