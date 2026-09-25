import { ApiError } from './api-error';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3333';

/**
 * The access token lives in a module variable, not in localStorage.
 *
 * Anything in localStorage is readable by any script that manages to run on
 * the page, so one cross-site scripting bug would hand over a working token.
 * Held in memory it dies with the tab — and the refresh cookie, which the
 * browser will not let JavaScript read at all, is what quietly brings the
 * session back on the next page load.
 */
let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

type SessionExpiredListener = () => void;
let onSessionExpired: SessionExpiredListener = () => undefined;

export function setSessionExpiredListener(listener: SessionExpiredListener): void {
  onSessionExpired = listener;
}

export interface SessionResponse {
  accessToken: string;
  expiresInSeconds: number;
  user: AuthenticatedUser;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: 'SUPERADMIN' | 'CLIENT_OWNER' | 'CLIENT_MEMBER';
  status: 'ACTIVE' | 'SUSPENDED';
  tenantId: string | null;
  lastLoginAt: string | null;
  avatarUrl: string | null;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /**
   * A raw (non-JSON) body — an image upload, say. When set, it is sent as-is
   * with `rawContentType` and `body` is ignored, so the same refresh-and-retry
   * path covers a binary upload as covers every JSON call.
   */
  rawBody?: BodyInit;
  rawContentType?: string;
  /** Set for the refresh call itself, so a failed refresh cannot recurse. */
  skipRefresh?: boolean;
}

async function parseError(response: Response): Promise<ApiError> {
  let code = 'INTERNAL_ERROR';
  let message = response.statusText;
  let details: unknown;

  try {
    const body: unknown = await response.json();
    if (typeof body === 'object' && body !== null && 'error' in body) {
      const error = (body as { error: { code?: string; message?: string; details?: unknown } })
        .error;
      code = error.code ?? code;
      message = error.message ?? message;
      details = error.details;
    }
  } catch {
    // A non-JSON error body (a proxy timeout page, say) keeps the defaults.
  }

  return new ApiError(code, response.status, message, details);
}

/**
 * Refreshing is serialised, both inside this tab and across tabs.
 *
 * Rotation means the token you present is spent the moment it succeeds, and
 * the API — correctly — reads a spent token turning up again as a stolen one
 * and kills the whole session. So two refreshes must never overlap:
 *
 *  - Within one tab, `refreshInFlight` makes every caller share one request.
 *    React StrictMode alone double-invokes effects in development, which was
 *    enough to log the user straight back out on every page load.
 *  - Across tabs, a Web Lock serialises them. Restoring a browser window with
 *    two tabs open fires two boot refreshes within milliseconds of each other;
 *    without the lock the second arrives holding the token the first just
 *    spent, and both tabs get signed out. The lock makes the second wait, so
 *    it reads the cookie the first one just wrote.
 *
 * This is why the fix belongs here rather than in a grace period on the
 * server: reuse detection stays strict, and a genuinely replayed token is
 * still treated as theft.
 */
const REFRESH_LOCK = 'universo-kosmos:refresh';

let refreshInFlight: Promise<SessionResponse | null> | null = null;

async function performRefresh(): Promise<SessionResponse | null> {
  const rotate = async (): Promise<SessionResponse | null> => {
    try {
      const response = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });

      if (!response.ok) {
        setAccessToken(null);
        return null;
      }

      const session = (await response.json()) as SessionResponse;
      setAccessToken(session.accessToken);
      return session;
    } catch {
      return null;
    }
  };

  if (typeof navigator !== 'undefined' && 'locks' in navigator) {
    return navigator.locks.request(REFRESH_LOCK, rotate);
  }

  return rotate();
}

function refreshSession(): Promise<SessionResponse | null> {
  refreshInFlight ??= performRefresh().finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const send = async (): Promise<Response> => {
    const headers: Record<string, string> = {};
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

    let body: BodyInit | undefined;
    if (options.rawBody !== undefined) {
      body = options.rawBody;
      if (options.rawContentType) headers['Content-Type'] = options.rawContentType;
    } else if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }

    return fetch(`${API_URL}${path}`, {
      method: options.method ?? 'GET',
      credentials: 'include',
      headers,
      body,
    });
  };

  let response: Response;
  try {
    response = await send();
  } catch {
    throw new ApiError('NETWORK_ERROR', 0, 'The API could not be reached');
  }

  // The access token lasts 15 minutes. When it lapses mid-session, renew it
  // and retry once — the client should never see this happen.
  if (response.status === 401 && !options.skipRefresh) {
    const renewed = await refreshSession();

    if (renewed) {
      try {
        response = await send();
      } catch {
        throw new ApiError('NETWORK_ERROR', 0, 'The API could not be reached');
      }
    } else {
      setAccessToken(null);
      onSessionExpired();
      throw await parseError(response);
    }
  }

  if (!response.ok) throw await parseError(response);
  if (response.status === 204) return undefined as T;

  return (await response.json()) as T;
}

export const authApi = {
  login: (email: string, password: string) =>
    request<SessionResponse>('/auth/login', { method: 'POST', body: { email, password } }),

  /**
   * Used on boot, and on the renewal timer, to turn the refresh cookie back
   * into a session. Goes through the same serialised path as an automatic
   * refresh, so a boot and a timer firing together cannot rotate twice.
   */
  restore: (): Promise<SessionResponse | null> => refreshSession(),

  logout: () => request<void>('/auth/logout', { method: 'POST', skipRefresh: true }),

  me: () => request<{ user: AuthenticatedUser }>('/auth/me'),

  updateProfile: (name: string) =>
    request<{ user: AuthenticatedUser }>('/auth/me', { method: 'PATCH', body: { name } }),

  uploadAvatar: (file: File) =>
    request<{ user: AuthenticatedUser }>('/auth/me/avatar', {
      method: 'POST',
      rawBody: file,
      rawContentType: file.type,
    }),

  removeAvatar: () =>
    request<{ user: AuthenticatedUser }>('/auth/me/avatar', { method: 'DELETE' }),

  forgotPassword: (email: string) =>
    request<{ message: string }>('/auth/forgot-password', {
      method: 'POST',
      body: { email },
      skipRefresh: true,
    }),

  resetPassword: (token: string, password: string) =>
    request<void>('/auth/reset-password', {
      method: 'POST',
      body: { token, password },
      skipRefresh: true,
    }),
};

export interface InvitationPreview {
  email: string;
  role: 'SUPERADMIN' | 'CLIENT_OWNER' | 'CLIENT_MEMBER';
  tenantName: string;
  expiresAt: string;
}

export const invitationApi = {
  preview: (token: string) =>
    request<{ invitation: InvitationPreview }>(`/invitations/${token}`, { skipRefresh: true }),

  accept: (token: string, name: string, password: string) =>
    request<SessionResponse>(`/invitations/${token}/accept`, {
      method: 'POST',
      body: { name, password },
      skipRefresh: true,
    }),
};
