import type { Request, Response } from 'express';
import { requireContext } from '../middleware/authenticate.js';
import type { LessonVisibilityBody } from '../schemas/client.schemas.js';
import {
  getClientDrilldown,
  setClientLessonVisibility,
} from '../services/client-drilldown.service.js';

export async function clientDrilldownHandler(req: Request, res: Response): Promise<void> {
  const tenantId = req.params.tenantId as string;
  res.json(await getClientDrilldown(requireContext(req), tenantId));
}

export async function setLessonVisibilityHandler(req: Request, res: Response): Promise<void> {
  const tenantId = req.params.tenantId as string;
  const lessonId = req.params.lessonId as string;
  const { visible } = req.body as LessonVisibilityBody;
  res.json(await setClientLessonVisibility(requireContext(req), tenantId, lessonId, visible));
}
