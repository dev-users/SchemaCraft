# Offline operation

SchemaCraft is designed to run without an internet connection.

## Runtime

- The application server listens only on the local loopback interface.
- The browser UI communicates only with the local SchemaCraft server.
- Content Security Policy permits network connections only to the same local origin.
- PDF Preview receives the generated PDF from the local server and displays it from an in-memory `blob:` URL. The PDF is not uploaded to a third-party viewer.
- The Chromium application window is launched with background networking, sync, component updates, push/background services, QUIC, and other online features disabled.
- Non-local browser traffic is forced through an intentionally closed loopback proxy while localhost is bypassed, providing an additional network barrier.

## Windows build

`build-windows-cli.bat` installs all Python dependencies only from `Packages/` using `pip --no-index --find-links Packages`.
No internet connection is required to build when the included package set is present.

`prepare-packages.bat` is only a maintenance helper for refreshing the offline wheelhouse on an online machine; it is not required for a normal offline build.

## Expected browser behavior

The application uses an installed Chromium-family browser as a local kiosk/application shell. PDF rendering may visually resemble Chrome/Edge's built-in PDF viewer, but the document remains local. The offline launch policy prevents that shell from using external network services during SchemaCraft operation.
