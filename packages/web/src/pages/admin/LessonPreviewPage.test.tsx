import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { classroomApi } from '@/lib/classroom-api';
import { contentApi } from '@/lib/content-api';
import type * as ContentApi from '@/lib/content-api';
import { renderWithProviders } from '@/test/render';
import { LessonPreviewPage } from './LessonPreviewPage';

vi.mock('@/lib/classroom-api', () => ({
  classroomApi: { playback: vi.fn(), progress: vi.fn(), heartbeat: vi.fn() },
}));

vi.mock('@/lib/content-api', async (importOriginal) => ({
  ...(await importOriginal<typeof ContentApi>()),
  contentApi: { getTrack: vi.fn() },
}));

const getTrack = vi.mocked(contentApi.getTrack);
const playback = vi.mocked(classroomApi.playback);

function lesson(id: string, title: string, order: number, hasVideo: boolean) {
  return {
    id,
    moduleId: 'm1',
    title,
    description: null,
    order,
    durationSeconds: 600,
    isRequired: true,
    hasVideo,
    resources: [],
  };
}

function renderPreview() {
  return renderWithProviders(
    <Routes>
      <Route path="/admin/tracks/:trackId/preview" element={<LessonPreviewPage />} />
    </Routes>,
    { route: '/admin/tracks/track-1/preview', auth: { status: 'authenticated' } },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getTrack.mockResolvedValue({
    track: {
      id: 'track-1',
      slug: 'onboarding',
      title: 'Onboarding',
      description: null,
      published: false,
      createdAt: '',
      updatedAt: '',
      modules: [
        {
          id: 'm1',
          trackId: 'track-1',
          title: 'Introdução',
          description: null,
          order: 0,
          lessons: [
            lesson('l1', 'Sem vídeo ainda', 0, false),
            lesson('l2', 'Aula com vídeo', 1, true),
          ],
        },
      ],
    },
  });
  playback.mockResolvedValue({
    playback: {
      lessonId: 'l2',
      url: 'https://player-vz.tv.pandavideo.com.br/embed/?v=abc&watermark=jwt',
      expiresAt: '2099-01-01T00:00:00.000Z',
      durationSeconds: 600,
      resumeAtSeconds: 0,
    },
  });
});

describe('LessonPreviewPage', () => {
  it('says clearly that this is a staff preview', async () => {
    renderPreview();
    expect(await screen.findByText(/Pré-visualização da equipe Kosmos/)).toBeInTheDocument();
  });

  it('opens on the first lesson that actually has a video', async () => {
    renderPreview();

    // l2 has the video, so playback is requested for it and the iframe loads.
    const frame = await screen.findByTitle('Aula com vídeo');
    expect(playback).toHaveBeenCalledWith('l2');
    expect(frame).toHaveAttribute('src', expect.stringContaining('pandavideo.com.br'));
  });

  it('lists every lesson, playable or not, to navigate freely', async () => {
    renderPreview();
    const outline = await screen.findByRole('navigation', { name: 'Aulas da trilha' });
    expect(within(outline).getByText('Sem vídeo ainda')).toBeInTheDocument();
    expect(within(outline).getByText('Aula com vídeo')).toBeInTheDocument();
  });

  it('shows a placeholder, not a broken player, for a lesson with no video', async () => {
    const user = userEvent.setup();
    renderPreview();

    const outline = await screen.findByRole('navigation', { name: 'Aulas da trilha' });
    await user.click(within(outline).getByRole('button', { name: /Sem vídeo ainda/ }));

    expect(await screen.findByText('Esta aula ainda não tem vídeo')).toBeInTheDocument();
  });

  it("renders the active lesson's own description below the video, with links", async () => {
    getTrack.mockResolvedValue({
      track: {
        id: 'track-1',
        slug: 'onboarding',
        title: 'Onboarding',
        description: null,
        published: false,
        createdAt: '',
        updatedAt: '',
        modules: [
          {
            id: 'm1',
            trackId: 'track-1',
            title: 'Introdução',
            description: null,
            order: 0,
            lessons: [
              {
                ...lesson('l2', 'Aula com vídeo', 0, true),
                description: 'Veja o [material](https://kosmos.example.com).',
              },
            ],
          },
        ],
      },
    });

    renderPreview();
    await screen.findByTitle('Aula com vídeo');

    const link = await screen.findByRole('link', { name: 'material' });
    expect(link).toHaveAttribute('href', 'https://kosmos.example.com');
    expect(link).toHaveAttribute('target', '_blank');
  });
});
