# HTTP API

All routes use the loopback origin. Production data routes require the
HttpOnly browser session; mutating requests also require an allowed Origin.
Builder-only operations additionally require administrator mode.

## Lifecycle and session

| Method | Route | Purpose | Access |
| --- | --- | --- | --- |
| GET | `/api/health` | Process/browser liveness | Public, non-sensitive |
| GET | `/api/startup/status` | Splash initialization state | Launch capability |
| GET | `/api/session/bootstrap` | Known audit-user names | Launch capability |
| POST | `/api/session/login` | Select user and issue cookie | Launch capability |
| GET | `/api/session/status` | Validate current browser session | Browser session |
| POST | `/api/heartbeat` | Mark an application window active | Browser session |
| POST | `/api/disconnect` | Mark the browser inactive | Browser session |
| POST | `/api/shutdown` | Revoke session, show closing page, and stop when idle | Browser session |

## Workspace, schema, and settings

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/workspace` | Schemas, definitions, settings, audit user |
| POST | `/api/workspace/select` | Select active schema |
| POST | `/api/workspace/schemas` | Create/archive/restore/clone/delete schema |
| GET/POST | `/api/global-definitions` | Read or manage reusable definitions |
| GET/PUT | `/api/schema` | Read or save current schema; PUT is admin-only |
| POST | `/api/schema/options` | Add a typed value to an existing list field |
| POST | `/api/settings` | Save schema application settings |
| POST | `/api/settings/shortcuts` | Save workspace UI/shortcut settings |
| POST | `/api/home/custom-stats` | Save up to three Home statistics; admin-only |
| POST | `/api/settings/default-app/destination` | Choose clone parent folder; admin-only |
| POST | `/api/settings/default-app/create` | Create sanitized independent app copy; admin-only |
| GET | `/api/settings/background-image` | Serve validated workspace background |
| POST | `/api/users/select` | Change audit attribution inside a session |
| POST | `/api/builder/unlock` | Initialize/unlock administrator mode |
| POST | `/api/builder/lock` | Lock administrator mode |
| POST | `/api/builder/password` | Change administrator password |
| POST | `/api/backup` | Create backup; admin-only |
| GET | `/api/backups/<name>` | Download validated backup; admin-only |

## Records and files

| Method | Route | Purpose |
| --- | --- | --- |
| POST | `/api/records` | Create or update a record |
| GET/DELETE | `/api/records/<code>` | Load or permanently delete a record |
| POST | `/api/archive` | Archive/restore with concurrency check |
| GET | `/api/attachments/<name>` | Safely view/download an attachment |
| POST | `/api/identities/inspect` | Inspect cross-schema identity presence |
| POST | `/api/profiles/inspect` | Inspect profile-transfer mapping |
| POST | `/api/profiles/link` | Create linked profile/import mapped fields |

## Search and histories

| Method | Route | Purpose |
| --- | --- | --- |
| POST | `/api/search` | Search current schema |
| POST | `/api/search/query` | Query across selected schemas |
| POST | `/api/search/multi` | Multi-schema structured search |
| POST | `/api/search/global` | Global-field search |
| GET/POST | `/api/search/history` | List or save searches |
| DELETE | `/api/search/history/<id>` | Delete saved search |
| GET | `/api/search/field-values` | Distinct live values plus populated/checked record counts for one schema field |
| DELETE | `/api/history/<search|import|export>` | Permanently clear one history and retained files |
| POST | `/api/history/notes` | Update import/export notes |

## Import and export

| Method | Route | Purpose |
| --- | --- | --- |
| POST | `/api/import/inspect` | Inspect Excel input |
| POST | `/api/import/commit` | Commit inspected Excel import |
| POST | `/api/import/portable/inspect` | Inspect portable ZIP |
| POST | `/api/import/portable/commit` | Apply portable import |
| GET | `/api/import/history` | List import history |
| POST | `/api/import/history/log` | Record import operation |
| POST | `/api/import/history/open` | Open retained source locally |
| DELETE | `/api/import/history/<id>` | Delete import history item |
| POST | `/api/export` | Return filtered Excel bytes |
| POST | `/api/export/save` | Save configured export and history |
| POST | `/api/export/destination` | Choose a local destination |
| GET | `/api/export/history` | List export history |
| POST | `/api/export/history/open` | Open retained export locally |
| DELETE | `/api/export/history/<id>` | Delete export history item |

Requests may select a schema with `X-Schema-ID`, `schema_id` query parameter,
or JSON `schema_id`. Payload details follow the frontend controllers; stable
route literals and backend callables are catalogued in
[API_REFERENCE.md](API_REFERENCE.md).
