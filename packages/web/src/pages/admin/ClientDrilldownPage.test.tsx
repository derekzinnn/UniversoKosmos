import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clientApi, type ClientDrilldown } from '@/lib/client-api';
import { renderWithProviders } from '@/test/render';
import { ClientDrilldownPage } from './ClientDrilldownPage';

vi.mock('@/lib/client-api', () => ({
  clientApi: { drilldown: vi.fn(), setLessonVisibility: vi.fn() },
}));

const drilldown = vi.mocked(clientApi.drilldown);
const setLessonVisibility = vi.mocked(clientApi.setLessonVisibility);

const data: ClientDrilldown = {
  tenant: {
    id: 't1',
    name: 'Empresa Alfa',
    status: 'ACTIVE',
    contractSignedAt: null,
    createdAt: '2026-08-01T00:00:00.000Z',
  },
  members: [
    {
      id: 'u1',
      name: 'Ana Lima',
      email: 'ana@alfa.com.br',
      role: 'CLIENT_OWNER',
      status: 'ACTIVE',
      lastLoginAt: '2026-08-20T00:00:00.000Z',
      lessonsCompleted: 1,
      lessonsTotal: 2,
      percent: 50,
      lastActivityAt: '2026-08-20T00:00:00.000Z',
    },
  ],
  tracks: [
    {
      id: 'tr1',
      title: 'Onboarding',
      published: true,
      modules: [
        {
          id: 'm1',
          title: 'Módulo 1',
          lessons: [
            { id: 'l1', title: 'Bem-vindo', isRequired: true },
            { id: 'l2', title: 'Configuração', isRequired: true },
          ],
        },
      ],
    },
  ],
  progress: [
    { userId: 'u1', lessonId: 'l1', status: 'completed', completedAt: '2026-08-20T00:00:00.000Z' },
  ],
  hiddenLessonIds: [],
};

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/admin/clients/:tenantId" element={<ClientDrilldownPage />} />
    </Routes>,
    { route: '/admin/clients/t1', auth: { status: 'authenticated' } },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ClientDrilldownPage', () => {
  it('shows the company, its people and the lesson matrix', async () => {
    drilldown.mockResolvedValue(data);

    renderPage();

    expect(await screen.findByRole('heading', { name: 'Empresa Alfa' })).toBeInTheDocument();
    expect(screen.getByText('ana@alfa.com.br')).toBeInTheDocument();

    // "Aulas assistidas" is a tab; opening it reveals the per-track matrix.
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Aulas assistidas' }));

    const table = screen.getByRole('table');
    expect(within(table).getByText('Bem-vindo')).toBeInTheDocument();
    expect(within(table).getByText('Configuração')).toBeInTheDocument();
    expect(within(table).getByLabelText('Concluída')).toBeInTheDocument();
    expect(within(table).getAllByLabelText('Não iniciada').length).toBeGreaterThan(0);
  });

  it('requests the drill-down for the tenant in the URL', async () => {
    drilldown.mockResolvedValue(data);
    renderPage();
    await screen.findByRole('heading', { name: 'Empresa Alfa' });
    expect(drilldown).toHaveBeenCalledWith('t1');
  });

  it('hides a lesson for the client from the access tab', async () => {
    const user = userEvent.setup();
    drilldown.mockResolvedValue(data);
    setLessonVisibility.mockResolvedValue({ lessonId: 'l2', hidden: true });

    renderPage();
    // The "Acesso às aulas" tab is open by default.
    const panel = await screen.findByRole('tabpanel');

    // The lesson "Configuração" is visible; its toggle hides it (visible: false).
    const row = within(panel).getByText('Configuração').closest('li') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: /Visível/ }));

    expect(setLessonVisibility).toHaveBeenCalledWith('t1', 'l2', false);
  });

  it('marks an already-hidden lesson and shows it again on click', async () => {
    const user = userEvent.setup();
    drilldown.mockResolvedValue({ ...data, hiddenLessonIds: ['l2'] });
    setLessonVisibility.mockResolvedValue({ lessonId: 'l2', hidden: false });

    renderPage();
    const panel = await screen.findByRole('tabpanel');

    const row = within(panel).getByText('Configuração').closest('li') as HTMLElement;
    // A hidden lesson reads "Oculta"; clicking shows it again (visible: true).
    await user.click(within(row).getByRole('button', { name: /Oculta/ }));

    expect(setLessonVisibility).toHaveBeenCalledWith('t1', 'l2', true);
  });

  it('scopes the per-track view to the selected track, offering the others in the selector', async () => {
    drilldown.mockResolvedValue({
      ...data,
      tracks: [
        ...data.tracks,
        {
          id: 'tr2',
          title: 'Avançado',
          published: true,
          modules: [
            {
              id: 'm2',
              title: 'Módulo A',
              lessons: [{ id: 'l9', title: 'Escala', isRequired: true }],
            },
          ],
        },
      ],
    });

    renderPage();
    const panel = await screen.findByRole('tabpanel');

    // Only the selected (first) track's lessons show; the second is not stacked
    // in — the whole point of the selector on a client with many trilhas.
    expect(within(panel).getByText('Bem-vindo')).toBeInTheDocument();
    expect(within(panel).queryByText('Escala')).not.toBeInTheDocument();

    // The selector is present and shows the track in view.
    const selector = screen.getByRole('combobox');
    expect(within(selector).getByText('Onboarding')).toBeInTheDocument();
  });
});
