# B-Track

An internal task tracker: tasks are logged against POs in a spreadsheet-style sheet, with a dashboard, in-app assignment notifications, and role-based access that an Admin manages from the app.

## Stack

- React, Vite, and TypeScript for the web app
- Express and TypeScript for the REST API
- PostgreSQL and Prisma for persistence
- Google Sign-In for authentication; sessions are httpOnly cookies backed by the database

The API owns authorization. Roles (Admin, Business Analyst, Developer by default) are data: each grants a list of permission keys that an Admin edits on the **Access management** page. Code checks permission keys, never role names.

## Requirements

- Node.js 20 or newer
- npm
- PostgreSQL: either Docker Compose (`docker compose up -d database`) or nothing at all — `npm run dev` starts an embedded PostgreSQL (data in `%LOCALAPPDATA%\task-tracker\pgdata`) when port 5432 is free.

## Setup

1. Copy `.env.example` to `.env` and fill in the sign-in settings (see below).
2. Install dependencies with `npm install`.
3. Start the database with `npm run db:start` (leave it running), then in another terminal:

   ```sh
   npm run db:generate
   npm run db:migrate
   npm run db:seed
   ```

4. Stop `db:start` and run everything with `npm run dev`.

The web app is served at <http://localhost:5173> and proxies `/api` to the API at <http://localhost:3001>.

## Sign-in and access

- **Sign in** with email and password, or **Continue with Google**.
- **Create account** only through Google: name and email come from the Google account, the person confirms their first and last name and chooses a password. This creates an **access request**.
- Admins (anyone with "Manage access") get a notification and see the request under **Access management → Requests**. They pick a role, optionally add or remove individual permissions for that person, and approve or decline. Nobody can sign in until approved.
- People added ahead of time on **Access management → Users** are pre-approved: when they continue with Google using that email, they only set a password.
- **Reset password** (Access management → Users) gives the person a one-time temporary password, shown to the admin once, and signs them out everywhere. After signing in with it they must choose their own password before they can use the app. It also works for people who haven't signed up yet, so they can sign in without Google.
- Emails listed in `ADMIN_EMAILS` are approved as Admin on sign-up, to bootstrap the first admin.

### Settings (`.env`)

| Variable | Purpose |
| --- | --- |
| `GOOGLE_CLIENT_ID` | OAuth client ID (type "Web application") from Google Cloud Console, with `http://localhost:5173` as an authorised JavaScript origin. Google buttons appear once set. |
| `ALLOWED_EMAIL_DOMAINS` | Comma-separated domains allowed to sign up, e.g. `brainstation-23.com`. Empty allows any Google account. |
| `ADMIN_EMAILS` | Comma-separated emails approved as Admin on sign-up. |
| `AUTH_SECRET` | Long random string that signs sign-up tokens. Required in production. |
| `DEV_LOGIN` | `true` adds collapsed "Local testing tools" to the sign-in page (switch user, simulate Google). Refused when `NODE_ENV=production`. |

## Useful commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run the database, API and web app together |
| `npm run build` | Build both workspaces |
| `npm run typecheck` | Type-check both workspaces |
| `npm run db:start` | Run only the embedded PostgreSQL |
| `npm run db:generate` | Generate the Prisma client |
| `npm run db:migrate` | Create/apply a local development migration |
| `npm run db:seed` | Load starter roles, statuses, priorities and sample data |
| `npm run db:studio` | Open Prisma Studio |
| `npm run db:import-sheet --workspace @task-tracker/api` | Import the Aug–Sep 2026 Daily Troubleshoot sheet (skips issue numbers that already exist) |
