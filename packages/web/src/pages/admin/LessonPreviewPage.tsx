import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Film, PlayCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { LessonPlayer } from '@/components/LessonPlayer';
import { MarkdownContent } from '@/components/MarkdownContent';
import { ErrorState } from '@/components/states/ErrorState';
import { FullPageLoader } from '@/components/states/FullPageLoader';
import { Alert } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { messageFor } from '@/lib/api-error';
import { classroomApi } from '@/lib/classroom-api';
import { contentApi, type Module } from '@/lib/content-api';

function formatDuration(seconds: number | null): string | null {
  if (!seconds) return null;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m)}:${String(s).padStart(2, '0')}`;
}

/**
 * Watching a trilha as Kosmos staff, to check the content before a client sees
 * it — the video really plays, the order reads right, the watermark shows.
 *
 * This is not the client classroom. Staff belong to no company, so there is no
 * progress to record and no lesson is locked — the whole point is to reach any
 * lesson freely and confirm it works. The API already grants staff a playback
 * URL for any lesson (`issueForStaff`); this is the screen that uses it.
 *
 * It deliberately reuses `LessonPlayer`, the same component a client watches
 * through, so a preview proves the real thing rather than an approximation.
 */
export function LessonPreviewPage() {
  const { trackId = '' } = useParams<{ trackId: string }>();
  const [pickedLessonId, setPickedLessonId] = useState<string | null>(null);

  const track = useQuery({
    queryKey: ['track', trackId],
    queryFn: () => contentApi.getTrack(trackId),
    enabled: Boolean(trackId),
  });

  const orderedLessons = useMemo(() => {
    const modules = track.data?.track.modules ?? [];
    return modules.flatMap((module) =>
      module.lessons.map((lesson) => ({ lesson, moduleTitle: module.title })),
    );
  }, [track.data]);

  // The active lesson: what the admin picked, or — until they pick — the first
  // one with a video, so the preview opens on something that plays rather than
  // an empty frame. Derived, not stored, so there is no effect syncing state to
  // props that could fall out of step.
  const defaultLessonId =
    orderedLessons.find((entry) => entry.lesson.hasVideo)?.lesson.id ??
    orderedLessons[0]?.lesson.id ??
    null;
  const activeLessonId = pickedLessonId ?? defaultLessonId;

  const playback = useQuery({
    queryKey: ['playback', activeLessonId],
    queryFn: () => classroomApi.playback(activeLessonId as string),
    enabled: Boolean(activeLessonId),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });

  if (track.isPending) return <FullPageLoader label="Carregando a trilha…" />;

  if (track.isError) {
    return (
      <ErrorState
        title="Não encontramos esta trilha"
        description={messageFor(track.error)}
        action={
          <Link to="/admin/tracks" className="text-sm text-muted-foreground hover:text-foreground">
            Voltar para as trilhas
          </Link>
        }
      />
    );
  }

  const current = track.data.track;
  const activeLesson = orderedLessons.find((entry) => entry.lesson.id === activeLessonId)?.lesson;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          to={`/admin/tracks/${trackId}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Editor da trilha
        </Link>
      </div>

      <Alert variant="info">
        Pré-visualização da equipe Kosmos. O vídeo toca exatamente como o cliente vê, mas nada é
        registrado como progresso — a ordem e o desbloqueio valem só para os clientes.
      </Alert>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{current.title}</h1>
        {current.description ? (
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {current.description}
          </p>
        ) : null}
      </div>

      {orderedLessons.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">
          Esta trilha ainda não tem aulas. Adicione conteúdo no editor para pré-visualizar.
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <div className="space-y-4">
            {!activeLesson ? null : !activeLesson.hasVideo ? (
              <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-xl border border-border bg-muted p-6 text-center">
                <Film className="size-6 text-muted-foreground" aria-hidden />
                <p className="text-sm font-medium">Esta aula ainda não tem vídeo</p>
                <p className="text-xs text-muted-foreground">
                  Anexe um vídeo do Panda no editor para pré-visualizar a reprodução.
                </p>
              </div>
            ) : playback.isPending ? (
              <div className="aspect-video w-full animate-pulse rounded-xl bg-muted" />
            ) : playback.isError ? (
              <Card>
                <ErrorState
                  title="Não conseguimos liberar o vídeo"
                  description={messageFor(playback.error)}
                  onRetry={() => void playback.refetch()}
                />
              </Card>
            ) : (
              <LessonPlayer
                url={playback.data.playback.url}
                title={activeLesson.title}
                resumeAtSeconds={0}
                onPosition={() => undefined}
                onPlayingChange={() => undefined}
              />
            )}

            {activeLesson ? (
              <div className="space-y-2">
                <h2 className="text-lg font-semibold tracking-tight">{activeLesson.title}</h2>
                {activeLesson.description ? (
                  <MarkdownContent content={activeLesson.description} />
                ) : null}
              </div>
            ) : null}
          </div>

          <TrackOutline
            modules={current.modules ?? []}
            activeLessonId={activeLessonId}
            onPick={setPickedLessonId}
          />
        </div>
      )}
    </div>
  );
}

function TrackOutline({
  modules,
  activeLessonId,
  onPick,
}: {
  modules: Module[];
  activeLessonId: string | null;
  onPick: (lessonId: string) => void;
}) {
  return (
    <Card className="h-fit p-4">
      <h2 className="mb-3 px-2 text-sm font-semibold">Conteúdo da trilha</h2>
      <nav aria-label="Aulas da trilha">
        <ol className="space-y-4">
          {modules.map((module) => (
            <li key={module.id}>
              <p className="px-2 pb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {module.title}
              </p>
              <ul className="space-y-0.5">
                {module.lessons.map((lesson) => {
                  const active = lesson.id === activeLessonId;
                  return (
                    <li key={lesson.id}>
                      <button
                        type="button"
                        onClick={() => onPick(lesson.id)}
                        aria-current={active ? 'true' : undefined}
                        className={`flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors ${
                          active ? 'bg-muted font-medium' : 'hover:bg-muted'
                        }`}
                      >
                        <PlayCircle
                          className={`mt-0.5 size-4 shrink-0 ${
                            lesson.hasVideo ? 'text-muted-foreground' : 'text-muted-foreground/40'
                          }`}
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm leading-snug">{lesson.title}</span>
                          {formatDuration(lesson.durationSeconds) ? (
                            <span className="block text-xs text-muted-foreground">
                              {formatDuration(lesson.durationSeconds)}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ol>
      </nav>
    </Card>
  );
}
