# Android Build (Capacitor)

This document covers building, installing, and supporting the Android APK build of NoteView. The PWA repository remains build-free; this is the add-on build path for the sibling Capacitor project.

---

## 1. Overview

NoteView-Android is an Android APK build of NoteView that wraps the existing PWA in a [Capacitor](https://capacitorjs.com/) WebView shell. The web code is unchanged in behavior — it simply runs inside an Android System WebView container instead of a Chrome tab.

**Why it exists.** In the browser, NoteView vaults that use the Origin Private File System (OPFS) live in Chrome's site-data storage. Chrome aggressively evicts site data (often within days of no use), which silently wipes OPFS vaults and destroys user data. The Android app sidesteps this entirely: its WebView storage lives in an **app-private location** (`/data/data/ai.noteview.app/...`), which is immune to Chrome's eviction policy. The data only disappears if the user explicitly clears app data or uninstalls the app.

**Variant.** This is **B-Minimal**: wrap the PWA in Capacitor, support OPFS vaults only, and let WebView's app-private storage handle persistence. File System Access API ("pick a folder") vaults are hidden in the Android build because Android WebView does not support `showDirectoryPicker()`.

For the storage model that motivates this build path, see [data-flow.md](data-flow.md) (the OPFS vault model).

---

## 2. Prerequisites

These instructions are Linux-flavored but the same steps apply on macOS and Windows (use the platform-appropriate shell).

| Requirement | Minimum | Notes |
|-------------|---------|-------|
| Host OS | Linux / macOS / Windows | Linux commands shown here |
| Node.js | 22+ | Required by Capacitor CLI and gradle tooling |
| npm | 10+ | Bundled with Node 22 |
| Java JDK | 17+ | OpenJDK recommended. Java 25 also works |
| Android SDK | Command-Line Tools or full Android Studio | API 34 + build-tools 34.0.0 |
| `adb` (optional) | latest | For sideloading from the dev machine |

**Easiest path:** install [Android Studio](https://developer.android.com/studio) and let it manage the SDK. Open the `android/` folder once and it will offer to download any missing components.

**Headless path:** install the `android-sdk` package, or download the [command-line tools](https://developer.android.com/tools) from developer.android.com and run `sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0"`.

### Environment variables

| Variable | Value | Required |
|----------|-------|----------|
| `ANDROID_HOME` (or `ANDROID_SDK_ROOT`) | Path to SDK root (e.g. `$HOME/Android/Sdk`) | Yes |
| `PATH` | Must include `$ANDROID_HOME/platform-tools` and `$ANDROID_HOME/cmdline-tools/latest/bin` | Yes |

Network access is required for `npm install` and the initial gradle dependency download (subsequent builds are offline-capable).

---

## 3. Project layout

NoteView and NoteView-Android are **sibling directories**:

```
/home/thinx/Projects/NoteView/
├── NoteView/                # PWA repo (web code lives here)
└── NoteView-Android/        # Capacitor project (Android shell)
```

Key points:

- **NoteView-Android is a separate npm project.** It has its own `package.json`, `node_modules/`, and `capacitor.config.json`.
- **The PWA repo remains build-free.** No build step is added to `NoteView/`. All PWA changes keep working in browsers unchanged.
- **`webDir` points at the PWA.** `capacitor.config.json` contains `"webDir": "../NoteView"`, so Capacitor copies the PWA's static files into the Android assets at sync time:

```json
{
  "appId": "ai.noteview.app",
  "appName": "NoteView",
  "webDir": "../NoteView",
  "android": { "allowMixedContent": false }
}
```

---

## 4. First-time setup

From the Android project directory:

```bash
cd /home/thinx/Projects/NoteView/NoteView-Android
npm install
npx cap sync android
```

`npx cap sync android` copies the `../NoteView` files into `android/app/src/main/assets/public`, which is where the WebView serves them from at runtime.

Notes:

- **`npm install`** is only needed once, or after `package.json` changes.
- **`cap sync`** is needed whenever the PWA web code changes (any edit under `NoteView/js/`, `NoteView/css/`, `NoteView/index.html`, etc.). If you forget it, the APK will ship stale web code.

---

## 5. Building the APK

### Debug build (for sideloading)

```bash
cd /home/thinx/Projects/NoteView/NoteView-Android
npx cap sync android
cd android
./gradlew assembleDebug
```

- **Output APK:** `android/app/build/outputs/apk/debug/app-debug.apk`
- Signed with the auto-generated **debug keystore** — fine for sideload and testing, **not** for distribution.

On Windows use `gradlew.bat` instead of `./gradlew`.

### Release build (for distribution, self-signed)

1. Generate a keystore (one-time):
   ```bash
   keytool -genkey -v -keystore noteview-release.keystore -alias noteview \
     -keyalg RSA -keysize 2048 -validity 10000
   ```
2. Configure `android/app/build.gradle` under `signingConfigs.release` to reference the keystore, its alias, and passwords (read them from `local.properties` or environment variables — never hard-code).
3. Build:
   ```bash
   cd android
   ./gradlew assembleRelease
   ```
4. **Output APK:** `android/app/build/outputs/apk/release/app-release.apk`

> **Do NOT commit the keystore or its password.** Keep the keystore file outside the repo (e.g. in a password manager or a separate secrets store). Losing the keystore means you can never push an update to the same `appId`.

Full release-signing details (including Play App Signing) are covered in the [Android signing documentation](https://developer.android.com/build/building-cmdline#sign_cmdline).

---

## 6. Sideload on a device

### Method A: adb from dev machine (recommended)

```bash
adb install -r NoteView-Android/android/app/build/outputs/apk/debug/app-debug.apk
```

- The device must have **USB debugging** enabled (Settings → System → Developer options → USB debugging).
- `-r` reinstalls over the existing install, **preserving app data**. This is the recommended way to push updates during testing.

### Method B: APK file on device

1. Copy the APK onto the device (USB transfer, Google Drive, email, etc.).
2. On first install, Android will prompt you to enable **"Install unknown apps"** for whichever app is opening the file (Files, Chrome, etc.). This is a normal security prompt.
3. Tap the APK in the device's file manager to install.

### Updating an existing install

- Use the same `adb install -r` command or the same APK-file method. Android preserves app data on reinstall **by default**.
- **Do not change `appId` in `capacitor.config.json`** between versions. A different `appId` is treated as a brand-new app — the old data stays under the old package name and becomes inaccessible.

---

## 7. Acceptance test (verification checklist)

After the first install, verify the following. The storage-survival tests are the whole point of this build path — if any fail, report it.

| ✓/✗ | Check |
|-----|-------|
| ☐ | App launches without crash |
| ☐ | Creating an OPFS vault works; **no folder-picker option is shown** |
| ☐ | Add a note, then **force-stop** the app from Android Settings → Apps → NoteView, relaunch — note survives |
| ☐ | Add a note, **reboot the device** — note survives |
| ☐ | Add a note, wait **24 hours** — note survives |
| ☐ | Update **"Android System WebView"** via Play Store, relaunch — note survives |
| ☐ | Editing notes with CodeMirror works (typing, cursor, checkboxes) |
| ☐ | Saving a note triggers a git commit (verify via Settings → diagnostics or git log) |
| ☐ | AI panel opens and connects (if a model profile is configured) |

If any survival test fails, report it. The plan's Phase 0 spike was designed to catch these, but real-world device and WebView variability is possible — a failure here would require escalation to Variant B-Full (a storage abstraction layer) or a different persistence strategy.

---

## 8. Known limitations of the Android build

- **OPFS vaults only.** The File System Access API (`showDirectoryPicker`) is not supported in Android WebView. The "pick a folder" vault option is hidden. Users cannot point the app at an external folder.
- **Dictation works on tested devices.** The Web Speech API is supported in the Android System WebView (verified on Pixel 6 / Android 17 / WebView Chrome 150). On devices with heavily customised OEM ROMs, behaviour may vary; if the mic button is non-functional, use the system keyboard's voice input as a fallback.
- **No service worker.** Inside Capacitor the service worker is intentionally not registered (the APK already bundles all assets). This is expected; offline support is provided by the APK itself, not browser caching.
- **No auto-update.** The APK does not auto-update. To get a new version, rebuild and reinstall. Updates via `adb install -r` preserve data; uninstalling first wipes it.
- **First-party distribution only.** There is no Play Store release. Distribution is via direct APK sideload.

---

## 9. Troubleshooting

### App crashes on launch

Capture the WebView log:

```bash
adb logcat | grep -iE 'chromium|noteview|capacitor'
```

The most common cause is a JavaScript error in the web code — look for a JS stack trace in the output. If the crash is native, look for a `FATAL EXCEPTION` block.

### Storage seems empty after a "kill"

This is exactly the bug the Android build is trying to solve. If it happens inside the Android app, the cause is one of:

- The WebView implementation isn't persisting OPFS → **report this**; it would require escalation to Variant B-Full.
- The user explicitly cleared app data via **Android Settings → Apps → NoteView → Storage → Clear Data**.
- The user **uninstalled and reinstalled** — data is wiped on uninstall by default. To preserve data across reinstalls, use `adb install -r` *without* uninstalling first.

### "Install unknown apps" warning

Normal Android security prompt. Allow it for whichever app is performing the install (Files, Chrome, etc.). It only needs to be granted once per installer app.

### Gradle build fails with SDK errors

Open the project in Android Studio (open the `NoteView-Android/android` folder) and let it download the missing SDK components, or install them from the command line:

```bash
sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0"
```

Then re-run `./gradlew assembleDebug`.

### `npx cap sync` complains about webDir

Verify `capacitor.config.json` contains `"webDir": "../NoteView"` and that the sibling `NoteView/` directory actually exists at the expected path. The webDir is resolved relative to the `NoteView-Android/` project root.

---

## 10. Architecture notes

- **The NoteView PWA remains build-free.** All PWA changes continue to work in browsers unchanged.
- **The Android project simply wraps the existing PWA** via Capacitor's WebView. There is no separate mobile codebase for the app logic.
- **The web code uses `window.Platform.isCapacitor`** (from `js/utils/platform.js`) to gate Capacitor-specific behavior at runtime. Other useful flags on the same object: `Platform.isAndroid`, `Platform.supportsFileSystemPicker`.
- **Storage lives in the app-private location.** IndexedDB and OPFS inside the WebView are written to `/data/data/ai.noteview.app/app_webview/` — app-private, not subject to Chrome's site-data eviction.
- **File System Access API calls are gated out** because `Platform.supportsFileSystemPicker` returns `false` inside Capacitor. The service worker is also skipped (`js/sw-register.js` short-circuits when Capacitor is detected).

For the broader storage and state model, see [data-flow.md](data-flow.md); for git behavior inside the app (commit-on-save), see [git-integration.md](git-integration.md).

---

## 11. Future work (out of scope for B-Minimal)

- **Variant B-Full:** a storage abstraction layer using [@capacitor/filesystem](https://capacitorjs.com/docs/apis/filesystem) to support external folders (File System Access API parity via native file pickers).
- **iOS build** (requires macOS + Xcode).
- **Play Store release** (requires a Play developer account, privacy policy, app-content questionnaire, etc.).
- **Native speech recognition plugin** to replace the in-app mic button on devices where the WebView SpeechRecognition API is unavailable or unreliable.
- **Auto-update mechanism** (in-app update check + download prompt, or Play Store distribution).
