import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Film,
  Layers,
  Plus,
  Trash2,
  TriangleAlert,
  Users,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AddItemPopover } from '@/components/admin/AddItemPopover';
import { LessonVideoModal } from '@/components/admin/LessonVideoModal';
import { NewLessonModal } from '@/components/admin/NewLessonModal';
import { RenamePopover } from '@/components/admin/RenamePopover';
import { TrackBannerEditor } from '@/components/admin/TrackBannerEditor';
import { ErrorState } from '@/components/states/ErrorState';
import { FullPageLoader } from '@/components/states/FullPageLoader';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { messageFor } from '@/lib/api-error';
import {
  contentApi,
  tenantApi,
  type Lesson,
  type LibraryVideo,
  type Module,
} from '@/lib/content-api';

export function TrackEditorPage() {
  const { trackId = '' } = useParams<{ trackId: string }>();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [banner, setBanner] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const track = useQuery({
    queryKey: ['track', trackId],
    queryFn: () => contentApi.getTrack(trackId),
    enabled: Boolean(trackId),
  });

  const readiness = useQuery({
    queryKey: ['track', trackId, 'readiness'],
    queryFn: () => contentApi.readiness(trackId),
    enabled: Boolean(trackId),
  });

  const refresh = async () => {
    setBanner(null);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['track', trackId] }),
      queryClient.invalidateQueries({ queryKey: ['tracks'] }),
    ]);
  };

  const fail = (caught: unknown) => setBanner(messageFor(caught));

  const publish = useMutation({
    mutationFn: () =>
      track.data?.track.published ? contentApi.unpublish(trackId) : contentApi.publish(trackId),
    onSuccess: refresh,
    onError: fail,
  });

  const addModule = useMutation({
    mutationFn: (title: string) => contentApi.createModule(trackId, { title }),
    onSuccess: refresh,
    onError: fail,
  });

  const renameTrack = useMutation({
    mutationFn: (title: string) => contentApi.updateTrack(trackId, { title }),
    onSuccess: refresh,
    onError: fail,
  });

  const removeTrack = useMutation({
    mutationFn: () => contentApi.deleteTrack(trackId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['tracks'] });
      void navigate('/admin/tracks', { replace: true });
    },
    onError: fail,
  });

  if (track.isPending) return <FullPageLoader label="Carregando a trilha…" />;

  if (track.isError) {
    return (
      <ErrorState
        title="Não encontramos esta trilha"
        description={messageFor(track.error)}
        action={
          <Button variant="outline" size="sm" asChild>
            <Link to="/admin/tracks">Voltar para as trilhas</Link>
          </Button>
        }
      />
    );
  }

  const current = track.data.track;
  const modules = current.modules ?? [];
  const problems = readiness.data?.problems ?? [];

  return (
    <div className="space-y-8">
      <Link
        to="/admin/tracks"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Trilhas
      </Link>

      <header className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{current.title}</h1>
              <RenamePopover
                value={current.title}
                label="a trilha"
                pending={renameTrack.isPending}
                onSubmit={(title) => renameTrack.mutate(title)}
              />
              {current.published ? (
                <Badge variant="success">Publicada</Badge>
              ) : (
                <Badge>Rascunho</Badge>
              )}
            </div>
            <p className="font-mono text-xs text-muted-foreground">/{current.slug}</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => publish.mutate()}
              loading={publish.isPending}
              variant={current.published ? 'outline' : 'default'}
              disabled={!current.published && problems.length > 0}
            >
              {current.published ? 'Despublicar' : 'Publicar'}
            </Button>

            {!current.published ? (
              <Button
                variant="ghost"
                onClick={() => setConfirmDelete(true)}
                aria-label="Excluir trilha"
              >
                <Trash2 aria-hidden />
              </Button>
            ) : null}
          </div>
        </div>

        {banner ? <Alert variant="error">{banner}</Alert> : null}

        {!current.published && problems.length > 0 ? (
          <Alert variant="info">
            <p className="mb-2 flex items-center gap-1.5 font-medium">
              <TriangleAlert className="size-4" aria-hidden />
              Falta isto para publicar
            </p>
            <ul className="list-inside list-disc space-y-1">
              {problems.map((problem) => (
                <li key={`${problem.code}-${problem.entityId ?? ''}`}>{problem.message}</li>
              ))}
            </ul>
          </Alert>
        ) : null}
      </header>

      <TrackBannerEditor track={current} />

      <Tabs defaultValue="content" className="space-y-6">
        <TabsList>
          <TabsTrigger value="content">
            <Layers className="size-4" aria-hidden />
            Conteúdo
          </TabsTrigger>
          <TabsTrigger value="clients">
            <Users className="size-4" aria-hidden />
            Clientes
          </TabsTrigger>
        </TabsList>

        <TabsContent value="content" className="space-y-4">
          {modules.length === 0 ? (
            <Card className="p-6 text-sm text-muted-foreground">
              Nenhum módulo ainda. Adicione o primeiro abaixo.
            </Card>
          ) : (
            <ol className="space-y-4">
              {modules.map((module, index) => (
                <ModuleCard
                  key={module.id}
                  module={module}
                  index={index}
                  total={modules.length}
                  trackId={trackId}
                  onChanged={refresh}
                  onError={fail}
                />
              ))}
            </ol>
          )}

          <AddItemPopover
            label="Adicionar módulo"
            placeholder="Nome do módulo"
            pending={addModule.isPending}
            onSubmit={(value) => addModule.mutate(value)}
          />
        </TabsContent>

        <TabsContent value="clients">
          <AssignmentsSection trackId={trackId} onError={fail} />
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={(next) => {
          setConfirmDelete(next);
          if (!next) removeTrack.reset();
        }}
        title="Excluir esta trilha?"
        description="Esta ação não pode ser desfeita. Módulos e aulas vão junto."
        confirmLabel="Excluir trilha"
        destructive
        loading={removeTrack.isPending}
        error={removeTrack.isError ? messageFor(removeTrack.error) : null}
        onConfirm={() => removeTrack.mutate()}
      />
    </div>
  );
}

// ── Modules ───────────────────────────────────────────────────────────────

interface ModuleCardProps {
  module: Module;
  index: number;
  total: number;
  trackId: string;
  onChanged: () => Promise<void>;
  onError: (error: unknown) => void;
}

function ModuleCard({ module, index, total, trackId, onChanged, onError }: ModuleCardProps) {
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const move = useMutation({
    mutationFn: async (direction: -1 | 1) => {
      const siblings = (
        queryClient.getQueryData<{ track: { modules?: Module[] } }>(['track', trackId])?.track
          .modules ?? []
      ).map((item) => item.id);

      const target = index + direction;
      if (target < 0 || target >= siblings.length) return;

      const reordered = [...siblings];
      const [moved] = reordered.splice(index, 1);
      reordered.splice(target, 0, moved as string);

      await contentApi.reorderModules(trackId, reordered);
    },
    onSuccess: onChanged,
    onError,
  });

  const remove = useMutation({
    mutationFn: () => contentApi.deleteModule(module.id),
    onSuccess: onChanged,
    onError,
  });

  const rename = useMutation({
    mutationFn: (title: string) => contentApi.updateModule(module.id, { title }),
    onSuccess: onChanged,
    onError,
  });

  const [addingLesson, setAddingLesson] = useState(false);

  const addLesson = useMutation({
    mutationFn: ({ title, video }: { title: string; video: LibraryVideo | null }) =>
      contentApi.createLesson(module.id, {
        title,
        // A chosen video rides along in the same request; the real duration
        // comes with it, so completion stays computable without a second trip.
        externalVideoId: video?.id ?? null,
        durationSeconds: video?.durationSeconds ?? null,
      }),
    onSuccess: async () => {
      setAddingLesson(false);
      await onChanged();
    },
    onError,
  });

  return (
    <li>
      <Card className="overflow-hidden">
        <div className="flex items-start gap-3 border-b border-border p-4 sm:p-5">
          <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
            {index + 1}
          </span>

          <div className="min-w-0 flex-1">
            <h3 className="font-medium">{module.title}</h3>
            <p className="text-xs text-muted-foreground">
              {module.lessons.length} {module.lessons.length === 1 ? 'aula' : 'aulas'}
            </p>
          </div>

          <div className="flex shrink-0 gap-1">
            <RenamePopover
              value={module.title}
              label="o módulo"
              pending={rename.isPending}
              onSubmit={(title) => rename.mutate(title)}
            />
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              disabled={index === 0 || move.isPending}
              onClick={() => move.mutate(-1)}
              aria-label={`Mover ${module.title} para cima`}
            >
              <ChevronUp aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              disabled={index === total - 1 || move.isPending}
              onClick={() => move.mutate(1)}
              aria-label={`Mover ${module.title} para baixo`}
            >
              <ChevronDown aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground hover:text-destructive"
              onClick={() => setConfirmDelete(true)}
              aria-label={`Excluir ${module.title}`}
            >
              <Trash2 aria-hidden />
            </Button>
          </div>
        </div>

        <div className="space-y-3 p-4 sm:p-5">
          {module.lessons.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma aula neste módulo.</p>
          ) : (
            <ol className="space-y-2">
              {module.lessons.map((lesson, lessonIndex) => (
                <LessonRow
                  key={lesson.id}
                  lesson={lesson}
                  index={lessonIndex}
                  total={module.lessons.length}
                  moduleId={module.id}
                  siblings={module.lessons}
                  onChanged={onChanged}
                  onError={onError}
                />
              ))}
            </ol>
          )}

          <Button variant="outline" className="w-full" onClick={() => setAddingLesson(true)}>
            <Plus aria-hidden />
            Adicionar aula
          </Button>

          <NewLessonModal
            open={addingLesson}
            onOpenChange={setAddingLesson}
            pending={addLesson.isPending}
            onCreate={(input) => addLesson.mutate(input)}
          />
        </div>
      </Card>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={(next) => {
          setConfirmDelete(next);
          if (!next) remove.reset();
        }}
        title={`Excluir o módulo "${module.title}"?`}
        description="As aulas dentro dele vão junto. Esta ação não pode ser desfeita."
        confirmLabel="Excluir módulo"
        destructive
        loading={remove.isPending}
        error={remove.isError ? messageFor(remove.error) : null}
        onConfirm={() => remove.mutate()}
      />
    </li>
  );
}

// ── Lessons ───────────────────────────────────────────────────────────────

interface LessonRowProps {
  lesson: Lesson;
  index: number;
  total: number;
  moduleId: string;
  siblings: Lesson[];
  onChanged: () => Promise<void>;
  onError: (error: unknown) => void;
}

function LessonRow({
  lesson,
  index,
  total,
  moduleId,
  siblings,
  onChanged,
  onError,
}: LessonRowProps) {
  const [pickingVideo, setPickingVideo] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const move = useMutation({
    mutationFn: async (direction: -1 | 1) => {
      const target = index + direction;
      if (target < 0 || target >= siblings.length) return;

      const reordered = siblings.map((item) => item.id);
      const [moved] = reordered.splice(index, 1);
      reordered.splice(target, 0, moved as string);

      await contentApi.reorderLessons(moduleId, reordered);
    },
    onSuccess: onChanged,
    onError,
  });

  const saveVideo = useMutation({
    mutationFn: (video: LibraryVideo) =>
      contentApi.updateLesson(lesson.id, {
        externalVideoId: video.id,
        // The picker carries the real length; save it so completion is
        // computable without a second trip to Panda.
        durationSeconds: video.durationSeconds,
      }),
    onSuccess: onChanged,
    onError,
  });

  const remove = useMutation({
    mutationFn: () => contentApi.deleteLesson(lesson.id),
    onSuccess: onChanged,
    onError,
  });

  const rename = useMutation({
    mutationFn: (title: string) => contentApi.updateLesson(lesson.id, { title }),
    onSuccess: onChanged,
    onError,
  });

  return (
    <li className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 w-5 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
          {index + 1}
        </span>

        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium">{lesson.title}</p>
          <div className="flex flex-wrap items-center gap-2">
            {lesson.hasVideo ? (
              <Badge variant="success">
                <Film className="size-3" aria-hidden />
                Com vídeo
              </Badge>
            ) : (
              <Badge variant="warning">Sem vídeo</Badge>
            )}
            {!lesson.isRequired ? <Badge>Opcional</Badge> : null}
          </div>
        </div>

        <div className="flex shrink-0 gap-1">
          <RenamePopover
            value={lesson.title}
            label="a aula"
            pending={rename.isPending}
            onSubmit={(title) => rename.mutate(title)}
          />
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            disabled={index === 0 || move.isPending}
            onClick={() => move.mutate(-1)}
            aria-label={`Mover ${lesson.title} para cima`}
          >
            <ChevronUp aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            disabled={index === total - 1 || move.isPending}
            onClick={() => move.mutate(1)}
            aria-label={`Mover ${lesson.title} para baixo`}
          >
            <ChevronDown aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground hover:text-destructive"
            onClick={() => setConfirmDelete(true)}
            aria-label={`Excluir ${lesson.title}`}
          >
            <Trash2 aria-hidden />
          </Button>
        </div>
      </div>

      <Button
        variant="link"
        size="sm"
        className="mt-1 h-auto p-0 text-xs"
        loading={saveVideo.isPending}
        onClick={() => setPickingVideo(true)}
      >
        {lesson.hasVideo ? 'Trocar vídeo' : 'Escolher vídeo'}
      </Button>

      <LessonVideoModal
        open={pickingVideo}
        onOpenChange={setPickingVideo}
        currentVideoId={lesson.externalVideoId ?? null}
        onPick={(video) => saveVideo.mutate(video)}
      />

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={(next) => {
          setConfirmDelete(next);
          if (!next) remove.reset();
        }}
        title={`Excluir a aula "${lesson.title}"?`}
        description="Esta ação não pode ser desfeita."
        confirmLabel="Excluir aula"
        destructive
        loading={remove.isPending}
        error={remove.isError ? messageFor(remove.error) : null}
        onConfirm={() => remove.mutate()}
      />
    </li>
  );
}

// ── Assignments ───────────────────────────────────────────────────────────

function AssignmentsSection({
  trackId,
  onError,
}: {
  trackId: string;
  onError: (error: unknown) => void;
}) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState('');

  const assigned = useQuery({
    queryKey: ['track', trackId, 'assignments'],
    queryFn: () => contentApi.listAssignments(trackId),
  });

  const tenants = useQuery({ queryKey: ['tenants'], queryFn: tenantApi.list });

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['track', trackId, 'assignments'] }),
      queryClient.invalidateQueries({ queryKey: ['tracks'] }),
    ]);

  const assign = useMutation({
    mutationFn: (tenantId: string) => contentApi.assign(trackId, tenantId),
    onSuccess: async () => {
      setSelected('');
      await refresh();
    },
    onError,
  });

  const unassign = useMutation({
    mutationFn: (tenantId: string) => contentApi.unassign(trackId, tenantId),
    onSuccess: refresh,
    onError,
  });

  const assignedTenants = assigned.data?.tenants ?? [];
  const assignedIds = new Set(assignedTenants.map((tenant) => tenant.id));
  const available = (tenants.data?.tenants ?? []).filter((tenant) => !assignedIds.has(tenant.id));

  return (
    <section className="space-y-4">
      <div className="space-y-1.5">
        <h2 className="text-base font-semibold tracking-tight">Clientes com acesso</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Um cliente só vê esta trilha depois que ela é publicada e liberada para a empresa dele.
        </p>
      </div>

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (selected) assign.mutate(selected);
        }}
      >
        <div className="min-w-56 flex-1">
          <Select value={selected} onValueChange={setSelected} disabled={available.length === 0}>
            <SelectTrigger aria-label="Escolher cliente">
              <SelectValue
                placeholder={
                  available.length === 0
                    ? 'Todos os clientes já têm acesso'
                    : 'Escolher um cliente…'
                }
              />
            </SelectTrigger>
            <SelectContent>
              {available.map((tenant) => (
                <SelectItem key={tenant.id} value={tenant.id}>
                  {tenant.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button type="submit" disabled={!selected} loading={assign.isPending}>
          <Plus aria-hidden />
          Liberar acesso
        </Button>
      </form>

      <Card className="divide-y divide-border">
        {assigned.isPending ? (
          <p className="p-4 text-sm text-muted-foreground">Carregando…</p>
        ) : assignedTenants.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            Nenhum cliente liberado ainda. Escolha uma empresa acima para dar acesso.
          </p>
        ) : (
          assignedTenants.map((tenant) => (
            <div key={tenant.id} className="flex items-center gap-3 p-4">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
                {tenant.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="flex-1 truncate text-sm font-medium">{tenant.name}</span>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => unassign.mutate(tenant.id)}
              >
                Remover
              </Button>
            </div>
          ))
        )}
      </Card>
    </section>
  );
}
