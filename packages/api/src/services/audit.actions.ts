/**
 * Audit actions.
 *
 * These are stored as plain strings rather than a PostgreSQL enum on purpose:
 * the list grows every time the product grows, and a database enum would turn
 * "log one more thing" into a schema migration. The constant object below is
 * the single source of truth, and the union type below it means a typo is a
 * compile error rather than a row nobody can ever query.
 */
export const AuditAction = {
  USER_LOGIN_SUCCEEDED: 'USER_LOGIN_SUCCEEDED',
  USER_LOGIN_FAILED: 'USER_LOGIN_FAILED',
  USER_LOGGED_OUT: 'USER_LOGGED_OUT',
  USER_CREATED: 'USER_CREATED',
  USER_UPDATED: 'USER_UPDATED',
  USER_ROLE_CHANGED: 'USER_ROLE_CHANGED',
  USER_SUSPENDED: 'USER_SUSPENDED',
  USER_REACTIVATED: 'USER_REACTIVATED',

  TENANT_CREATED: 'TENANT_CREATED',
  TENANT_UPDATED: 'TENANT_UPDATED',
  TENANT_ARCHIVED: 'TENANT_ARCHIVED',
  TENANT_REACTIVATED: 'TENANT_REACTIVATED',
  TENANT_DELETED: 'TENANT_DELETED',

  INVITATION_SENT: 'INVITATION_SENT',
  INVITATION_ACCEPTED: 'INVITATION_ACCEPTED',
  INVITATION_REVOKED: 'INVITATION_REVOKED',

  PASSWORD_RESET_REQUESTED: 'PASSWORD_RESET_REQUESTED',
  PASSWORD_RESET_COMPLETED: 'PASSWORD_RESET_COMPLETED',

  TRACK_CREATED: 'TRACK_CREATED',
  TRACK_UPDATED: 'TRACK_UPDATED',
  TRACK_DELETED: 'TRACK_DELETED',
  TRACK_PUBLISHED: 'TRACK_PUBLISHED',
  TRACK_UNPUBLISHED: 'TRACK_UNPUBLISHED',
  TRACK_ASSIGNED: 'TRACK_ASSIGNED',
  TRACK_UNASSIGNED: 'TRACK_UNASSIGNED',

  MODULE_CREATED: 'MODULE_CREATED',
  MODULE_UPDATED: 'MODULE_UPDATED',
  MODULE_DELETED: 'MODULE_DELETED',
  MODULES_REORDERED: 'MODULES_REORDERED',

  LESSON_CREATED: 'LESSON_CREATED',
  LESSON_UPDATED: 'LESSON_UPDATED',
  LESSON_DELETED: 'LESSON_DELETED',
  LESSONS_REORDERED: 'LESSONS_REORDERED',

  RESOURCE_CREATED: 'RESOURCE_CREATED',
  RESOURCE_DELETED: 'RESOURCE_DELETED',

  /**
   * Progress milestones, and only milestones.
   *
   * A heartbeat arrives every few seconds per viewer per lesson; auditing
   * those would bury every other row within a week. The telemetry lives in
   * `watch_events` and the running total in `lesson_progress`. What belongs in
   * an append-only ledger is the moment something became true.
   */
  LESSON_COMPLETED: 'LESSON_COMPLETED',
  TRACK_COMPLETED: 'TRACK_COMPLETED',

  /** A revoked refresh token was presented again — the token was stolen. */
  REFRESH_TOKEN_REUSE_DETECTED: 'REFRESH_TOKEN_REUSE_DETECTED',

  /** Kosmos staff deliberately reached into a specific client's data. */
  TENANT_SCOPE_OVERRIDDEN: 'TENANT_SCOPE_OVERRIDDEN',
} as const;

export type AuditActionValue = (typeof AuditAction)[keyof typeof AuditAction];

export const AuditEntity = {
  USER: 'User',
  TENANT: 'Tenant',
  INVITATION: 'Invitation',
  SESSION: 'Session',
  TRACK: 'Track',
  MODULE: 'Module',
  LESSON: 'Lesson',
  RESOURCE: 'Resource',
  TRACK_ASSIGNMENT: 'TrackAssignment',
} as const;

export type AuditEntityValue = (typeof AuditEntity)[keyof typeof AuditEntity];
