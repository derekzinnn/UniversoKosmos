import { request } from './api-client';

export type MemberLessonStatus = 'completed' | 'in_progress';

export interface DrilldownMember {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  lastLoginAt: string | null;
  lessonsCompleted: number;
  lessonsTotal: number;
  percent: number;
  lastActivityAt: string | null;
}

export interface DrilldownLesson {
  id: string;
  title: string;
  isRequired: boolean;
}

export interface DrilldownModule {
  id: string;
  title: string;
  lessons: DrilldownLesson[];
}

export interface DrilldownTrack {
  id: string;
  title: string;
  published: boolean;
  modules: DrilldownModule[];
}

export interface DrilldownProgress {
  userId: string;
  lessonId: string;
  status: MemberLessonStatus;
  completedAt: string | null;
}

export interface ClientDrilldown {
  tenant: {
    id: string;
    name: string;
    status: string;
    contractSignedAt: string | null;
    createdAt: string;
  };
  members: DrilldownMember[];
  tracks: DrilldownTrack[];
  progress: DrilldownProgress[];
  /** Lessons hidden from this client — the per-client access denylist. */
  hiddenLessonIds: string[];
}

export const clientApi = {
  drilldown: (tenantId: string) => request<ClientDrilldown>(`/clients/${tenantId}`),

  /** Hide or show one lesson for this client. */
  setLessonVisibility: (tenantId: string, lessonId: string, visible: boolean) =>
    request<{ lessonId: string; hidden: boolean }>(
      `/clients/${tenantId}/lessons/${lessonId}/visibility`,
      { method: 'PATCH', body: { visible } },
    ),
};
