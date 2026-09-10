import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ChevronLeft, FileText, Link2, Lock, PlayCircle } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CompletionCelebration } from '@/components/CompletionCelebration';
import { LessonPlayer } from '@/components/LessonPlayer';
import { ErrorState } from '@/components/states/ErrorState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { useHeartbeat } from '@/hooks/useHeartbeat';
import { ApiError, messageFor } from '@/lib/api-error';
import { classroomApi, type HeartbeatResult } from '@/lib/classroom-api';
import { contentApi, type Lesson, type Track } from '@/lib/content-api';

/** Matches HEARTBEAT_INTERVAL_SECONDS on the API. */
const HEARTBEAT_SECONDS = 15;

function formatDuration(seconds: number | null): string | null {
  if (!seconds) return null;
  return `${String(Math.round(seconds / 60))} min`;
}

/** Find the lesson and its owning track inside the caller's assigned tracks. */
function locate(tracks: Track[] | undefined, lessonId: string) {
  for (const track of tracks ?? []) {
    for (const module of track.modules ?? []) {
      const lesson = module.lessons.find((candidate) => candidate.id === lessonId);
      if (lesson) return { track, module, lesson };
    }
  }
  return null;
}

/**
 * One lesson, and the trilha around it.
 *
 * The server is the authority on everything that matters here. This page does
 * not decide what is unlocked — it renders what `/lessons/:id/progress` says,
 * and asking for a locked lesson simply returns an error that gets shown. The
 * lock icons are a courtesy, not the enforcement.
 */
export function LessonPage() {
  const { lessonId = '' } = useParams<{ lessonId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const positionRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [justCompleted, setJustCompleted] = useState(false);
  // Whether the player has reached the last stretch of the video, which is
  // when the explicit "concluir" button is offered. Kept in state (not the
  // position ref) only as a boolean, so it flips the button on once rather
  // than re-rendering on every timeupdate.
  const [nearEnd, setNearEnd] = useState(false);
  const [completedNextId, setCompletedNextId] = useState<string | null>(null);
  // Fires the burst and the rocket flurry, then clears itself so it can play
  // again next lesson. Long enough for the three rockets to cross (~2.4s).
  const [celebrate, setCelebrate] = useState(false);
  const cheer = useCallback(() => {
    setCelebrate(true);
    setTimeout(() => setCelebrate(false), 2600);
  }, []);

  const tracks = useQuery({ queryKey: ['my-tracks'], queryFn: contentApi.myTracks });

  const progress = useQuery({
    queryKey: ['lesson-progress', lessonId],
    queryFn: () => classroomApi.progress(lessonId),
    enabled: lessonId !== '',
  });

  const playback = useQuery({
    queryKey: ['playback', lessonId],
    queryFn: () => classroomApi.playback(lessonId),
    enabled: lessonId !== '',
    // A signed URL that expires; refetching it is how a long lesson keeps
    // playing, and keeping a stale one in cache would hand back a dead link.
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });

  const found = useMemo(() => locate(tracks.data?.tracks, lessonId), [tracks.data, lessonId]);

  const stateByLesson = useMemo(
    () => new Map((progress.data?.progress.lessons ?? []).map((row) => [row.lessonId, row])),
    [progress.data],
  );

  const handleResult = useCallback(
    (result: HeartbeatResult) => {
      if (result.justCompleted) {
        setJustCompleted(true);
        cheer();
        // The unlock state moved, so the outline is now stale.
        void queryClient.invalidateQueries({ queryKey: ['lesson-progress'] });
      }
    },
    [queryClient, cheer],
  );

  const getPosition = useCallback(() => positionRef.current, []);

  useHeartbeat({
    lessonId,
    playing,
    intervalSeconds: HEARTBEAT_SECONDS,
    getPosition,
    onResult: handleResult,
  });

  const complete = useMutation({
    mutationFn: () => classroomApi.complete(lessonId, Math.floor(positionRef.current)),
    onSuccess: (data) => {
      setJustCompleted(true);
      setCompletedNextId(data.progress.nextLessonId);
      cheer();
      void queryClient.invalidateQueries({ queryKey: ['lesson-progress'] });
      void queryClient.invalidateQueries({ queryKey: ['my-tracks'] });
    },
  });

  if (tracks.isPending || progress.isPending) {
    return (
      <div className="space-y-4" role="status" aria-live="polite">
        <span className="sr-only">Carregando a aula…</span>
        <div className="aspect-video w-full animate-pulse rounded-xl bg-muted" />
        <div className="h-6 w-2/3 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  if (progress.isError) {
    const locked = progress.error instanceof ApiError && progress.error.code === 'LESSON_LOCKED';
    return (
      <Card>
        <ErrorState
          title={locked ? 'Esta aula ainda não foi liberada' : 'Não conseguimos abrir esta aula'}
          description={messageFor(progress.error)}
          onRetry={locked ? undefined : () => void progress.refetch()}
        />
        <div className="px-6 pb-6">
          <Button variant="ghost" onClick={() => void navigate('/')}>
            <ChevronLeft className="size-4" aria-hidden />
            Voltar para minhas trilhas
          </Button>
        </div>
      </Card>
    );
  }

  if (!found) {
    return (
      <Card>
        <ErrorState
          title="Não encontramos esta aula"
          description="Ela pode ter sido removida, ou a trilha ainda não foi liberada para a sua empresa."
          onRetry={() => void tracks.refetch()}
        />
      </Card>
    );
  }

  const { track, lesson } = found;
  const nextLessonId = progress.data.progress.nextLessonId;
  const thisLesson = stateByLesson.get(lessonId);
  const done = justCompleted || (thisLesson?.completed ?? false);

  return (
    <div className="space-y-6">
      <CompletionCelebration active={celebrate} />

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" onClick={() => void navigate('/')}>
          <ChevronLeft className="size-4" aria-hidden />
          {track.title}
        </Button>
        {thisLesson?.completed ? (
          <Badge variant="accent">
            <CheckCircle2 className="size-3.5" aria-hidden />
            Concluída
          </Badge>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-5">
          {playback.isPending ? (
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
              title={lesson.title}
              resumeAtSeconds={playback.data.playback.resumeAtSeconds}
              onPosition={(seconds) => {
                positionRef.current = seconds;
                const duration = playback.data.playback.durationSeconds;
                if (duration && duration > 0) {
                  const reached = seconds >= duration * 0.9;
                  setNearEnd((prev) => (prev === reached ? prev : reached));
                }
              }}
              onPlayingChange={setPlaying}
              onEnded={() => setNearEnd(true)}
            />
          )}

          <div className="space-y-2">
            <h1 className="text-xl font-semibold tracking-tight">{lesson.title}</h1>
            {lesson.description ? (
              <p className="text-sm leading-relaxed text-muted-foreground">{lesson.description}</p>
            ) : null}
          </div>

          {done ? (
            <Card className="border-accent p-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="size-5 text-accent-foreground" aria-hidden />
                  <p className="text-sm font-medium">Aula concluída. Bom trabalho!</p>
                </div>
                {(completedNextId ?? nextLessonId) ? (
                  <Button
                    onClick={() => {
                      setJustCompleted(false);
                      setNearEnd(false);
                      void navigate(`/aulas/${completedNextId ?? nextLessonId ?? ''}`);
                    }}
                  >
                    Próxima aula
                  </Button>
                ) : null}
              </div>
            </Card>
          ) : (
            <div className="space-y-2">
              {complete.isError ? <Alert variant="info">{messageFor(complete.error)}</Alert> : null}
              <Button
                size="lg"
                className="w-full sm:w-auto"
                loading={complete.isPending}
                disabled={!nearEnd}
                onClick={() => complete.mutate()}
              >
                <CheckCircle2 className="size-4" aria-hidden />
                Marcar como concluída
              </Button>
              {!nearEnd ? (
                <p className="text-xs text-muted-foreground">
                  Fica disponível quando você chega perto do fim do vídeo.
                </p>
              ) : null}
            </div>
          )}

          {lesson.resources.length > 0 ? (
            <Card className="p-5">
              <h2 className="mb-3 text-sm font-semibold">Materiais desta aula</h2>
              <ul className="space-y-2">
                {lesson.resources.map((resource) => (
                  <li key={resource.id}>
                    <a
                      href={resource.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="flex items-center gap-2 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                    >
                      {resource.type === 'LINK' ? (
                        <Link2 className="size-4 shrink-0" aria-hidden />
                      ) : (
                        <FileText className="size-4 shrink-0" aria-hidden />
                      )}
                      {resource.title}
                    </a>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>

        <TrackOutline track={track} currentLessonId={lessonId} stateByLesson={stateByLesson} />
      </div>
    </div>
  );
}

function TrackOutline({
  track,
  currentLessonId,
  stateByLesson,
}: {
  track: Track;
  currentLessonId: string;
  stateByLesson: Map<string, { locked: boolean; completed: boolean }>;
}) {
  return (
    <Card className="h-fit p-4">
      <h2 className="mb-3 px-2 text-sm font-semibold">Conteúdo da trilha</h2>
      <nav aria-label="Aulas da trilha">
        <ol className="space-y-4">
          {(track.modules ?? []).map((module) => (
            <li key={module.id}>
              <p className="px-2 pb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {module.title}
              </p>
              <ul className="space-y-0.5">
                {module.lessons.map((lesson) => (
                  <OutlineLesson
                    key={lesson.id}
                    lesson={lesson}
                    current={lesson.id === currentLessonId}
                    state={stateByLesson.get(lesson.id)}
                  />
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </nav>
    </Card>
  );
}

function OutlineLesson({
  lesson,
  current,
  state,
}: {
  lesson: Lesson;
  current: boolean;
  state: { locked: boolean; completed: boolean } | undefined;
}) {
  const locked = state?.locked ?? true;
  const duration = formatDuration(lesson.durationSeconds);

  const body = (
    <span className="flex items-start gap-2.5">
      {state?.completed ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-accent-foreground" aria-hidden />
      ) : locked ? (
        <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground/60" aria-hidden />
      ) : (
        <PlayCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-sm leading-snug">{lesson.title}</span>
        {duration ? <span className="block text-xs text-muted-foreground">{duration}</span> : null}
      </span>
    </span>
  );

  if (locked) {
    return (
      <li>
        <span
          className="block cursor-not-allowed rounded-md px-2 py-1.5 text-muted-foreground/70"
          aria-disabled="true"
          title="Termine a aula anterior para liberar esta"
        >
          {body}
        </span>
      </li>
    );
  }

  return (
    <li>
      <Link
        to={`/aulas/${lesson.id}`}
        aria-current={current ? 'page' : undefined}
        className={`block rounded-md px-2 py-1.5 transition-colors hover:bg-muted ${
          current ? 'bg-muted font-medium' : ''
        }`}
      >
        {body}
      </Link>
    </li>
  );
}
