import 'dotenv/config';
import { z } from 'zod';

/**
 * Every environment variable this service reads, validated once at startup.
 *
 * The service refuses to boot on invalid configuration rather than failing
 * later on a request. A missing JWT_SECRET should be a crash on line one,
 * not a 500 at 3am.
 */
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3333),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    DATABASE_URL_TEST: z.string().min(1).optional(),

    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),

    ACCESS_TOKEN_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(60 * 15),
    REFRESH_TOKEN_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(60 * 60 * 24 * 30),
    INVITATION_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(60 * 60 * 24 * 7),
    PASSWORD_RESET_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(60 * 60),

    WEB_APP_URL: z.url(
      'WEB_APP_URL must be a full URL, e.g. https://universo.kosmosdigital.com.br',
    ),
    COOKIE_DOMAIN: z.string().optional(),
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),

    /**
     * `console` prints the message (and its raw links) to stdout for
     * development; `resend` sends for real over the Resend HTTP API. The
     * interface is the same to every service either way.
     */
    EMAIL_PROVIDER: z.enum(['console', 'resend']).default('console'),
    EMAIL_FROM: z.string().min(1).default('Universo Kosmos <nao-responda@kosmosdigital.com.br>'),
    /**
     * Resend API key (`re_…`). Secret, server-only. Required when
     * EMAIL_PROVIDER=resend; the domain in EMAIL_FROM must be verified in Resend.
     */
    RESEND_API_KEY: z.string().min(1).optional(),

    VIDEO_PROVIDER: z.enum(['fake', 'panda']).default('fake'),
    PANDA_API_KEY: z.string().min(1).optional(),
    /** Also called the pullzone name. Looks like `vz-6a0bfc2c-30b`. */
    PANDA_LIBRARY_ID: z.string().min(1).optional(),
    /**
     * The watermark group that burns the viewer's identity into playback.
     *
     * This is the feature Panda was chosen for, and it is not part of the API
     * key: a group is created separately and carries its own secret, which
     * signs the JWT the player receives. Without both, playback still works
     * and a leaked recording is untraceable — which was the whole point.
     */
    PANDA_WATERMARK_GROUP_ID: z.string().min(1).optional(),
    PANDA_WATERMARK_SECRET: z.string().min(1).optional(),

    /**
     * How long a minted playback URL stays valid. Long enough to start a
     * lesson on a slow connection, short enough that a URL pasted into a
     * group chat is dead before anyone opens it. The player asks for a fresh
     * one when it expires mid-lesson.
     */
    PLAYBACK_URL_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(60 * 10),

    /** How often the player reports its position while a lesson plays. */
    HEARTBEAT_INTERVAL_SECONDS: z.coerce.number().int().positive().default(15),

    /**
     * Fraction of a lesson that must actually be watched before it counts as
     * complete. Measured against watched time, not the furthest point reached
     * — dragging the scrubber to the end moves the second and not the first.
     */
    LESSON_COMPLETION_RATIO: z.coerce.number().gt(0).max(1).default(0.9),

    /**
     * The fastest playback this service will credit as real watching.
     *
     * Watched time is credited from how far the position moved, but never
     * more than this multiple of the wall-clock time that actually passed.
     * Above 1 so that a client watching at 1.5x or 2x — which the player
     * offers, and which people genuinely use — still finishes the lesson.
     * Bounded so that jumping to the end credits nothing.
     */
    MAX_CREDITED_PLAYBACK_SPEED: z.coerce.number().gte(1).max(10).default(3),

    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    /**
     * Where uploaded images (track banners) are stored. `none` is the default
     * so the service boots with no storage configured — the upload endpoint
     * then answers a clear 503 rather than the process refusing to start.
     * `supabase` uses Supabase Storage over its REST API.
     */
    STORAGE_PROVIDER: z.enum(['none', 'supabase']).default('none'),
    /** The Supabase project URL, e.g. https://xxxx.supabase.co */
    SUPABASE_URL: z.url().optional(),
    /**
     * The service-role key. Secret, server-only — it bypasses row-level
     * security, so it must never reach a browser. Used to sign Storage writes.
     */
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
    /** The public bucket that holds banner images. */
    SUPABASE_STORAGE_BUCKET: z.string().min(1).default('track-banners'),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV === 'production' && value.JWT_SECRET.includes('change-me')) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_SECRET'],
        message: 'JWT_SECRET still holds the example value from .env.example',
      });
    }
    if (value.NODE_ENV === 'production' && value.VIDEO_PROVIDER === 'fake') {
      ctx.addIssue({
        code: 'custom',
        path: ['VIDEO_PROVIDER'],
        message:
          'VIDEO_PROVIDER=fake mints URLs that play nothing. Production needs a real provider.',
      });
    }
    if (value.NODE_ENV === 'test' && !value.DATABASE_URL_TEST) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_URL_TEST'],
        message: 'DATABASE_URL_TEST is required when NODE_ENV=test',
      });
    }
    if (value.EMAIL_PROVIDER === 'resend' && !value.RESEND_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['RESEND_API_KEY'],
        message: 'RESEND_API_KEY is required when EMAIL_PROVIDER=resend',
      });
    }
    if (value.STORAGE_PROVIDER === 'supabase') {
      if (!value.SUPABASE_URL) {
        ctx.addIssue({
          code: 'custom',
          path: ['SUPABASE_URL'],
          message: 'SUPABASE_URL is required when STORAGE_PROVIDER=supabase',
        });
      }
      if (!value.SUPABASE_SERVICE_ROLE_KEY) {
        ctx.addIssue({
          code: 'custom',
          path: ['SUPABASE_SERVICE_ROLE_KEY'],
          message: 'SUPABASE_SERVICE_ROLE_KEY is required when STORAGE_PROVIDER=supabase',
        });
      }
    }
  });

function loadEnv() {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }

  const value = parsed.data;
  const isTest = value.NODE_ENV === 'test';

  return {
    ...value,
    /**
     * Tests never touch the development database. Resolving the URL here
     * rather than at each call site means no test file can get this wrong.
     */
    databaseUrl: isTest ? (value.DATABASE_URL_TEST ?? value.DATABASE_URL) : value.DATABASE_URL,
    isProduction: value.NODE_ENV === 'production',
    isDevelopment: value.NODE_ENV === 'development',
    isTest,
  };
}

export const env = loadEnv();
export type Env = typeof env;
