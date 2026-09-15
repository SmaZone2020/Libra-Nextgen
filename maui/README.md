# Libra-Nextgen Mobile (MAUI)

A native mobile client for Libra-Nextgen, built with .NET MAUI. **Phase 1 ships
Android**; the project is structured so iOS and macOS (Mac Catalyst) can be
switched on later without rework.

## What it is

The desktop app (`desktop/electron/`) is an Electron shell that **spawns** the
.NET service as a sidecar process and points a Chromium window at it. A mobile OS
does not let an app spawn a sibling executable, so the mobile app does the
equivalent thing in the only way a phone allows: it **hosts the very same
ASP.NET Core application in-process** and points a WebView at it.

```
┌─ Libra mobile app (one Android process) ──────────────────────────────┐
│ MainPage: one full-bleed WebView — no Shell, no NavigationPage, no bar │
│   │                                                                    │
│   ├─ Resources/Raw/boot.html   packaged boot screen (loading / retry)  │
│   │      │ ready(url)                                                  │
│   │      ▼                                                             │
│   └─ LocalServiceHost ── LibraServiceHost.RunAsync()                   │
│        · picks a free loopback port (scan up from 5270)                │
│        · writes libra.conf.json  (SQLite, loopback — fixed)            │
│        · unpacks the console SPA from the APK into the app data dir    │
│        · sets LIBRA_WEB_ROOT / LIBRA_USER_DATA_DIR / LIBRA_SERVER_KEY   │
│              ▼                                                         │
│        Kestrel on http://127.0.0.1:<port>  ← the real Libra service    │
│              ▲                                                         │
│        WebView ── the unchanged React console (same dist as desktop)   │
│              ▲                                                         │
│        MobileBridge ── system-bar insets + status-bar style (native→JS)│
└────────────────────────────────────────────────────────────────────────┘
```

Consequences worth knowing:

- **No native UI at all.** The app has exactly one page holding one WebView. The
  loading screen, the failure screen with its retry button, account creation and
  every settings surface are the React app / packaged HTML — there is no native
  page, toolbar or settings screen to keep in sync.
- **No UI fork.** The console is the same React 19 build the desktop and cloud
  deployments use. The only mobile-specific console code is host detection
  (`src/console/src/shell/env.ts`) and the system-bar insets.
- **Feature parity by construction.** Agent beacon API, SSE, `/ws/console`,
  plugins, Builder, MCP, the AI assistant — all of it is the same server code.
- **Local only.** There is deliberately no remote-server entry point: the app
  always talks to the service embedded in itself. (Only the plain web console
  offers "connect to a web service"; the desktop shell has its own remote mode.)

## Storage: SQLite, always, invisibly

The desktop lets the user pick SQLite or MongoDB. **Mobile does not.** The service
is started with `storage.mode = "sqlite"` in a generated `libra.conf.json` and the
database lives at `<app data>/data/libra.db`. There is no storage setting in the
UI and no storage concept in the mobile user's mental model.

## System bars (status bar, cutout, navigation bar, keyboard)

The app targets API 36, so on Android 15+ edge-to-edge is enforced by the
platform; opting in explicitly (see `Platforms/Android/Resources/values/styles.xml`
and `AndroidSystemBars`) keeps API 34 and 35+ behaving identically instead of one
leaving black bars and the other drawing under them.

`AndroidSystemBars` reports `systemBars() | displayCutout()` and `ime()` to
`MobileBridge`, which publishes them into the page as CSS custom properties and on
`window.libraMobile`:

```
--libra-inset-top / -bottom / -left / -right / -ime
window.libraMobile.insets = { top, bottom, left, right, ime }
window.addEventListener('libra:insets', …)      // rotation, keyboard, bar changes
```

The console reserves that space itself (`.lw-frame` / `.libra-viewport-pad` in
`src/console/src/styles/app.css`, the mobile tab bar, the list-page bottom
padding), so content never sits under the bars. Outside the app the variables are
`0px`, which is why the same code works unchanged in a browser and in Electron.

The console also drives the status-bar icon colour from its theme through
`window.libraNative.setStatusBarStyle('light' | 'dark')`; the last value is
replayed after every navigation by `MobileBridge`.

## Repository layout

| Path | Purpose |
|---|---|
| `LibraNextgen.Mobile/MainPage.xaml(.cs)` | The only page: full-bleed WebView + boot/service wiring |
| `LibraNextgen.Mobile/Resources/Raw/boot.html` | Packaged boot screen (loading / failure / retry) |
| `LibraNextgen.Mobile/Services/LocalServiceHost.cs` | Mobile counterpart of the shell's `ServiceProcess` |
| `LibraNextgen.Mobile/Services/MobileBridge.cs` | Native → JS bridge (insets, boot state, status bar) |
| `LibraNextgen.Mobile/Services/WebBundleProvisioner.cs` | Unpacks the console SPA shipped in the APK |
| `LibraNextgen.Mobile/Services/MobileServiceLayout.cs` | App data layout (the mobile `userData`) |
| `LibraNextgen.Mobile/Platforms/Android/AndroidSystemBars.cs` | Edge-to-edge + insets listener |
| `LibraNextgen.Mobile/Platforms/Android/NativeBridge.cs` | JS → native bridge (`window.libraNative`) |
| `Directory.Build.targets` | Makes ASP.NET Core available on Android RIDs (see below) |
| `scripts/build-web-bundle.mjs` | Packs `src/console/dist` into `Resources/Raw/web-bundle.zip` |

## The one non-obvious build problem

ASP.NET Core is a **shared framework**, not a set of NuGet packages, and the
runtime pack deliberately excludes mobile:

```
RuntimePackExcludedRuntimeIdentifiers="android;linux-bionic"
```

so a plain `<FrameworkReference Include="Microsoft.AspNetCore.App" />` fails with

```
NETSDK1082: There was no runtime pack for Microsoft.AspNetCore.App available
            for the specified RuntimeIdentifier 'android-arm64'.
```

`Directory.Build.targets` solves it in two steps, with no custom framework build:

1. override the `KnownFrameworkReference` so the SDK stops looking for a runtime
   pack that does not exist for mobile RIDs;
2. swap the targeting-pack **reference** assemblies for the shared framework's
   **implementation** assemblies of the same name, taken from the ASP.NET Core
   runtime installed next to the .NET SDK. Same compile-time surface, and now the
   implementation actually lands in the APK.

The build fails loudly (`LIBRA001`) if the shared framework cannot be found.
Override `AspNetCoreSharedFrameworkRoot` / `AspNetCoreSharedFrameworkVersion`
when it lives somewhere unusual.

AOT and trimming are off (`RunAOTCompilation=false`, `PublishTrimmed=false`):
Roslyn plugin scripts and MongoDB.Driver both need runtime code generation. This
is the same call the desktop build already made.

## Build

Prerequisites: .NET 10 SDK with the `maui`/`android` workloads, a JDK 17, the
Android SDK, and Node.js (for the console bundle step).

```bash
# One-time / after console changes: build the SPA the app embeds.
cd src/console && npm ci && npm run build

# Debug build + deploy to a connected device or emulator
cd maui/LibraNextgen.Mobile
dotnet build -f net10.0-android -c Debug -t:Run

# Release APK (arm64)
dotnet publish -f net10.0-android -c Release \
  -p:AndroidPackageFormat=apk -p:RuntimeIdentifier=android-arm64
# -> bin/Release/net10.0-android/android-arm64/publish/*-Signed.apk
```

`maui/scripts/build-web-bundle.mjs` runs automatically before every build
(skip with `-p:SkipWebBundle=true`). It re-packs `src/console/dist` only when the
console actually changed, and stamps the archive so the app re-extracts only then.

Set `JAVA_HOME` and `ANDROID_HOME` when they are not already configured.

> After changing `Platforms/Android/Resources` or the manifest, delete `bin/` and
> `obj/` before rebuilding: a stale incremental build has produced an APK whose
> `MauiApplication` JNI binding was missing, which crashes on launch.

## Using it

1. Launch — the boot screen starts the embedded service, then the console loads.
2. First run: the console's own first-time setup creates the admin account (the
   service reports `needsSetup: true` at `/api/auth/status`). No storage or
   server questions are asked.
3. If the service fails to start, the boot screen shows the reason and a retry
   button (which restarts the embedded service in place).

## Layout of app data

Everything is inside the app's private directory
(`/data/data/com.libra.nextgen.mobile/files`), writable with no permission and
removed on uninstall:

```
libra.conf.json        service config (SQLite, loopback, fixed)
data/libra.db          the database
web/                   extracted console SPA (served via LIBRA_WEB_ROOT)
web-bundle.zip         staged copy of the packaged archive
logs/app.log           app + service log
server-rsa.key         agent beacon signing key
```

## Enabling iOS / macOS later

The shared code is platform-neutral already. On a Mac host:

1. uncomment the `net10.0-ios;net10.0-maccatalyst` line in
   `LibraNextgen.Mobile.csproj`;
2. the same `Directory.Build.targets` applies (it keys off
   `Microsoft.AspNetCore.App`, not off Android);
3. the platform-specific bits to add are the equivalents of the Android ones:
   ATS/loopback exceptions in `Info.plist`, an insets source, and a WebView
   configuration handler.

## Verification status

- The refactored service host is behaviour-preserving: the repository test suite
  passes (**259/259**, MongoDB-backed integration tests included).
- SQLite mode was smoke-tested end to end outside the app: config-driven port,
  `/api/auth/status` → `{"needsSetup":true}`, the SPA served from
  `LIBRA_WEB_ROOT`, and `data/libra.db` created in the user data directory.
- The Android APK builds, packages the ASP.NET Core shared framework and the
  console bundle, and installs and runs on a physical device.
