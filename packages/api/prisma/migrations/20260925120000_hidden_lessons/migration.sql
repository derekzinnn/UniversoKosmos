-- Per-client lesson access (denylist). A row hides one lesson from one tenant.
-- Hand-written and idempotent, per CLAUDE.md: `prisma migrate dev` hangs against
-- Supabase (no shadow DB), and the test schema drifts, so every statement guards
-- against already existing.

CREATE TABLE IF NOT EXISTS "hidden_lessons" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "lesson_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "hidden_lessons_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "hidden_lessons_tenant_id_lesson_id_key"
    ON "hidden_lessons" ("tenant_id", "lesson_id");

CREATE INDEX IF NOT EXISTS "hidden_lessons_tenant_id_idx"
    ON "hidden_lessons" ("tenant_id");

CREATE INDEX IF NOT EXISTS "hidden_lessons_lesson_id_idx"
    ON "hidden_lessons" ("lesson_id");

-- ADD CONSTRAINT has no IF NOT EXISTS, so swallow the duplicate on re-run.
DO $$ BEGIN
    ALTER TABLE "hidden_lessons"
        ADD CONSTRAINT "hidden_lessons_tenant_id_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "hidden_lessons"
        ADD CONSTRAINT "hidden_lessons_lesson_id_fkey"
        FOREIGN KEY ("lesson_id") REFERENCES "lessons" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
