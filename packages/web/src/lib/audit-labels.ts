/**
 * Portuguese copy for the audit log, keyed by the English action code the API
 * stores. The code is the contract and stays English (see CLAUDE.md → API
 * surface); everything a person reads on the screen is translated here.
 *
 * A `tone` groups actions into how they should read at a glance: `alert` for
 * the events that deserve a red flag — security incidents (a reused token, a
 * failed login, a staff override) and destructive acts (anything deleted, an
 * invite revoked, a role changed, a client archived) — `milestone` for a client
 * finishing something, `neutral` for everything routine. An `alert` row is
 * tinted red in the viewer, not just marked, so it cannot blend into traffic.
 */
export type AuditTone = 'neutral' | 'milestone' | 'alert';

interface AuditActionLabel {
  readonly label: string;
  readonly tone: AuditTone;
}

const ACTION_LABELS: Readonly<Record<string, AuditActionLabel>> = {
  USER_LOGIN_SUCCEEDED: { label: 'Entrou na conta', tone: 'neutral' },
  USER_LOGIN_FAILED: { label: 'Falha ao entrar', tone: 'alert' },
  USER_LOGGED_OUT: { label: 'Saiu da conta', tone: 'neutral' },
  USER_CREATED: { label: 'Usuário criado', tone: 'neutral' },
  USER_ROLE_CHANGED: { label: 'Papel alterado', tone: 'alert' },
  USER_SUSPENDED: { label: 'Usuário suspenso', tone: 'alert' },
  USER_REACTIVATED: { label: 'Usuário reativado', tone: 'neutral' },

  TENANT_CREATED: { label: 'Empresa criada', tone: 'neutral' },
  TENANT_UPDATED: { label: 'Empresa editada', tone: 'neutral' },
  TENANT_ARCHIVED: { label: 'Cliente arquivado', tone: 'alert' },
  TENANT_REACTIVATED: { label: 'Cliente reativado', tone: 'neutral' },
  TENANT_DELETED: { label: 'Cliente excluído', tone: 'alert' },

  INVITATION_SENT: { label: 'Convite enviado', tone: 'neutral' },
  INVITATION_ACCEPTED: { label: 'Convite aceito', tone: 'neutral' },
  INVITATION_REVOKED: { label: 'Convite revogado', tone: 'alert' },

  PASSWORD_RESET_REQUESTED: { label: 'Redefinição de senha pedida', tone: 'neutral' },
  PASSWORD_RESET_COMPLETED: { label: 'Senha redefinida', tone: 'neutral' },

  TRACK_CREATED: { label: 'Trilha criada', tone: 'neutral' },
  TRACK_UPDATED: { label: 'Trilha editada', tone: 'neutral' },
  TRACK_DELETED: { label: 'Trilha excluída', tone: 'alert' },
  TRACK_PUBLISHED: { label: 'Trilha publicada', tone: 'neutral' },
  TRACK_UNPUBLISHED: { label: 'Trilha despublicada', tone: 'neutral' },
  TRACK_ASSIGNED: { label: 'Trilha atribuída', tone: 'neutral' },
  TRACK_UNASSIGNED: { label: 'Trilha removida do cliente', tone: 'neutral' },

  MODULE_CREATED: { label: 'Módulo criado', tone: 'neutral' },
  MODULE_UPDATED: { label: 'Módulo editado', tone: 'neutral' },
  MODULE_DELETED: { label: 'Módulo excluído', tone: 'alert' },
  MODULES_REORDERED: { label: 'Módulos reordenados', tone: 'neutral' },

  LESSON_CREATED: { label: 'Aula criada', tone: 'neutral' },
  LESSON_UPDATED: { label: 'Aula editada', tone: 'neutral' },
  LESSON_DELETED: { label: 'Aula excluída', tone: 'alert' },
  LESSONS_REORDERED: { label: 'Aulas reordenadas', tone: 'neutral' },

  RESOURCE_CREATED: { label: 'Material adicionado', tone: 'neutral' },
  RESOURCE_DELETED: { label: 'Material removido', tone: 'alert' },

  LESSON_COMPLETED: { label: 'Aula concluída', tone: 'milestone' },
  TRACK_COMPLETED: { label: 'Trilha concluída', tone: 'milestone' },

  REFRESH_TOKEN_REUSE_DETECTED: { label: 'Token reutilizado (possível roubo)', tone: 'alert' },
  TENANT_SCOPE_OVERRIDDEN: { label: 'Acesso a dados de um cliente', tone: 'alert' },
};

/** The action codes, in the order they should appear in the filter dropdown. */
export const AUDIT_ACTION_ORDER: readonly string[] = Object.keys(ACTION_LABELS);

export function auditActionLabel(action: string): string {
  return ACTION_LABELS[action]?.label ?? action;
}

export function auditActionTone(action: string): AuditTone {
  return ACTION_LABELS[action]?.tone ?? 'neutral';
}

const ROLE_LABELS: Readonly<Record<string, string>> = {
  SUPERADMIN: 'Equipe Kosmos',
  CLIENT_OWNER: 'Responsável',
  CLIENT_MEMBER: 'Participante',
};

export function auditRoleLabel(role: string | null): string | null {
  if (!role) return null;
  return ROLE_LABELS[role] ?? role;
}
