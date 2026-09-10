import type { Request, Response } from 'express';
import { requireContext } from '../middleware/authenticate.js';
import type {
  AssignTrackBody,
  CreateTrackBody,
  LessonBody,
  ModuleBody,
  ReorderBody,
  ResourceBody,
  UpdateLessonBody,
  UpdateModuleBody,
  UpdateTrackBody,
} from '../schemas/content.schemas.js';
import { assignTrack, listMyTracks, unassignTrack } from '../services/assignment.service.js';
import * as contentService from '../services/content.service.js';

function param(req: Request, name: string): string {
  return req.params[name] as string;
}

/** `?force=true` on a delete — the deliberate override of a "has progress" guard. */
function forced(req: Request): boolean {
  return req.query.force === 'true';
}

// ── Tracks ────────────────────────────────────────────────────────────────

export async function createTrackHandler(req: Request, res: Response): Promise<void> {
  const body = req.body as CreateTrackBody;

  const track = await contentService.createTrack(requireContext(req), {
    title: body.title,
    slug: body.slug ?? null,
    description: body.description ?? null,
  });

  res.status(201).json({ track });
}

export async function listTracksHandler(req: Request, res: Response): Promise<void> {
  res.json({ tracks: await contentService.listTracks(requireContext(req)) });
}

export async function getTrackHandler(req: Request, res: Response): Promise<void> {
  res.json({ track: await contentService.getTrack(requireContext(req), param(req, 'trackId')) });
}

export async function updateTrackHandler(req: Request, res: Response): Promise<void> {
  const body = req.body as UpdateTrackBody;
  const track = await contentService.updateTrack(requireContext(req), param(req, 'trackId'), body);
  res.json({ track });
}

export async function deleteTrackHandler(req: Request, res: Response): Promise<void> {
  await contentService.deleteTrack(requireContext(req), param(req, 'trackId'), forced(req));
  res.status(204).send();
}

export async function trackReadinessHandler(req: Request, res: Response): Promise<void> {
  const readiness = await contentService.checkTrackReadiness(
    requireContext(req),
    param(req, 'trackId'),
  );
  res.json(readiness);
}

export async function publishTrackHandler(req: Request, res: Response): Promise<void> {
  const track = await contentService.publishTrack(requireContext(req), param(req, 'trackId'));
  res.json({ track });
}

export async function unpublishTrackHandler(req: Request, res: Response): Promise<void> {
  const track = await contentService.unpublishTrack(requireContext(req), param(req, 'trackId'));
  res.json({ track });
}

// ── Modules ───────────────────────────────────────────────────────────────

export async function createModuleHandler(req: Request, res: Response): Promise<void> {
  const body = req.body as ModuleBody;

  const module = await contentService.createModule(requireContext(req), param(req, 'trackId'), {
    title: body.title,
    description: body.description ?? null,
  });

  res.status(201).json({ module });
}

export async function updateModuleHandler(req: Request, res: Response): Promise<void> {
  const body = req.body as UpdateModuleBody;
  const module = await contentService.updateModule(
    requireContext(req),
    param(req, 'moduleId'),
    body,
  );
  res.json({ module });
}

export async function deleteModuleHandler(req: Request, res: Response): Promise<void> {
  await contentService.deleteModule(requireContext(req), param(req, 'moduleId'), forced(req));
  res.status(204).send();
}

export async function reorderModulesHandler(req: Request, res: Response): Promise<void> {
  const body = req.body as ReorderBody;
  const modules = await contentService.reorderModules(
    requireContext(req),
    param(req, 'trackId'),
    body.orderedIds,
  );
  res.json({ modules });
}

// ── Lessons ───────────────────────────────────────────────────────────────

export async function createLessonHandler(req: Request, res: Response): Promise<void> {
  const body = req.body as LessonBody;

  const lesson = await contentService.createLesson(requireContext(req), param(req, 'moduleId'), {
    title: body.title,
    description: body.description ?? null,
    externalVideoId: body.externalVideoId ?? null,
    durationSeconds: body.durationSeconds ?? null,
    isRequired: body.isRequired,
  });

  res.status(201).json({ lesson });
}

export async function updateLessonHandler(req: Request, res: Response): Promise<void> {
  const body = req.body as UpdateLessonBody;
  const lesson = await contentService.updateLesson(
    requireContext(req),
    param(req, 'lessonId'),
    body,
  );
  res.json({ lesson });
}

export async function deleteLessonHandler(req: Request, res: Response): Promise<void> {
  await contentService.deleteLesson(requireContext(req), param(req, 'lessonId'), forced(req));
  res.status(204).send();
}

export async function reorderLessonsHandler(req: Request, res: Response): Promise<void> {
  const body = req.body as ReorderBody;
  const lessons = await contentService.reorderLessons(
    requireContext(req),
    param(req, 'moduleId'),
    body.orderedIds,
  );
  res.json({ lessons });
}

// ── Resources ─────────────────────────────────────────────────────────────

export async function createResourceHandler(req: Request, res: Response): Promise<void> {
  const body = req.body as ResourceBody;

  const resource = await contentService.createResource(
    requireContext(req),
    param(req, 'lessonId'),
    {
      type: body.type,
      title: body.title,
      url: body.url,
      fileSizeBytes: body.fileSizeBytes ?? null,
    },
  );

  res.status(201).json({ resource });
}

export async function deleteResourceHandler(req: Request, res: Response): Promise<void> {
  await contentService.deleteResource(requireContext(req), param(req, 'resourceId'));
  res.status(204).send();
}

// ── Assignments ───────────────────────────────────────────────────────────

export async function listTrackAssignmentsHandler(req: Request, res: Response): Promise<void> {
  const tenants = await contentService.listTrackAssignments(
    requireContext(req),
    param(req, 'trackId'),
  );
  res.json({ tenants });
}

export async function assignTrackHandler(req: Request, res: Response): Promise<void> {
  const body = req.body as AssignTrackBody;
  await assignTrack(requireContext(req), param(req, 'trackId'), body.tenantId);
  res.status(201).json({ assigned: true });
}

export async function unassignTrackHandler(req: Request, res: Response): Promise<void> {
  await unassignTrack(requireContext(req), param(req, 'trackId'), param(req, 'tenantId'));
  res.status(204).send();
}

/** The caller's own company's tracks. Kosmos staff use the authoring routes. */
export async function myTracksHandler(req: Request, res: Response): Promise<void> {
  res.json({ tracks: await listMyTracks(requireContext(req)) });
}
