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

    // The matrix lists both lessons and marks the completed one for the member.
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

  it('hides a lesson for the client from the access section', async () => {
    const user = userEvent.setup();
    drilldown.mockResolvedValue(data);
    setLessonVisibility.mockResolvedValue({ lessonId: 'l2', hidden: true });

    renderPage();
    const section = (await screen.findByRole('heading', { name: 'Acesso às aulas' })).closest(
      'section',
    ) as HTMLElement;

    // The lesson "Configuração" is visible; its toggle hides it (visible: false).
    const row = within(section).getByText('Configuração').closest('li') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: /Visível/ }));

    expect(setLessonVisibility).toHaveBeenCalledWith('t1', 'l2', false);
  });

  it('marks an already-hidden lesson and shows it again on click', async () => {
    const user = userEvent.setup();
    drilldown.mockResolvedValue({ ...data, hiddenLessonIds: ['l2'] });
    setLessonVisibility.mockResolvedValue({ lessonId: 'l2', hidden: false });

    renderPage();
    const section = (await screen.findByRole('heading', { name: 'Acesso às aulas' })).closest(
      'section',
    ) as HTMLElement;

    const row = within(section).getByText('Configuração').closest('li') as HTMLElement;
    // A hidden lesson reads "Oculta"; clicking shows it again (visible: true).
    await user.click(within(row).getByRole('button', { name: /Oculta/ }));

    expect(setLessonVisibility).toHaveBeenCalledWith('t1', 'l2', true);
  });
});
