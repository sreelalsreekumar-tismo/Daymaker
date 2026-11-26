# Daymaker

One place for **todos, Google Calendar and notes** — usable by hand in the app, or through Claude Code via an MCP server.

| Area | Tech |
|---|---|
| Web app | Angular 22 (standalone components, signals), Angular CDK, TipTap, SignalR client |
| API | ASP.NET Core Web API (.NET 10), SignalR, EF Core |
| Database | **SQLite** (single `daymaker.db` file — including attachments, stored as BLOBs) |
| Calendar | Google Calendar API (OAuth, incremental two-way sync) |
| Claude | MCP server (stdio) using the official C# SDK |

```
src/Daymaker.Api      REST API, SignalR hub, auth, background workers
src/Daymaker.Core     domain entities
src/Daymaker.Data     EF Core DbContext + migrations (SQLite)
src/Daymaker.Google   Google Calendar gateway (OAuth + events)
src/Daymaker.Mcp      MCP server for Claude Code
web/                  Angular app
tests/                xUnit integration tests (Google is faked)
```

## Run it

```bash
# 1. API  (http://localhost:5146) — creates/migrates daymaker.db automatically
cd src/Daymaker.Api
ASPNETCORE_ENVIRONMENT=Development dotnet run

# 2. Web  (http://localhost:4200, proxies /api and /hubs to the API)
cd web
npm install
npm start
```

In **Development** the login page also offers *Continue as dev user*, so everything works without Google credentials.
That endpoint does not exist in any other environment.

## Configuration

Set these with [user secrets](https://learn.microsoft.com/aspnet/core/security/app-secrets) or environment variables
(`Google__ClientId`, …). **Never commit secrets.**

| Key | Purpose |
|---|---|
| `Jwt:Key` | Signing key for sessions. **Required outside Development** (use a long random string). |
| `Google:ClientId` / `Google:ClientSecret` | OAuth web client from Google Cloud Console. |
| `Google:RedirectUri` | Optional. Defaults to `<api origin>/api/v1/google/callback`. Must be registered in Google Cloud. |
| `Cors:Origins` | Allowed web origins (default `http://localhost:4200`). |
| `DataProtection:KeysPath` | Folder for encryption keys. Persist it in production — Google refresh tokens are encrypted with these keys. |
| `ConnectionStrings:Default` | SQLite connection string (default `Data Source=daymaker.db`). |

### Google setup
1. Google Cloud Console → enable the **Google Calendar API**.
2. Create an **OAuth client ID (Web application)**.
   - Authorized JavaScript origin: `http://localhost:4200`
   - Authorized redirect URI: `http://localhost:4200/api/v1/google/callback` (the dev proxy forwards it to the API)
3. Set `Google:ClientId` and `Google:ClientSecret`, restart the API.
4. Sign in with Google, then **Settings → Google Calendar → Connect**.

The server polls Google every 5 minutes (and on *Sync now*) using incremental sync tokens. Push channels would need a public HTTPS endpoint, so polling is the default.

## Use it from Claude Code

1. In the app: **Settings → Claude access → Create token**. Choose whether Claude may create/edit and/or delete.
2. Register the MCP server (run from the repo root; the token is shown once):

```bash
claude mcp add daymaker \
  -e DAYMAKER_TOKEN=dm_xxxxxxxx \
  -e DAYMAKER_API_URL=http://localhost:4200 \
  -- dotnet run --project src/Daymaker.Mcp
```

Tools: `current_time`, `list_todos`, `get_todo`, `create_todo` (optionally `addToCalendar`), `update_todo`, `complete_todo`, `delete_todo`,
`save_todo_as_note`, `create_note`, `search_notes`, `get_note`, `delete_note`, `search`, `list_upcoming_meetings`,
`create_calendar_event`, `update_calendar_event`, `delete_calendar_event`.

Safety: the token's scopes are enforced by the API (a read-only token cannot write; a token without *delete* cannot delete).
Destructive tools also refuse to run unless called with `confirm=true`, which tells Claude to ask you first.
Changes Claude makes appear in your notification bell.

Example: *"Create a todo for completing the API documentation by Friday, add it to my calendar tomorrow at 10 AM, and create a note with the implementation details."*

## Tests

```bash
dotnet test          # API integration tests (SQLite temp DB, fake Google gateway)
cd web && npx ng build
```

## Notes
- Times are stored in UTC and shown in the browser's time zone. The daily summary is sent at 08:00 UTC.
- Attachments are limited to 10 MB (images, PDF, text). Images inside notes are shrunk and embedded in the note.
