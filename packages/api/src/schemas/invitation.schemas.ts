import { z } from 'zod';
import { deliverableEmailSchema, nameSchema, passwordSchema, roleSchema } from './common.js';

export const createInvitationSchema = z.object({
  email: deliverableEmailSchema,
  role: roleSchema,
  /**
   * Only meaningful for SUPERADMIN. A CLIENT_OWNER sending this is ignored:
   * the service pins the invitation to their own tenant regardless.
   */
  tenantId: z.uuid().nullish(),
});

export const acceptInvitationSchema = z.object({
  name: nameSchema,
  password: passwordSchema,
});

export type CreateInvitationBody = z.infer<typeof createInvitationSchema>;
export type AcceptInvitationBody = z.infer<typeof acceptInvitationSchema>;
