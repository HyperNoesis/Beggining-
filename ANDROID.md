# Genesis as an Android app (v0.40 wrapper)
Capacitor wraps the existing site in a real APK: same code, own icon, no browser bar, camera/mic permissions asked natively.
IMPORTANT, honest: it still runs inside Android WebView, so matting/WebGL speed is about the same as Chrome. This is step 1 (installable app). Step 2 (speed) = native segmentation plugin (MediaPipe Android) feeding the same compositor.
## Build with no PC
1. Create a GitHub repo, upload this whole folder (zip contents). Use the GitHub website "Add file > Upload files", or ask Claude to push it.
2. Repo > Actions > "Build Genesis APK" > Run workflow. Wait ~5 min.
3. Open the finished run > Artifacts > Genesis-debug-apk > download, unzip, install app-debug.apk on the phone (allow "install unknown apps").
## Build on a PC
npm install && npm run sync && cd android && ./gradlew assembleDebug
## Known limits (not verified, no Android SDK in the sandbox)
- APK never built here: first run of the workflow is the real test.
- Models/CDN files (jsdelivr, huggingface, google storage) still download at first use, so first launch needs internet.
- Play Store needs a signed release AAB (keystore) later.
