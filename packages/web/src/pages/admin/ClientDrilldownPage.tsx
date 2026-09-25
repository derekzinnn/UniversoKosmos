import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, CircleDashed, Clock, Eye, EyeOff, Users } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { EmptyState } from '@/components/states/EmptyState';
import { ErrorState } from '@/components/states/ErrorState';
import { FullPageLoader } from '@/components/states/FullPageLoader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { messageFor } from '@/lib/api-error';
import {
  clientApi,
  type ClientDrilldown,
  type DrilldownMember,
  type DrilldownTrack,
  type MemberLessonStatus,
} from '@/lib/client-api';
import { cn } from '@/lib/utils';

const ROLE_LABELS: Readonly<Record<string, string>> = {
  CLIENT_OWNER: 'Responsável',
  CLIENT_MEMBER: 'Participante',
};

const dateShort = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

/**
 * One client's onboarding, lesson by lesson.
 *
 * Opening this screen is the audited act — the API records a scope override —
 * because it is Kosmos reaching into one named company rather than glancing at
 * the funnel. The matrix reads the way the question is asked: lessons down the
 * side, people across the top, one mark per cell.
 */
export function ClientDrilldownPage() {
  const { tenantId = '' } = useParams<{ tenantId: string }>();
  const queryClient = useQueryClient();
  const [pendingLessonId, setPendingLessonId] = useState<string | null>(null);

  const drilldown = useQuery({
    queryKey: ['client-drilldown', tenantId],
    queryFn: () => clientApi.drilldown(tenantId),
    enabled: Boolean(tenantId),
  });

  const setVisibility = useMutation({
    mutationFn: ({ lessonId, visible }: { lessonId: string; visible: boolean }) =>
      clientApi.setLessonVisibility(tenantId, lessonId, visible),
    onMutate: ({ lessonId }) => setPendingLessonId(lessonId),
    onSettled: () => setPendingLessonId(null),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['client-drilldown', tenantId] }),
  });

  if (drilldown.isPending) return <FullPageLoader />;

  if (drilldown.isError) {
    return (
      <div className="space-y-6">
        <BackLink />
        <Card>
          <ErrorState
            description={messageFor(drilldown.error)}
            onRetry={() => void drilldown.refetch()}
          />
        </Card>
      </div>
    );
  }

  const { tenant, members, tracks, progress, hiddenLessonIds } = drilldown.data;

  // (userId, lessonId) → status, for the matrix cells.
  const cellStatus = new Map<string, MemberLessonStatus>();
  for (const row of progress) cellStatus.set(`${row.userId}|${row.lessonId}`, row.status);

  const hidden = new Set(hiddenLessonIds);

  return (
    <div className="space-y-8">
      <BackLink />

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{tenant.name}</h1>
          <StatusBadge status={tenant.status} />
        </div>
        <p className="text-sm text-muted-foreground">
          Cliente desde {dateShort.format(new Date(tenant.createdAt))}
          {tenant.contractSignedAt
            ? ` · contrato assinado em ${dateShort.format(new Date(tenant.contractSignedAt))}`
            : ''}
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          {members.length} {members.length === 1 ? 'pessoa' : 'pessoas'}
        </h2>
        {members.length === 0 ? (
          <Card>
            <EmptyState
              icon={Users}
              title="Ninguém entrou ainda"
              description="Assim que o responsável aceitar o convite e entrar, ele aparece aqui."
            />
          </Card>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {members.map((member) => (
              <MemberCard key={member.id} member={member} />
            ))}
          </ul>
        )}
      </section>

      {tracks.length > 0 ? (
        <LessonAccessSection
          tracks={tracks}
          hidden={hidden}
          pendingLessonId={pendingLessonId}
          onToggle={(lessonId, currentlyHidden) =>
            setVisibility.mutate({ lessonId, visible: currentlyHidden })
          }
        />
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Progresso por aula</h2>
        {tracks.length === 0 ? (
          <Card>
            <EmptyState
              icon={Users}
              title="Nenhuma trilha atribuída"
              description="Atribua uma trilha a este cliente para acompanhar o progresso aula a aula."
            />
          </Card>
        ) : members.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            A matriz aparece quando houver pessoas para acompanhar.
          </p>
        ) : (
          <ProgressMatrix data={drilldown.data} cellStatus={cellStatus} />
        )}
      </section>
    </div>
  );
}

/**
 * Per-client lesson access. Every lesson of every assigned track, each with a
 * visible/hidden toggle — the denylist the client's classroom obeys. Hiding a
 * lesson removes it from that client's trilha entirely (server-enforced), so
 * this is where staff tailor one company's path without touching the shared
 * content.
 */
function LessonAccessSection({
  tracks,
  hidden,
  pendingLessonId,
  onToggle,
}: {
  tracks: DrilldownTrack[];
  hidden: Set<string>;
  pendingLessonId: string | null;
  onToggle: (lessonId: string, currentlyHidden: boolean) => void;
}) {
  return (
    <section className="space-y-3">
      <div className="space-y-0.5">
        <h2 className="text-sm font-medium text-muted-foreground">Acesso às aulas</h2>
        <p className="text-xs text-muted-foreground">
          Deixe visível apenas o que este cliente deve ver. Uma aula oculta some da trilha dele — e
          não trava a sequência nem conta para a conclusão.
        </p>
      </div>

      <div className="space-y-4">
        {tracks.map((track) => (
          <Card key={track.id} className="p-4">
            <p className="mb-2 text-sm font-semibold">
              {track.title}
              {track.published ? '' : ' (rascunho)'}
            </p>
            <ul className="divide-y divide-border">
              {track.modules.flatMap((module) =>
                module.lessons.map((lesson) => {
                  const isHidden = hidden.has(lesson.id);
                  return (
                    <li
                      key={lesson.id}
                      className="flex items-center justify-between gap-3 py-2"
                    >
                      <span
                        className={cn(
                          'min-w-0 truncate text-sm',
                          isHidden && 'text-muted-foreground line-through',
                        )}
                      >
                        {lesson.title}
                        {!lesson.isRequired ? (
                          <span className="ml-2 text-xs text-muted-foreground no-underline">
                            opcional
                          </span>
                        ) : null}
                      </span>
                      <Button
                        variant={isHidden ? 'ghost' : 'outline'}
                        size="sm"
                        className="shrink-0"
                        loading={pendingLessonId === lesson.id}
                        aria-pressed={!isHidden}
                        onClick={() => onToggle(lesson.id, isHidden)}
                      >
                        {isHidden ? (
                          <EyeOff className="size-4" aria-hidden />
                        ) : (
                          <Eye className="size-4" aria-hidden />
                        )}
                        {isHidden ? 'Oculta' : 'Visível'}
                      </Button>
                    </li>
                  );
                }),
              )}
            </ul>
          </Card>
        ))}
      </div>
    </section>
  );
}

function BackLink() {
  return (
    <Link
      to="/admin/funnel"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" aria-hidden />
      Funil
    </Link>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'ACTIVE') return <Badge variant="success">Ativo</Badge>;
  if (status === 'SUSPENDED') return <Badge variant="warning">Suspenso</Badge>;
  return <Badge>Onboarding</Badge>;
}

function MemberCard({ member }: { member: DrilldownMember }) {
  return (
    <li className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{member.name}</p>
          <p className="truncate text-xs text-muted-foreground">{member.email}</p>
        </div>
        <Badge variant="accent">{ROLE_LABELS[member.role] ?? member.role}</Badge>
      </div>

      {member.lessonsTotal > 0 ? (
        <div className="mt-3">
          <div className="mb-1 flex justify-between text-xs text-muted-foreground">
            <span>
              {member.lessonsCompleted} de {member.lessonsTotal} aulas
            </span>
            <span className="tabular-nums">{member.percent}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${String(member.percent)}%` }}
            />
          </div>
        </div>
      ) : null}

      <p className="mt-3 text-xs text-muted-foreground">{lastSeen(member)}</p>
    </li>
  );
}

function lastSeen(member: DrilldownMember): string {
  if (!member.lastLoginAt) return 'Ainda não entrou';
  return `Última atividade ${relativeTime(member.lastActivityAt ?? member.lastLoginAt)}`;
}

function ProgressMatrix({
  data,
  cellStatus,
}: {
  data: ClientDrilldown;
  cellStatus: Map<string, MemberLessonStatus>;
}) {
  const { members, tracks } = data;

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40">
            <th className="sticky left-0 z-10 bg-muted/40 p-3 text-left font-medium">Aula</th>
            {members.map((member) => (
              <th
                key={member.id}
                className="p-3 text-center font-medium whitespace-nowrap"
                title={member.name}
              >
                {firstName(member.name)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tracks.map((track) => (
            <TrackRows key={track.id} track={track} members={members} cellStatus={cellStatus} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TrackRows({
  track,
  members,
  cellStatus,
}: {
  track: ClientDrilldown['tracks'][number];
  members: DrilldownMember[];
  cellStatus: Map<string, MemberLessonStatus>;
}) {
  return (
    <>
      <tr className="border-b border-border bg-card">
        <td colSpan={members.length + 1} className="p-2.5 pl-3 text-xs font-semibold tracking-wide">
          {track.title}
          {track.published ? '' : ' (rascunho)'}
        </td>
      </tr>
      {track.modules.flatMap((module) =>
        module.lessons.map((lesson) => (
          <tr key={lesson.id} className="border-b border-border last:border-0">
            <td className="sticky left-0 z-10 max-w-xs bg-background p-3">
              <span className="block truncate">{lesson.title}</span>
              {!lesson.isRequired ? (
                <span className="text-xs text-muted-foreground">opcional</span>
              ) : null}
            </td>
            {members.map((member) => (
              <td key={member.id} className="p-3 text-center">
                <StatusMark status={cellStatus.get(`${member.id}|${lesson.id}`)} />
              </td>
            ))}
          </tr>
        )),
      )}
    </>
  );
}

function StatusMark({ status }: { status: MemberLessonStatus | undefined }) {
  if (status === 'completed') {
    return (
      <span className="inline-flex" title="Concluída">
        <Check className="mx-auto size-4 text-success" aria-label="Concluída" />
      </span>
    );
  }
  if (status === 'in_progress') {
    return (
      <span className="inline-flex" title="Em andamento">
        <Clock className="mx-auto size-4 text-primary" aria-label="Em andamento" />
      </span>
    );
  }
  return (
    <span className="inline-flex" title="Não iniciada">
      <CircleDashed className="mx-auto size-4 text-muted-foreground/40" aria-label="Não iniciada" />
    </span>
  );
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

function relativeTime(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'hoje';
  if (days === 1) return 'ontem';
  if (days < 30) return `há ${String(days)} dias`;
  const months = Math.floor(days / 30);
  return months <= 1 ? 'há 1 mês' : `há ${String(months)} meses`;
}
