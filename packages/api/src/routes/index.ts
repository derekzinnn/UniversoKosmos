import { Router } from 'express';
import { prisma } from '../db/prisma.js';
import { auditRouter } from './audit.routes.js';
import { authRouter } from './auth.routes.js';
import { clientRouter } from './client.routes.js';
import { contentRouter, lessonRouter, moduleRouter, resourceRouter } from './content.routes.js';
import { funnelRouter } from './funnel.routes.js';
import { invitationRouter } from './invitation.routes.js';
import { tenantRouter } from './tenant.routes.js';
import { videoRouter } from './video.routes.js';

export const apiRouter: Router = Router();

/**
 * Liveness + readiness in one. A plain reachability check already catches the
 * process being down (the reverse proxy answers 502, an uptime monitor sees the
 * connection refused). This also pings the database with a trivial query, so a
 * process that is up but cannot reach Postgres reports `503 degraded` instead of
 * a misleading `200 ok` — which is exactly the failure an alert should catch.
 * `$queryRaw` carries no model, so the tenant guard leaves it alone.
 */
apiRouter.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', service: 'universo-kosmos-api' });
  } catch {
    res.status(503).json({ status: 'degraded', service: 'universo-kosmos-api' });
  }
});

apiRouter.use('/auth', authRouter);
apiRouter.use('/invitations', invitationRouter);
apiRouter.use('/tenants', tenantRouter);
apiRouter.use('/tracks', contentRouter);
apiRouter.use('/modules', moduleRouter);
apiRouter.use('/lessons', lessonRouter);
apiRouter.use('/resources', resourceRouter);
apiRouter.use('/videos', videoRouter);
apiRouter.use('/audit-logs', auditRouter);
apiRouter.use('/funnel', funnelRouter);
apiRouter.use('/clients', clientRouter);
