# Universo Kosmos

Client onboarding platform for **Kosmos Inteligência Digital**.

A client signs a contract, receives an invitation by email, sets a password, and
works through a classroom-style onboarding track. Kosmos sees exactly who logged
in, who watched what, who is stuck and who has not started.

---

## Status

| Phase       | Scope                                                                        | State       |
| ----------- | ---------------------------------------------------------------------------- | ----------- |
| **Phase 0** | Monorepo, database schema, auth, invitations, RBAC, audit log                | ✅ **Done** |
| **Phase 1** | Course content CRUD, ordering, publishing, track assignment                  | ✅ **Done** |
| Phase 2     | Panda Video, signed playback, player, heartbeat telemetry, sequential unlock | ✅ **Done** |
| Phase 3     | Client-facing classroom UI and progress experience                           | ✅ **Done** |
| Phase 4     | Admin console: onboarding funnel, per-client drill-down, audit viewer        | ✅ **Done** |

---

## Running it

```bash
npm install                       # also runs `prisma generate`
cp packages/api/.env.example packages/api/.env
cp packages/web/.env.example packages/web/.env
npm run db:migrate                # applies migrations to DATABASE_URL
npm run db:seed                   # creates the first SUPERADMIN
npm run dev                       # api on :3333, web on :5173
```

`npm run db:seed` prints the credentials it created. Nothing else can exist
until that account does — there would be nobody to send the first invitation.

| Command                                        | What it does                                             |
| ---------------------------------------------- | -------------------------------------------------------- |
| `npm run dev`                                  | Runs API and web together                                |
| `npm test`                                     | Vitest in both packages (API tests need a live Postgres) |
| `npm run typecheck`                            | `tsc --noEmit` in both packages                          |
| `npm run lint`                                 | ESLint across the monorepo                               |
| `npm run format`                               | Prettier write                                           |
| `npm run build`                                | Production build of both packages                        |
| `npm run db:migrate` / `db:seed` / `db:studio` | Prisma helpers                                           |

---

## Architecture

```
packages/api                      Express 5 + Prisma 7 + PostgreSQL
  prisma/
    schema.prisma                 The whole data model, Phase 0 → Phase 4
    migrations/                   Includes hand-written database guarantees
    seed.ts                       First Kosmos staff account
  src/
    routes/                       HTTP surface, middleware wiring, nothing else
    controllers/                  Read request → call one service → shape response
    services/                     Every business rule and every transaction
    repositories/                 Every database query
    db/                           Prisma client, tenant scope, tenant guard
    middleware/                   auth, RBAC, rate limits, validation, errors
    lib/                          password, tokens, jwt, cookies, logger, errors
    schemas/                      Zod request schemas
  tests/                          Integration tests against a real database

packages/web                      Vite + React 19 + Router + TanStack Query
  src/
    auth/                         Auth context, silent refresh, route guards
    hooks/                        useHeartbeat — the player's reporting loop
    theme/                        Light/dark/system, resolved before first paint
    components/ui/                shadcn-style primitives
    components/states/            Loading, empty and error states
    pages/                        One file per route
    lib/                          API client, error → Portuguese copy mapping
    index.css                     Design tokens, light and dark. Every colour resolves here.
```

**Business rules live in services.** Controllers make no decisions and touch no
database. Repositories run queries and hold no rules.

---

## The tenant guard

The part that matters most. Tenant isolation is enforced in three layers, and
each one assumes the others might fail.

**1. Scope, carried by the request.** Every authenticated request resolves to a
`RequestContext { userId, email, role, tenantId, ip, userAgent }`. Services open
a scope with `runAsContext(context, …)`, which pins a client user to their own
tenant and lets Kosmos staff run globally. The scope travels through
`AsyncLocalStorage` — a backpack strapped to the request that every function it
calls can look inside, however deeply nested.

**2. `ScopedDb`, which supplies the filter.** Repositories never receive a raw
Prisma client. They get a `ScopedDb` that merges the tenant filter in _after_
whatever the caller passed, so a forged `tenantId` in a request body is replaced
rather than obeyed.

**3. The tripwire, which refuses anything unscoped.** A Prisma client extension
inspects every query for a tenant-scoped model and throws
`TenantScopeViolationError` if it is not pinned to the active scope. It does not
quietly repair the query — silent repair hides the bug, and the next query
written the same way may not be repairable.

Opening a hole is possible but never accidental: `runInGlobalScope(reason, …)`
takes a named reason from a closed union, so `grep -r "superadmin:"` lists every
override the codebase can perform.

### Known limits

- **Nested reads inherit their parent's scope.** A query on an unscoped model
  that includes a scoped relation (`track.findMany({ include: { assignments: …
} })`) is not checked, because Prisma reports it as one operation.

  Phase 1 is where this first mattered. A client's tracks could have been read
  as `track.findMany({ where: { assignments: { some: { tenantId } } } })` —
  correct today, and silently every client's tracks the day somebody edits that
  filter, because the guard never sees it. Instead the query runs from the
  guarded side: `trackAssignment.findMany({ include: { track: … } })`.
  `TrackAssignment` carries the tenant column, so the filter is checked.
  **Read a client's content through the assignment, never through the track.**

  PostgreSQL row-level security is the defence-in-depth answer and is
  deliberately deferred — it needs a separate database role.

- **Writes must set the scalar foreign key.** A nested `connect` is invisible to
  the guard; the error message says so when it fires.

### Five things Prisma 7 does that will bite you

- **Prisma promises are lazy.** `db.user.findFirst()` builds a promise and runs
  nothing until it is awaited. A scope callback that _returns_ a query instead
  of awaiting it hands it back after the scope has been restored, and the query
  then executes under whatever scope is active outside. `withTenantScope` and
  `withGlobalScope` await inside the store for exactly this reason.
- **A driver adapter is mandatory.** `new PrismaClient()` with no options throws.
  Prisma compiles the query; `pg` delivers it.
- **`?schema=` in the URL does nothing.** It was a parameter Prisma's own
  engine understood. The adapter hands the URL to `pg`, which does not know
  that parameter and quietly ignores it — so every query lands in `public`
  while the rest of the process believes otherwise. The schema is passed to
  `PrismaPg` as an explicit option in `db/prisma.ts`. This failed silently for
  a whole test run, which wrote its fixtures into the development schema.
- **`timestamp` columns are read through the driver's timezone.** A
  `timestamp without time zone` is an instant with the offset discarded, and
  `pg` guesses it back using the timezone of the Node process — so on any
  server not running in UTC, every read is shifted by the local offset. Every
  `DateTime` in the schema therefore carries `@db.Timestamptz(3)`. **Add it to
  any new one**; the failure is silent, and mixes cleanly with correct data.
- **`prisma migrate dev` hangs against Supabase.** It wants a shadow database to
  diff against, and the connection role cannot create one, so it never returns.
  Author migrations by hand instead: add the column to `schema.prisma`, write
  `prisma/migrations/<timestamp>_<name>/migration.sql` yourself (make the DDL
  idempotent — `ADD COLUMN IF NOT EXISTS` — since the test schema drifts), then
  apply it with `npm run db:migrate` (`migrate deploy`, which needs no shadow
  DB) and `prisma generate`. `db:migrate` uses `DATABASE_URL` from
  `prisma.config.ts`. The `track_cover_image` migration is the worked example.

---

## Audit log

`audit(tx, …)` writes through the caller's transaction handle, so an audit row
shares the fate of the action it describes — if the action rolls back, the log
rolls back with it.

`auditDetached(…)` commits on its own and never throws. It exists for one
specific case: a failed login must be recorded _and then_ rejected, and if that
record lived in the request's transaction the rejection would roll the evidence
away.

**The log is append-only, enforced by the database.** `audit_logs` carries
`BEFORE UPDATE` and `BEFORE DELETE` triggers that raise an exception no matter
who issues the statement, including the application's own connection. There is
no update or delete method for audit rows anywhere in the codebase, and ESLint
fails the build if one is added.

> **TRUNCATE caveat.** Row-level triggers do not fire for `TRUNCATE`, and a
> statement-level guard would also block `prisma migrate reset` and the test
> harness. `TRUNCATE` requires table-owner privileges, so this is covered by not
> granting ownership to the application's database role in production. See
> **Infra requirements**.

Actions recorded in Phase 0: `USER_LOGIN_SUCCEEDED`, `USER_LOGIN_FAILED`,
`USER_LOGGED_OUT`, `USER_CREATED`, `USER_ROLE_CHANGED`, `USER_SUSPENDED`,
`USER_REACTIVATED`, `TENANT_CREATED`, `TENANT_UPDATED`, `INVITATION_SENT`, `INVITATION_ACCEPTED`,
`INVITATION_REVOKED`, `PASSWORD_RESET_REQUESTED`, `PASSWORD_RESET_COMPLETED`,
`REFRESH_TOKEN_REUSE_DETECTED`, `TENANT_SCOPE_OVERRIDDEN`.

Added in Phase 1: `TRACK_CREATED`, `TRACK_UPDATED`, `TRACK_DELETED`,
`TRACK_PUBLISHED`, `TRACK_UNPUBLISHED`, `TRACK_ASSIGNED`, `TRACK_UNASSIGNED`,
`MODULE_CREATED`, `MODULE_UPDATED`, `MODULE_DELETED`, `MODULES_REORDERED`,
`LESSON_CREATED`, `LESSON_UPDATED`, `LESSON_DELETED`, `LESSONS_REORDERED`,
`RESOURCE_CREATED`, `RESOURCE_DELETED`.

Added in Phase 2: `LESSON_COMPLETED`, `TRACK_COMPLETED`. Only milestones. A
heartbeat lands every few seconds per viewer per lesson, and auditing those
would bury every other row within a week — the raw telemetry lives in
`watch_events`, the running total in `lesson_progress`, and the ledger keeps
only the moment something became true.

---

## Database guarantees

Rules PostgreSQL enforces itself, because a bug in the application must not be
able to break them. All live in `prisma/migrations/*_phase0_guarantees/`.

| Guarantee                                             | Why                                                                            |
| ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| `audit_logs` rejects UPDATE and DELETE                | An audit log you can edit is not an audit log                                  |
| `users.role = SUPERADMIN` **iff** `tenant_id IS NULL` | No "SUPERADMIN of Tenant A"; no tenant-less client user the guard cannot scope |
| Same rule on `invitations`                            | You cannot invite someone to be a SUPERADMIN of a tenant                       |
| `email = lower(btrim(email))` on both tables          | Makes the UNIQUE index unbypassable via `Owner@Client.com`                     |

This migration is hand-written. Prisma cannot express any of it in
`schema.prisma`, so **it must be kept in step with the schema by hand.**

---

## Authentication

**Access token** — a 15-minute JWT (HS256, via `jose`). A festival wristband:
checkable at a glance without asking the database, and for that same reason
impossible to cancel once issued. Held in a JavaScript variable, never in
`localStorage`, so one XSS bug cannot lift a session.

**Refresh token** — 256 bits of randomness in an httpOnly, SameSite=Lax cookie
scoped to `/auth`, stored **SHA-256 hashed**. A locker key: meaningless in
itself, works only because the database holds a matching record, cancellable
instantly. SHA-256 rather than argon2 because the token is already unguessable —
slow hashing would add latency to every refresh and buy nothing.

**Rotation and reuse detection.** Every refresh burns the old token and issues a
new one. Each _login_ opens a **family**; rotation stays inside it. A token that
was already spent turning up again means it was copied, so the whole family is
revoked and `REFRESH_TOKEN_REUSE_DETECTED` is written. Other devices have their
own families and keep working.

> Because rotation is strict, the web client serialises refreshes: one in-flight
> promise per tab, and a **Web Lock** across tabs. Without it, restoring a
> browser window with two tabs open fires two boot refreshes milliseconds apart,
> the second arrives holding the token the first just spent, and both tabs are
> signed out. The fix is on the client on purpose — a grace period on the server
> would have weakened reuse detection instead.

**Passwords** — argon2id, 64 MiB / 3 iterations / parallelism 4. bcrypt makes an
attacker's computer think hard; argon2id makes it think hard _and_ need a lot of
memory, which is what hurts the GPU farms that actually crack passwords. bcrypt
also silently truncates at 72 bytes.

**No enumeration.** Unknown email, wrong password and suspended account all
return the identical `INVALID_CREDENTIALS` body, and a login for an address that
does not exist verifies against a throwaway hash so it takes just as long.
`POST /auth/forgot-password` always answers 202.

---

## API surface (Phase 0)

| Method  | Path                         | Access                   |
| ------- | ---------------------------- | ------------------------ |
| `GET`   | `/health`                    | Public                   |
| `POST`  | `/auth/login`                | Public, rate limited     |
| `POST`  | `/auth/refresh`              | Refresh cookie           |
| `POST`  | `/auth/logout`               | Refresh cookie           |
| `GET`   | `/auth/me`                   | Authenticated            |
| `POST`  | `/auth/forgot-password`      | Public, rate limited     |
| `POST`  | `/auth/reset-password`       | Public, rate limited     |
| `POST`  | `/invitations`               | SUPERADMIN, CLIENT_OWNER |
| `GET`   | `/invitations`               | SUPERADMIN, CLIENT_OWNER |
| `GET`   | `/invitations/:token`        | Public                   |
| `POST`  | `/invitations/:token/accept` | Public                   |
| `POST`  | `/tenants`                   | SUPERADMIN               |
| `GET`   | `/tenants`                   | Authenticated (scoped)   |
| `GET`   | `/tenants/:id`               | Authenticated (scoped)   |
| `PATCH` | `/tenants/:id`               | SUPERADMIN               |

### Added in Phase 2

| Method | Path                     | Access                    |
| ------ | ------------------------ | ------------------------- |
| `GET`  | `/lessons/:id/playback`  | Assigned client, or staff |
| `GET`  | `/lessons/:id/progress`  | Assigned client           |
| `POST` | `/lessons/:id/heartbeat` | Assigned client, unlocked |

None of the three is behind a role gate, on purpose. "Are you staff?" is the
wrong question and answers it backwards: staff may preview any lesson, a client
may reach only what their company was assigned and has unlocked. The services
resolve that from the assignment and the unlock rule, which is a finer test
than a role check can make.

A lesson the caller was never assigned answers **404, not 403**. A 403 confirms
the lesson exists, which is what somebody enumerating ids is trying to learn.

### Added in Phase 4

| Method   | Path                 | Access     |
| -------- | -------------------- | ---------- |
| `GET`    | `/audit-logs`        | SUPERADMIN |
| `GET`    | `/funnel`            | SUPERADMIN |
| `POST`   | `/tracks/:id/cover`  | SUPERADMIN |
| `DELETE` | `/tracks/:id/cover`  | SUPERADMIN |
| `GET`    | `/clients/:tenantId` | SUPERADMIN |

`/funnel` is the onboarding overview: every client's furthest stage (invited →
joined → started → completed) plus the cumulative counts. Like the audit read
it is SUPERADMIN-only and a global read by nature, and like the admin client
list it is **deliberately unaudited** — a dashboard staff load routinely, not a
drill-into-one-client act. The numbers are assembled in memory from a handful
of column-thin queries rather than one join, which at onboarding scale is both
cheaper to run and the place where every stage rule lives in one readable spot.
A zero denominator (a client with no assigned track) never reads as
"completed"; it stays at whatever stage its people reached.

The two `/cover` routes set and clear a track's banner image. The body is the
raw image (not multipart), buffered by `express.raw` for the three allowed
types and capped at 5 MB before the handler sees it. Storage sits behind a thin
`StorageProvider` seam — `upload` / `remove` / `publicUrl` — mirroring
`EmailProvider` and `VideoProvider`: `STORAGE_PROVIDER=none` (the default) boots
with no credentials and answers the upload with 503, `supabase` uploads to a
public bucket over its REST API with the service-role key. Only the object
_path_ is stored on `Track.coverImagePath`; the public URL is derived in the
mapper, so the bucket can move without a data migration. The bytes are uploaded
before the path is committed, and the previous object is deleted only after —
best-effort, since a leftover object is cheaper than a lost update. A null path
falls back to the generated orbit `TrackCover`, so a banner is always optional.
On the web, a picked image goes through a client-side cropper before upload:
the author frames it inside the banner's 5:2 window (pan + zoom) and the result
is drawn to a fixed 1280×512 JPEG, so every stored banner has the exact shape
the card shows — no server-side squish, and a bounded file size — whatever the
original was.

`/clients/:tenantId` is the **per-client drill-down** — one company's onboarding
lesson by lesson. Unlike the funnel, opening it is the audited act: the service
wraps every read in `runAsSuperadminOnTenant`, which pins the queries to that
one tenant and writes a `TENANT_SCOPE_OVERRIDDEN` line (reason `client-drilldown`,
once per request) — glancing at everyone is free, reaching into one named
company is logged. Content is read through `TrackAssignment` (the guarded side),
never `track.findMany`. The response is `{ tenant, members, tracks, progress }`
where `progress` is a **sparse** matrix — only the (member, lesson) cells that
have any progress — and the client fills the "not started" blanks, so the
payload does not balloon to members × lessons.

The read side of the audit ledger. **This one _is_ behind a role gate**, and
that is the right question here: the log spans every client and records many
rows with no tenant at all (a failed login before any tenant is known, a
superadmin override), so it is a global read no client account may make — even
for their own company. Unlike the playback endpoints, there is no per-row
assignment to resolve; "are you Kosmos staff?" is exactly the test. The route
enforces it and `audit-query.service.ts` re-checks, because the service is
where the boundary lives.

`AuditLog` is deliberately absent from the tenant guard's model map (it carries
no checked tenant column), so the read runs in a named global scope and
pagination is **keyset, not offset**: ids are UUIDv7, so ordering by `id`
descending is newest-first and the cursor is the last id seen — a page cannot
skip or repeat a row when new entries land between requests. Tenant names are
resolved once per page from the ids the page happens to contain, since the
ledger holds no foreign key to join on. Filters: `action`, `tenantId`,
`actorUserId`, `entityType`, `entityId`, `from`, `to`, `cursor`, `limit`.

Errors are `{ error: { code, message, details? } }`. **`code` is the contract**
and is English; Portuguese copy lives in `packages/web/src/lib/api-error.ts`,
keyed by code, so the API stays language-neutral. Field-level validation
messages are the exception — they come back already in Portuguese, because the
web forms validate against the same Zod schemas.

---

## Language

All copy a client reads is **Brazilian Portuguese**. All code, comments, commit
messages and identifiers are **English**.

---

## Decisions taken in Phase 0

| Decision                      | Choice                                 | Why                                                                                                                                                                                                               |
| ----------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript version            | **6.0.3**, not 7.0.2                   | `typescript-eslint@8` declares `typescript <6.1.0`. TS 7 means no type-aware linting — and `no-floating-promises` is the single most valuable rule in an auth codebase                                            |
| Superadmin override auditing  | **Once per request per target tenant** | Logging every overriding query would make the log 95% noise within a month. Reading a global list is staff doing their job; _drilling into one named client_ is the audit-worthy act                              |
| Token family revocation       | **Family only**                        | OAuth 2.0 Security BCP. The compromised device's chain dies; the client's other devices stay signed in                                                                                                            |
| Email uniqueness              | **Global**                             | One email, one user, one unambiguous login lookup. If a person ever needs to belong to two client companies, the migration is `@@unique([tenantId, email])` plus a tenant picker                                  |
| Audit action storage          | **String, not a PG enum**              | The list grows constantly; an enum would turn "log one more thing" into a schema migration. A TypeScript union catches typos at compile time                                                                      |
| `AuditLog` foreign keys       | **None**                               | `onDelete: SetNull` is implemented as an UPDATE, which the append-only trigger refuses. The FK and immutability are mutually exclusive, so the log is a standalone ledger with `actorEmail`/`actorRole` snapshots |
| `tenantId` on progress tables | **Denormalised**                       | Derivable through `user`, but Phase 4's funnel filters by tenant constantly, and it lets the guard treat every scoped table identically. Users never change tenant, so it cannot drift                            |
| `WatchEvent.id`               | **BigInt sequence**                    | The only table that grows without bound. Its rows are aggregated, never addressed individually, so BigInt never crosses the JSON boundary                                                                         |
| Table naming                  | **snake_case, plural**                 | We write raw SQL for the triggers and read these tables in the Supabase dashboard                                                                                                                                 |
| `CLIENT_OWNER` invite rights  | **`CLIENT_MEMBER` only**               | Promoting someone to account owner is a decision about the commercial relationship, so it stays with Kosmos. One line in `INVITABLE_ROLES` if you disagree                                                        |
| Email vendor                  | **Deferred**                           | `EmailProvider` interface with a console implementation. Choosing Resend/SES/Postmark later is one new file and one line in the factory                                                                           |

### Decisions taken in Phase 1

| Decision                   | Choice                                           | Why                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reordering                 | **Full ordered list, applied in two passes**     | `@@unique([trackId, order])` refuses two rows at one position even momentarily, and a Prisma `@@unique` is a plain index, checked per statement rather than deferred to commit. Every row is parked in negative space first, where nothing collides, then written to 0..n-1. Sending the whole list, rather than "move item 3 up", also makes a stale client view detectable — a set that does not match exactly what exists is rejected |
| Slugs                      | **Derived from the title, made unique**          | One less field to fill in. An explicitly supplied slug is never silently altered: a shared link that changes underneath is worse than a rejected request                                                                                                                                                                                                                                                                                 |
| Publishing                 | **Validated, and reports every problem at once** | A track a client cannot finish is worse than one they cannot start. Empty track, empty module, and a required lesson with no video all block publication, and the endpoint returns the whole list so the fix is one pass rather than a game of whack-a-mole. `GET /tracks/:id/readiness` answers the same question without attempting to publish                                                                                         |
| Deleting content           | **Blocked when it would erase history**          | A published or assigned track cannot be deleted, and neither can a lesson or module a client has already started — the schema cascades to `LessonProgress`, so a careless click would silently erase what someone watched. The guard is in place now even though Phase 2 writes the first such row                                                                                                                                       |
| Route shape                | **`/modules/:id`, not `/tracks/:t/modules/:m`**  | Ids are unique, so the ancestry in a URL adds nothing except a second source of truth that can disagree with the database                                                                                                                                                                                                                                                                                                                |
| `externalVideoId` exposure | **Staff only; clients get `hasVideo`**           | Phase 2 serves playback through a signed URL. A raw video id reaching a client browser now would make that pointless later, so the client mapper never includes it                                                                                                                                                                                                                                                                       |
| Client-facing reads        | **Through `TrackAssignment`**                    | See **Known limits**. The guarded side of the relation is the only side that can be checked                                                                                                                                                                                                                                                                                                                                              |
| A minimal Clients screen   | **Added, though the console is Phase 4**         | Without a way to create a company and invite its owner, the assign dropdown is permanently empty and Phase 1 cannot be used at all. The funnel, drill-down and audit viewer remain Phase 4                                                                                                                                                                                                                                               |

### Decisions taken ahead of Phase 2

| Decision     | Choice                            | Why                                                                                                                                                                                                                                                                                                                                                          |
| ------------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Video vendor | **Panda Video, not Bunny Stream** | Kosmos intends to sell courses later. That turns the Panda feature set — per-viewer dynamic watermark, DRM, domain lock — from something this onboarding platform does not need into the thing that protects the product. Choosing it now costs one column rename; choosing it after Phase 2 costs the integration plus re-uploading the whole video library |

**What this trades away, knowingly.** Bunny is cheaper per GB at low volume and
has no plan floor, and the engagement analytics built into Panda is redundant
here — `WatchEvent` and `LessonProgress` stay the source of truth, because the
Phase 4 funnel joins watch data against invitations and logins in our own
Postgres, and no third-party dashboard can do that join. Panda earns its price
on protection, and on billing in BRL with a nota fiscal, which Bunny cannot
issue to a Brazilian company.

**The abstraction is deliberately thin.** A `VideoProvider` interface covers
minting a signed playback URL and reading a real duration — the two things the
API needs — following the `EmailProvider` precedent. It stops at the player:
every vendor ships its own embed, so swapping vendors would still mean rewriting
the player component. Pretending otherwise would buy a false sense of
portability.

### Decisions taken in Phase 2 — API

| Decision                    | Choice                                         | Why                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where completion is decided | **Watched time, never furthest position**      | Dragging a scrubber to the end moves the position instantly and the clock not at all. Kosmos is going to act on "who finished onboarding", so the number behind it has to be one a client cannot produce by accident or on purpose                                                                                                                    |
| Crediting watched time      | **New ground, capped by wall clock × 3**       | Two defences that fail differently: credit is only given past the furthest point previously reached, so replaying the intro thirty times credits it once; and it is capped at what elapsed time allows. The cap is above 1× because people genuinely watch training at 1.5× and 2×, and refusing to ever complete those people reads as a bug         |
| Unknown duration            | **Never auto-completes**                       | Guessing a length would let a wrong number decide who finished. Panda reports the real one; until it does, the lesson is watchable and simply does not close                                                                                                                                                                                          |
| The unlock rule             | **Pure, and separately tested**                | It decides what a client may open. A rule that heavy should be checkable without standing up PostgreSQL, so it lives in `unlock.ts` with no database, no scope and no clock — the service supplies facts, the rule returns a verdict                                                                                                                  |
| Unlock enforcement          | **On playback and on every heartbeat**         | Not only when the player opens. A client that keeps posting after being told no is precisely the case worth handling, and the check costs nothing already loaded                                                                                                                                                                                      |
| Playback auditing           | **None**                                       | Every press of play would write a row, and a log that grows with viewing rather than with decisions is a log nobody reads. `watch_events` exists so the ledger does not have to carry it                                                                                                                                                              |
| Staff progress              | **Impossible, not merely empty**               | Every progress row carries a tenant and staff belong to none. Rather than inventing one, watching is not something a staff account does — they preview instead. "Who watched what" keeps exactly one kind of answer                                                                                                                                   |
| Column naming               | **`external_video_id`, never the vendor name** | It was `bunny_video_id`, then `panda_video_id`, and the choice was reopened four times in two sittings. Each reopening dragged the schema, a migration, the Zod schemas, the API and the web package along with it, for a value opaque to all of them. `VideoProvider` is where the vendor belongs; in front of that seam nothing should have to know |
| Provider abstraction        | **Thin, and stops at the player**              | `VideoProvider` covers signing a URL and reading a duration. It does not cover the player: every vendor ships its own embed, so swapping vendors still means rewriting that component. An interface that implied otherwise would sell a portability nobody has                                                                                        |

### Light and dark

The dark palette was written in Phase 0 and nothing switched it on for three
phases. `index.html` had already declared `color-scheme: light dark`, so a
client whose laptop was dark got a bright white screen from a page that had
told the browser to expect otherwise.

**Three states, not two.** `system` is the default and keeps following the
operating system, so a machine that dims at sunset dims the app with it.
Choosing light or dark opts out of that — which is the entire reason somebody
reaches for the control, and a two-state toggle strands "follow the system"
forever after the first click.

**Resolved before the first paint.** An inline script in `index.html` applies
the class before React loads. Without it the first paint is light and the
correction lands a frame later: a white flash on a dark screen, at exactly the
moment somebody is opening the app at night. The storage key is duplicated
between that script and `theme/theme-context.ts`, and the two must not drift.

### The vendor swap point

Exactly two places know which video provider is in use:

    packages/api/src/services/video/     minting a signed URL, reading a duration
    packages/web/src/components/LessonPlayer.tsx    putting it on screen

Nothing else does — not the schema (the column is `external_video_id`), not the
unlock rule, not the heartbeat, not the progress view. `LessonPlayer` takes a
URL, a resume position in seconds, and callbacks; it hands back positions in
seconds and a playing/paused boolean. That contract survives the change from a
bare `<video>` to Panda's `<iframe>`, which the watermark requires — the
watermark lives inside Panda's own player, so a plain `<video>` could never
carry it. That swap touched only `LessonPlayer` and the video service.

### Phase 2 is wired to Panda, and verified

The provider is real, not a stub. `PandaVideoProvider` signs a per-viewer
watermark JWT (HS256, `jose`, the group secret) and returns Panda's embed URL;
`fetchDurationSeconds` reads `GET /videos/{id}`. Verified against a real
uploaded video through the HTTP API: `/lessons/:id/playback` returns a URL on
the configured library with a watermark token, and the real duration comes
back correct.

**Panda's protection is not an expiring URL.** There is no timestamped HMAC
link the way Bunny signs one. Three things protect a video together: the
per-viewer watermark (traceability), domain lock in the dashboard (a pasted
link will not play off an allowed domain), and the unlock and assignment checks
upstream. `expiresInSeconds` bounds the watermark token, and `expiresAt` still
means what it says.

**The video id is Panda's UUID, not the file title.** `da44...` not
`qph-nyfp-rhu`. Pasting the title silently attaches nothing. A video picker
that lists the library and hands back the id is the fix, and is the next piece
of authoring UI.

**The player uses Panda's own `api.v2.js`, for two reasons.** The raw
`postMessage` listener receives `panda_timeupdate`, but Panda only starts
broadcasting those once a `PandaPlayer` is instantiated over the iframe — the
constructor is the handshake. That same player object is how the saved position
is restored: `setCurrentTime` on ready. The iframe therefore carries the id
`panda-<videoId>`, which is what the API binds to. If the script fails to load,
the message listener still delivers position and play state; only the resume
seek is lost, and starting from the top is safe.

**Explicit completion is gated by reaching the end, not by watched time.** A
client near the end of a video presses "Marcar como concluída"
(`POST /lessons/:id/complete`, with the reported position); the server closes
the lesson when that position is in the last tenth. This is a deliberate
product choice by Kosmos, and a departure from the automatic completion the
heartbeat still does by watched time: for onboarding — a contract client
working through their own setup, not a paid course a viewer games — "reached
the end" is the bar the owner wants, so a client may finish even after skipping.
A lesson whose length is unknown still cannot be closed: there is no end to reach.

**The player isolates its iframe from React.** A `<div>` React owns holds an
iframe React does not — the effect creates and removes it by hand. Panda's
`api.v2.js` reparents and rewrites the frame, and when React also tracked that
node, unmounting the classroom (pressing "voltar") reached for an iframe Panda
had moved and threw `tagName of null` into the error boundary. Owning the frame
by hand removes the collision; `replaceChildren` puts it in and takes it out.

**Still not confirmed on a live stream:** that `panda_timeupdate` arrives with
the documented field name and cadence once a real video plays. The handshake and
resume are wired per Panda's docs and the button flow is verified end to end
(the server refused a scrubbed completion with 400), but a real playthrough is
what proves the position actually advances. If it does not, the field name in
`LessonPlayer` is the one-line place to look.

### Things flagged as risky

- **Per-email rate limiting is a lockout weapon.** Anyone who knows a client's
  address can burn their quota. It is deliberately loose (40/hour) with
  `skipSuccessfulRequests`, so a client typing the right password never spends
  any of it. The strict limits are per IP and per IP+email. Residual risk — a
  distributed flood temporarily locking one account — is accepted and visible in
  the audit log.
- **`watch_events` grows with heartbeat volume, and nothing rate-limits it.**
  An authenticated client posting heartbeats in a loop cannot gain progress —
  the credit rule is bound by the wall clock — but it can insert rows as fast
  as it likes. The fix is a floor on how often an event is written (the
  aggregate would still update); it is not in yet, and it is the first thing
  to add before this endpoint meets real traffic.
- **`SameSite=Lax` constrains DNS.** See **Infra requirements**.
- **In-memory rate limiting does not survive a second instance.** Fine on one
  container; the moment the API scales horizontally the limits become
  per-instance and effectively multiply. Redis is the fix, deferred.
- **`npm audit` reports a high-severity advisory in `deepmerge-ts`**, reached
  through `@prisma/config`. It is a Prisma **CLI** dependency — it never runs in
  the request path — and the input it merges is our own config file. The only
  offered fix downgrades Prisma to 6.12. Not taken; re-check when Prisma ships
  an updated `@prisma/config`.

---

## Infra requirements

Everything below is handled outside this repository.

**DNS — the one that will silently break production.** The refresh cookie is
`SameSite=Lax`, which a browser only sends when the API and the web app are
_same-site_, meaning they share a registrable domain (`kosmosdigital.com.br`).
So `universo.kosmosdigital.com.br` → `api.kosmosdigital.com.br` works, and
`universo.kosmosdigital.com.br` → `kosmos-api.fly.dev` sends no cookie at all:
every silent refresh fails in production while working perfectly in development.
If the API cannot share the domain, the cookie must become `SameSite=None;
Secure` and CSRF protection has to be added.

**`TRUST_PROXY` must match the real number of proxies.** Behind Caddy it is `1`.
Too low and every request appears to come from the proxy — rate limits collapse
into one shared bucket and every audit row records the same useless IP. Too high
and a client can forge their own IP by sending `X-Forwarded-For` themselves.

**The application's database role must not own `audit_logs`.** The append-only
triggers stop UPDATE and DELETE, but a table owner can still `TRUNCATE` the
table or drop the triggers. Migrations run as the owner; the API should connect
as a role with `SELECT, INSERT, UPDATE, DELETE` and no ownership.

**`DATABASE_URL_TEST`** must point at a throwaway database. The suite truncates
every table between tests.

**`JWT_SECRET`** at least 32 bytes (`openssl rand -base64 48`). The API refuses
to boot in production if it still holds the example value.

**Ports.** API `3333`, web `5173` in development. Both behind the reverse proxy
in production.

**Postgres region** São Paulo, per the Supabase project.

**Supabase Storage bucket for banners.** Track banners need
`STORAGE_PROVIDER=supabase`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY`
(secret, server-only), plus a **public** bucket named by
`SUPABASE_STORAGE_BUCKET` (default `track-banners`). The bucket should cap size
at 5 MB and restrict MIME types to `image/jpeg`, `image/png`, `image/webp` — the
API enforces the same, so the bucket limits are a second fence. With
`STORAGE_PROVIDER=none` the app runs fine and the upload endpoint answers 503.

**Email — Resend.** Set `EMAIL_PROVIDER=resend` and `RESEND_API_KEY` (`re_…`,
secret, server-only). The domain in `EMAIL_FROM` must be **verified in the
Resend dashboard** first — add the DKIM/SPF/return-path DNS records Resend
gives you for `kosmosdigital.com.br` (or a subdomain), or every send is
rejected. With `EMAIL_PROVIDER=console` (the default) the message and its raw
links print to stdout, which is how you get invitation and reset links in
development. The provider is a thin `EmailProvider` over the Resend HTTP API; a
failed send throws so it never fails silently.

**`TRACK_COMPLETION_NOTIFY_EMAIL`** is the internal address alerted when a
client finishes a whole track (default `kosmosinteligenciadigital@gmail.com`).
The alert fires on the completion transition in both `progress.service.ts`
paths — the explicit "concluir" and the automatic heartbeat — after the commit.
Its scoped name lookups are awaited (the tenant guard needs the scope still
active), but the send itself runs in the background: a client's own completion
must never wait on it or be failed by it.

**Not yet needed, but coming:** Redis for shared rate limiting once the API runs
more than one instance.

---

## Testing

```bash
npm test                                    # both packages
npm test --workspace @kosmos/api            # unit, then integration
npm run test:unit --workspace @kosmos/api   # pure rules, no database
npm test --workspace @kosmos/web            # component and unit tests
```

**`DATABASE_URL_TEST` may share a database with development, but never a
schema.** Supabase gives a project one database, so the test suite lives in its
own schema — `?schema=kosmos_test` — and `prisma migrate deploy` builds it
there like any other. `tests/helpers/database.ts` refuses to run when the test
target resolves to the same host, database _and_ schema as `DATABASE_URL`: this
suite truncates every table before every test, and pointed at the wrong URL it
does not fail, it succeeds quietly and the work is gone.

A dedicated throwaway database is equally valid. What is refused is the two
being the same place.

**158 API tests** run against a real PostgreSQL database — migrations included,
so the triggers and CHECK constraints under test are the real ones. Tests run
single-worker because they truncate between cases.

**The tenant isolation suite is the definition of done for Phase 0.** It proves a
`CLIENT_OWNER` from Tenant A cannot read, update or delete anything belonging to
Tenant B, including by knowing the exact target id, through the HTTP API and by
calling the data layer directly.

`content-isolation.test.ts` is the Phase 1 counterpart to the Phase 0 suite. The
library is shared on purpose — one Track row, many companies — so the question
is not "can Alfa read Beta's track?" but "can Alfa discover that Beta was given
anything at all?". It proves a client sees only their own assignments, only
published ones, never the video id at the provider, and cannot reach an authoring
even for a track they legitimately have.

**36 API unit tests** run with no database at all, under
`npm run test:unit --workspace @kosmos/api`. They cover the two rules Phase 2
turns on — what a heartbeat is worth, and what is unlocked — because both are
pure functions and making them wait on PostgreSQL to be checked would be a
reason to check them less often. `vitest.config.ts` owns `tests/`,
`vitest.unit.config.ts` owns `src/`, and the two never overlap.

**54 web tests** cover the error-copy mapping, the login form, the route guard,
refresh serialisation, the heartbeat loop, the classroom page, the theme
resolution and the password reveal. The heartbeat
tests are the ones worth reading: they pin down that it does not overlap itself
on a slow connection, that it flushes the tail on pause and unmount, and that a
motionless player stops reporting.

---

## Notes for the next phase

Phase 2 adds Panda Video, signed playback, the player, heartbeat telemetry and
sequential unlock. What Phase 1 already put in place for it:

- **`externalVideoId` never leaves the API for a client.** `toPublicLesson` sends
  `hasVideo: boolean` instead. Phase 2 should add an endpoint that mints a
  short-lived signed URL per lesson, checked against the caller's assignment —
  not one that hands over the id.
- **Deleting content that has progress is already blocked.** `LESSON_HAS_PROGRESS`
  and `MODULE_HAS_PROGRESS` fire today against a `LessonProgress` table nothing
  writes yet. Once heartbeats land, those guards start doing real work.
- **`LessonProgress` and `WatchEvent` carry a denormalised `tenantId`** and are
  both in the guard's model map, so every progress query must be scoped. Writes
  must set the scalar `tenantId`, not reach it through a nested `connect`.
- **Sequential unlock needs an order that is trustworthy.** Positions are kept
  contiguous 0..n-1: appends take max+1, deletes renumber, and reorders rewrite
  the whole list. Code may rely on that.
- **`durationSeconds` is authored by hand today.** The provider reports the real
  duration; Phase 2 should fill it from the API rather than trusting the form.
