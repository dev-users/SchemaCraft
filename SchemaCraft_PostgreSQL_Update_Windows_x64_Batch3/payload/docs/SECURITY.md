# Security model

## Threat boundary

SchemaCraft is a trusted local desktop application, not an internet-facing web
service. It binds only to `127.0.0.1`. The security controls also defend against
untrusted web pages and ordinary local processes attempting to contact the
loopback port, but they do not replace operating-system account isolation or
full-disk encryption.

## Implemented controls

- A cryptographically random one-time launch capability protects splash/login
  endpoints.
- After user selection, data APIs require a random HttpOnly, SameSite=Strict
  browser-session cookie. Sessions expire and are discarded when the process
  ends.
- Mutating requests enforce the loopback Origin; every request validates the
  Host header to limit DNS rebinding.
- The server emits CSP, frame denial, no-referrer, MIME-sniffing, same-origin
  resource, and restrictive browser-permission headers.
- The HTML shell remains hidden behind a privacy screen until the session and
  selected user are confirmed.
- Administrator passwords use bcrypt with cost 12. Existing PBKDF2-SHA256
  files are accepted once and automatically upgraded after successful login.
- Passwords are bounded before bcrypt processing and failed attempts receive a
  capped exponential delay.
- API errors return display-safe messages. Unexpected tracebacks go only to
  local rotating logs.
- Deleting a profile purges it from saved-search snapshots, recent-profile
  browser state, and dataset caches. History deletion removes authoritative
  entries and retained import/export files rather than hiding them in the UI.
- Attachment paths, ZIP entries, filenames, request sizes, background images,
  and workbook inputs are validated and bounded.
- Builder-only operations require the administrator session in addition to the
  browser session.
- Default-app copies use a new folder, reject paths inside the running app, and
  omit logs, backups, caches, the development key, and partial failed copies.
- A schema-free default-app copy also removes `builder-auth.json`; copies that
  retain schemas deliberately retain the bcrypt administrator hash.
- The attachment image viewer accepts only same-origin `/api/attachments/`
  sources and uses the server's validated attachment route.

## What bcrypt does—and does not do

bcrypt is a one-way password hashing algorithm. It cannot encrypt records,
Excel workbooks, attachments, backups, or histories because encrypted data
must be recoverable while a bcrypt hash is deliberately irreversible.

SchemaCraft therefore applies bcrypt only to administrator passwords. The
business data remains in its compatible Excel/JSON form. For encryption at
rest, use BitLocker, Windows device encryption, an encrypted volume, or an
equivalent OS-managed solution. Adding application-level encryption would
require a separate key-management design and a deliberate data-format
migration.

## Sensitive files

| File/directory | Sensitivity |
| --- | --- |
| `builder-auth.json` | bcrypt administrator hash; never contains plaintext |
| `data/schemas/*/*.xlsx` | Authoritative records; plaintext business data |
| `data/schemas/*/attachments/` | Uploaded business files |
| `data/*history*.json` | Operational metadata and audit-user names |
| `backups/` | Copies of schema/data; protect like the source data |
| `data/logs/` | Local diagnostics; excluded from source packaging |

Clearing history through the UI removes the authoritative JSON and retained
import/export files. Clearing records in the default-app creator also removes
identity registries, workbooks, attachments, migration copies, histories, and
known users from the new copy.
Complete schema removal additionally clears the administrator hash so the new
application cannot inherit access credentials from its source.

Do not expose the loopback server through port forwarding, reverse proxies,
firewall rules, or LAN binding. Do not commit runtime data or password files to
a public repository.

## Residual risks

- Malware running as the same OS user can read the application data files and
  may be able to inspect browser/process memory.
- A selected audit name is attribution, not a separate account credential.
- Normal browser fallback tabs may prevent script-driven resizing or closing;
  Chromium application mode is the supported desktop presentation.
- No security review can prove the absence of all vulnerabilities. Re-run the
  test suite and static checks for every release and review dependency updates.
