# B-Track — agent context

B-Track is a single company's internal issue tracker. It replaces the team's "Daily Troubleshoot" Google Sheet. Tasks (issues) are logged against **POs (Partner Organisations)** in a spreadsheet-style grid, with a dashboard, in-app notifications, Google-based sign-up with admin approval, and role/permission management done inside the app.

The product owner gives instructions one step at a time after looking at the running UI. There is no phase plan. Build what is asked, keep the app running, and let them review it in the browser.

## Stack and layout

npm workspaces monorepo, TypeScript everywhere. Git repo on GitHub (`main`), public — see `CLAUDE.local.md`.

```
apps/api   Express 4 + Zod + Prisma 6 + PostgreSQL 17   (port 3001)
apps/web   React 19 + Vite 6, plain CSS, no UI library  (port 5173)
.env       root env file, read by both (see .env.example)
```

- **Database:** embedded PostgreSQL via the `embedded-postgres` npm package, because this machine has no Docker or native Postgres. `apps/api/scripts/database.ts` starts it with data in `%LOCALAPPDATA%\task-tracker\pgdata` (outside OneDrive on purpose), in UTF-8 with the C locale. `compose.yaml` is an unused Docker alternative.
- **Web → API:** Vite proxies `/api` to `localhost:3001`, so the session cookie stays same-origin. The web app always calls relative `/api/...`.
- **Routing:** a small hash router (`apps/web/src/router.ts`), e.g. `#/tasks?open=<id>` and `#/access?tab=requests`.

## Running it

```
npm run dev              # db + api + web together (concurrently)
npm run db:start         # embedded Postgres only
npm run dev:api / dev:web
npm run typecheck        # both apps
npm run db:seed          # idempotent seed (roles, statuses, types, priorities, sample data)
npm run db:import-sheet --workspace @task-tracker/api   # one-off import of the 79 sheet rows (already done)
```

Verify a change with `npm run typecheck` from the root, plus `npx vite build` for web. **Don't run `npx tsc -p .` in `apps/web`:** that `tsconfig.json` only holds references (`"files": []`), so it checks nothing and always passes. Use `npx tsc --noEmit -p tsconfig.app.json`. `vite build` doesn't type-check either. For runtime problems, such as a blank page, load the page in headless Edge through the DevTools protocol, with a dev-login session cookie, and read the console exceptions. There are no automated tests. API behaviour has been checked with ad-hoc Node `fetch` scripts: log in via `POST /api/auth/dev/login`, keep the cookie, and clean up the test data afterwards.

## Production (Render + Neon)

- **Hosting plan:** one Render free web service runs the API, which also serves `apps/web/dist` when `NODE_ENV=production` (same origin, so the session cookie stays first-party). The database is Neon free Postgres; Render's free Postgres is deleted after 30 days, so don't use it.
- **Render commands:** build `npm ci --include=dev && npm run build` (the API build runs `prisma generate`), start `npm start` (runs `prisma migrate deploy`, then `node apps/api/dist/index.js`). Health check: `/api/health`.
- **Ports:** the API listens on `API_PORT`, else `PORT` (set by Render). Locally `.env` sets `API_PORT=3001`, so to test a production build here pass `API_PORT=<other port>`.
- **Settings on Render:**
  - `NODE_ENV=production`, `DEV_LOGIN=false` and a 64-character `AUTH_SECRET`
  - `DATABASE_URL`: Neon's **direct** (non-pooled) connection string
  - `WEB_ORIGIN`: the site URL
  - `GOOGLE_CLIENT_ID`, `ALLOWED_EMAIL_DOMAINS` and `ADMIN_EMAILS`

  The site URL must also be an authorised JavaScript origin on the Google OAuth client.
- **Moving data:** `npm run db:copy --workspace @task-tracker/api` copies every table except sessions from `DATABASE_URL` into `TARGET_DATABASE_URL`. That target must already be migrated and empty, or the script refuses. The script was tested end to end on a scratch database.
- **Scratch databases on the local server:** Prisma creates them in WIN1252, which can't hold Bangla. Create them with `ENCODING 'UTF8' TEMPLATE template0`.

## Environment gotchas (Windows)

- **`prisma migrate dev` hangs when run non-interactively.** Workflow instead:
  1. Edit `schema.prisma`.
  2. Hand-write `prisma/migrations/<timestamp>_<name>/migration.sql` (use `prisma migrate diff --from-url` for a draft, and reorder by hand when data must be copied before a column is dropped).
  3. Run `npx dotenv -e ../../.env -- prisma migrate deploy` from `apps/api`.
- **`prisma generate` fails with EPERM while the API is running** (Windows file lock). Stop the API, generate, then restart it.
- **Stopping the API's background shell can leave its `node … tsx … src/index.ts` process holding port 3001**, and the next start fails with EADDRINUSE. Find the process by command line and stop it (`Get-CimInstance Win32_Process`).
- **The API only reads `.env` at startup.** Restart it after changing `.env`. The web app reads the Google client ID from `GET /api/auth/config`, so it needs no restart.
- **Write files with UTF-8.** PowerShell redirection writes UTF-16. Git Bash mangles non-ASCII (Bangla) in `curl` arguments, so send Bangla test data from Node.
- **`migrate reset` / destructive Prisma commands** need the user's explicit consent (`PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION`). Always ask first.
- **The old WIN1252 database** is kept as `task_tracker_win1252_backup`; don't touch it.
- **The hosted database is now the real one** (people sign up and work there). On 2026-10-03 the local database was replaced with a copy of hosted (after a backup to the local `task_tracker_backup_20261003`). Local is only a snapshot for development: copy hosted → local again to refresh it, and never copy local → hosted any more.

## Domain model (`apps/api/prisma/schema.prisma`)

- **Role:**
  - Fields: `name`, `permissions String[]`, `isAssignable` (can be picked as assignee), `canTest` (can be "Tested by"), and `isDefault` (role given to new sign-ups).
  - Roles are data, not an enum. Seeded roles:
    - **Admin:** has every permission.
    - **Business Analyst:** create, view all, edit all, assign to anyone, set priority, set status, comment. Assignable, and `canTest`.
    - **Developer:** create, **view all**, set priority, set status, comment. **No "assign to anyone"**: a developer can only set a task to themselves or Unassigned. Moving a task between people is for Admin and BA (owner's decision). Assignable, `canTest` too, and the default role.
    - **User:** no permissions, not assignable, `canTest`. Its one entry, "User" (`user-confirmation@b-track.invalid`, no password, so it can't sign in), stands for confirmation from the user's side in "Tested by".
  - So "Assigned dev" lists developers and BAs, and "Tested by" lists developers, BAs and User. The owner explicitly wants BAs assignable (a BA may take a testing task), and wants developers and BAs to see every task.
- **User:**
  - Profile: `firstName`, `lastName`, `name` ("First Last"), `email` (unique).
  - Credentials: `passwordHash` (scrypt, `scrypt$salt$hash`), `mustChangePassword`, `googleId`, `avatarUrl`.
  - Access: `status` (PENDING / APPROVED / REJECTED), `isActive`, `roleId`, and per-person `grantedPermissions` / `revokedPermissions`.
- **Session:** DB-backed. The cookie `tt_session` holds a random token and the DB stores only its SHA-256. TTL is 30 days.
- **Task:**
  - `number` (autoincrement "Issue No"), `title`, `description`.
  - `clients Client[]` (many-to-many; a task has one or more POs).
  - `typeId?`, `priorityId?`, `statusId`.
  - People: `reporterId` (creator), `assigneeId?`, and `testers User[]` (many-to-many "Tested by": none, one or several; migration `20261003120000_multiple_testers` moved the old single `testedById` into it).
  - `@db.Date` dates: `reportedDate` ("Date" / assigned on), `expectedDeliveryDate` ("Probable date", the developer's estimate) and `deliveredDate` ("Completed").
- **Client:** a PO. Has `name`, `color`, `isActive`. The code and DB say `Client`; the UI says "PO" / "Partner Organisation".
- **Configurable data:**
  - `TaskType`: Feature and Bug.
  - `Priority`: named "1" to "4" (1 most urgent), with a `rank`.
  - `Status`: New, In Progress, Testing, Completed and Blocked (added for the Oct'26 sheet), with `isInitial` / `isClosed`.
  - `StatusTransition`: the allowed moves.
    - New → In Progress / Testing / Completed
    - In Progress → New / Testing / Completed
    - Testing → In Progress / Completed
    - Completed → In Progress
    - New / In Progress / Testing ↔ Blocked

  There is no admin UI for statuses, types or priorities yet; they come from the seed or DB.
- **Attachment** (evidence): `fileName`, `mimeType`, `size`, `data Bytes`, `uploaderId`, deleted with the task.
  - Files are stored **in Postgres (bytea)**, max 10 MB each and 20 per task.
  - Allowed types: images (png, jpeg, gif, webp), PDF, text, CSV, ZIP, Word and Excel. **SVG and HTML are refused**, because they could run script from our origin.
  - Images and PDFs are served inline, with `nosniff` and a sandboxed CSP; everything else downloads.
  - Uploading is a raw request body with `?name=` and `Content-Type` (`routes/attachments.ts`, mounted at `/api/tasks/:taskId/attachments`).
  - Upload rights follow `access.edit` (own tasks). Viewing needs task visibility. Removal is the uploader or `access.edit`.
  - Adds and removals are written to TaskHistory as field "Evidence".
- **Comment**, **TaskHistory** (one row per field change, with a human label: "Title", "PO", "Status", "Probable date" and so on), and **Notification** (`message`, optional `link` such as `access?tab=requests`, `readAt`).

### Business rules (the server is the source of truth)

- **Permissions:** a person's effective permissions are the role's permissions, plus grants, minus revokes (`lib/permissions.ts`). Code checks **permission keys, never role names**. The keys are `task.create`, `task.view_all`, `task.edit_all`, `task.assign_any`, `task.set_priority`, `task.set_status`, `comment.create`, `dashboard.view_all`, `po.manage` and `access.manage`.
- **Dashboard scope:** `dashboard.view_all` (Admin only by default; grantable per person) shows team-wide metrics. Without it, `GET /api/dashboard` counts only tasks **assigned to** the person, and the page shows four cards (Assigned to me, Overdue, Due in 3 days, Completed) with no "Open tasks" card.
- **Per-task access:** `lib/taskAccess.ts` works out what a person may do with a given task. The API returns it as `task.access` and the UI only hides or disables controls based on it.
  - A person's **own tasks** are the ones **assigned to them**, plus ones they created that are **still unassigned**. Once a task is assigned to someone else it belongs to that assignee: the creator can only view it (and comment), like any colleague (owner's rule, 2026-10-03). On own tasks people can edit every field, change status (with `task.set_status`), set priority (with `task.set_priority`), **choose the tester**, and **assign** (to anyone with `task.assign_any`, otherwise only themselves or Unassigned).
  - **Delete** is for the creator while the task is still theirs (unassigned or assigned to themselves), plus `task.edit_all` (Admin, BA), so an assignee can't delete work handed to them. `task.edit_all` gives every right on every task.
  - Other people's tasks need `task.edit_all` for any of that. For example, a developer can unassign their own task or pick a BA to test it, but can't move it to another dev or touch a colleague's task.
  - **Claiming:** anyone whose role is assignable (`actor.isAssignable`) can assign an **unassigned** task to **themselves only** (`assign: "self"`), even if it isn't theirs. Once claimed it's their task, so the own-task rules above apply.
  - Without `task.view_all`, a person sees only tasks they created or are assigned to.
- **Status and dates:**
  - A status change must follow `StatusTransition`.
  - Entering a closed status stamps `deliveredDate` with today; leaving it clears the date.
  - **Gap days** = today − probable date, and `null` once closed (`lib/dates.ts`). The list API computes it.
- **Task fields:**
  - Every "Tested by" person being added must be an active user whose role has `canTest` (people already on the task may stay). The API takes `testerIds: string[]` on create and PATCH; history records the names joined, e.g. "A, B".
  - New tasks need at least one active PO. The status must be the initial one or one step from it.
  - Without `task.set_priority`, priority is left null.
- **Notifications:** assigning a task creates a notification for the assignee.
- **Access guard:** at least one approved, active user must keep `access.manage`. `assertAccessManagerRemains` in `routes/access.ts` simulates the change before applying it.

## Auth and onboarding flow

- **Sign in:** email + password (`POST /api/auth/login`) or "Continue with Google". Google Identity Services issues an ID token, and the server verifies it with `google-auth-library`.
- **Create account (Google only):**
  1. Google sign-in gives the server a verified identity, and the server returns a 30-minute, HMAC-signed sign-up token (`lib/signupToken.ts`, secret `AUTH_SECRET`).
  2. The person confirms first and last name and sets a password (`POST /api/auth/signup`).
  3. The outcome depends on who they are:
     - An address in `ADMIN_EMAILS` becomes an approved Admin at once.
     - Someone an admin pre-added (Access management → Users → Add) is approved and signed in straight away.
     - Anyone else becomes **PENDING**, and every access manager gets a notification linking to Access management → Requests.
- **Approval:** an admin approves (picking the role and adjusting per-person access) or declines. Pending, declined or deactivated users can't sign in, and `requireAuth` also ends their sessions.
- **Admin password reset:** `POST /api/access/users/:id/reset-password` returns a one-time 12-character temporary password, shown to the admin once. It sets `mustChangePassword` and ends all of the person's sessions. Until they choose a new password, `requireAuth` blocks every route outside `/api/auth/*`, and the web app shows `ChoosePasswordPage`.
- **`DEV_LOGIN=true`** (refused in production) enables `/api/auth/dev/login` and `/api/auth/dev/google`, shown as collapsed "Local testing tools" on the login page.
- **Google OAuth app:** in *Testing* mode, so everyone must be listed as a test user in Google Cloud. `ALLOWED_EMAIL_DOMAINS=gmail.com` is currently set in `.env`.

## API map (`apps/api/src`)

`app.ts` mounts the routers. `middleware/auth.ts` provides `requireAuth`, `getActor`, `can` and `requirePermission`. `lib/http.ts` provides `HttpError`, `asyncHandler` and the error handler; a Zod error's message is its first issue's message. Every response is `{ success, data }` or `{ success: false, error: { message } }`.

| Route | Purpose |
|---|---|
| `GET /api/auth/config` | googleClientId, devLogin, min password length |
| `POST /api/auth/login` · `/google` · `/signup` · `/logout` | sign in / up / out |
| `GET/PATCH /api/auth/me`, `POST /api/auth/me/password` | profile, name, password |
| `GET /api/meta` | statuses (with `nextStatusIds`), types, priorities, users, active POs |
| `GET /api/dashboard` | metric cards, status counts, deadlines, activity |
| `GET/POST /api/tasks`, `GET/PATCH/DELETE /api/tasks/:id`, `POST /api/tasks/:id/comments` | tasks (PATCH records history) |
| `GET/POST /api/clients`, `PATCH /api/clients/:id` | POs (`po.manage`) |
| `GET /api/notifications`, `POST /:id/read`, `POST /read-all` | notifications |
| `GET /api/access`, roles CRUD, `POST/PATCH /api/access/users[/:id]`, `POST /users/:id/reset-password` | access management (`access.manage`) |

## Web map (`apps/web/src`)

- `App.tsx`: loads the session (`/auth/me`, then `/meta`), shows the login page, the forced password change, or the shell. The shell is a **graphite sidebar that rests as a 72px icon rail and opens over the page on hover or keyboard focus** (short open/close delays; the page never shifts). A small pin button (top right of the open menu) keeps it open beside the page instead; pinned or not is remembered in `localStorage` key `btrack.sidebar`, a top bar with `NotificationBell` and a user menu, and the pages.
- **Pages:**
  - `DashboardPage`
  - `TaskSheet` (component)
  - `PosPage` (needs `po.manage`)
  - `AccessPage`: tabs Requests / Users / Roles & permissions (needs `access.manage`)
  - `ProfilePage`
  - `LoginPage` and `ChoosePasswordPage`, both inside `AuthLayout`
- **`TaskSheet.tsx`:** the spreadsheet grid. Columns follow the original sheet order: Date · PO · Issue No · Issue title · Assigned dev · Priority · Tested by · Probable date · Gap days · Status. There is no Comments column (removed to save space); comments live in the `TaskDrawer`.
  - Clicking a row (anywhere outside its dropdowns and date pickers) opens the `TaskDrawer`; Enter does the same on a focused row. There is no delete button or open arrow on rows.
  - **Read-only in the sheet:** Date, PO, Issue title and type. They are edited in the drawer (Edit). Assigned dev, Priority, Tested by, Probable date and Status are still edited inline and save on change.
  - Bug/Feature shows as a `TypeIcon` before the title; there is no Type column.
  - There is no Completed column; the completed date appears in the `TaskDrawer`.
  - View tabs: All / Open / Overdue / Due in 3 days / Completed.
  - **Filters** (`TaskFilters.tsx`): the row just above the table has filter chips on the left and a search box plus Filters button on the right (not in the top bar). One panel holds every filter: PO, type, priority, status, assigned dev, tested by, and date ranges for Date, Probable date and Completed.
  - **Default filter** (`defaultFilters`): assignable roles (developers, BAs) open on "Assigned dev = me"; admins open on all tasks. It's only a starting point: everyone can clear it and see all tasks. "Back to my default" restores it.
  - Rows use the chosen sort only. There is no unassigned-first ordering; the owner rejected it.
  - **Resizable columns that always fit:** the table is sized to exactly the sheet area's width (measured with a ResizeObserver), so there's never a sideways scrollbar. Column widths are shares of that width. Dragging a header's right edge moves width between that column and the next (min 56px). Double-click resets all columns, and arrow keys nudge. Saved in `localStorage` key `btrack.sheet.columns`.
  - A "New task" button opens `NewTaskModal` (sectioned form). It has an **Evidence** section (`components/Evidence.tsx`): Ctrl+V anywhere in the form attaches a pasted screenshot, or drop or browse for files. The files upload right after the task is created. A failed file doesn't undo the task; it shows an error naming it.
  - Titles with evidence show a paperclip count. The drawer's Evidence gallery shows thumbnails and files, with add (paste, drop, browse) and remove.
- **Other components:**
  - `PoPicker`: multi-select list for POs, and with `required={false}` for testers (Tested by) too, rendered on `document.body` through a portal so form and table CSS can't leak into it. It commits when closed.
  - `TaskDrawer`: details, comments, history, plus Edit (title, PO, type, Date, Probable date; needs `access.edit`) and Delete (needs `access.delete`, with a confirm).
  - `Logo.tsx`: `Logo` and `Brand` (logo plus "B-Track" wordmark).
  - `NavIcon`: sidebar line icons.
- `api.ts` holds the typed fetch wrappers (a 401 fires `SESSION_EXPIRED_EVENT`), `types.ts` the shared types, and `format.ts` the date and permission helpers.

## Design system

- **Brand:** the name is **B-Track**. The logo is four crimson tiles in a 2×2 grid (`public/logo.svg`, also the favicon). In the wordmark, "B" is crimson and "-Track" is dark (white on dark backgrounds).
- **Colours:**
  - graphite sidebar (`#16181d`)
  - crimson accent `--accent: #c8161e` (`--accent-strong #a8121a`, `--accent-soft #fcecec`)
  - neutral greys, page background `#f4f5f7`
  - green, amber and blue only for status meanings

  The user explicitly **does not want the old white/purple look**.
- **Fonts:** Plus Jakarta Sans (`--font-display`) for the wordmark and headings, Inter (`--font-ui`) for the UI, both from Google Fonts with a Segoe UI fallback.
- **CSS:** everything is in `apps/web/src/styles.css`, organised in commented sections, with later sections overriding earlier ones. When restyling, replace the relevant section instead of stacking more overrides.

## Data and people

The real team members and POs are internal, so they're named only in the git-ignored `CLAUDE.local.md`, never in committed files.

- **Tasks:** on 2026-10-03 all earlier tasks were deleted (locally and on Neon), and the 57 filled rows of the "Daily Troubleshoot (Oct'26)" sheet were imported locally with `prisma/import-sheet-oct26.ts` (data in the git-ignored `sheet-data-oct26.local.json`; `--target` runs it against `TARGET_DATABASE_URL`). They keep their sheet issue numbers (#6–#288). **Assigned dev and Tested by were left blank on purpose:** the owner assigns them in the app. Empty sheet cells that are required here (Date, Status) were filled with the import date / New and noted in the description; #104 has no PO. New tasks continue from #289. `db:seed` adds sample tasks whenever the task table is empty; don't run it, or the old `db:import-sheet`, unless asked.
- **Sheet data:** `db:import-sheet` reads the sheet's people, PO colours and rows from `apps/api/prisma/sheet-data.local.json`, which is git-ignored. Keep real data out of committed code.
- **Users:**
  - Two developers and two testers came from the sheet; the testers have the Business Analyst role.
  - All four have **placeholder `@example.com` emails** that the owner will replace with real ones.
  - Seed users: Ada Admin, Bella Analyst, Dev One, Dev Two (`@example.com`, no passwords). On 2026-10-03 the owner had these four and the four `@example.com` sheet placeholders deleted from the **hosted** database (the real people have their own accounts there); "Sheet import" was kept as the creator of the imported tasks. Running `db:seed` against the hosted database would re-create the samples.
  - An inactive "Sheet import" user is the reporter of the imported rows.
- **POs:** eight real POs, each with a colour. The seed's sample POs (ALPHA, BETA, GAMMA, DELTA) are only created on an empty database.
- **Encoding:** titles can be in Bangla; the database is UTF-8.

## Working with this owner

- Make the change they asked for, type-check and build, open or refresh `http://localhost:5173`, and summarise in plain language. They review visually and send screenshots.
- **The task sheet layout was settled after two rejected redesigns** (two-line rows; a restyled one-field-per-column version). Keep the current single-line table with its visible controls. Don't redesign it without asking.
- **Ask before destructive actions:** DB resets, deleting data, or anything outward-facing.
- **Open items / not built yet:**
  - forgot-password by email (only the admin reset exists)
  - admin UI for statuses, types and priorities
  - `DEV_LOGIN` should be set to `false` for real use
  - real emails for the four sheet users
  - the owner said they would explain more task rules later
