# WIESPL Attendance – Android app

A small Android app (Capacitor 8) that opens the CRM's **My Attendance** page (`#/attend`) and adds what a browser cannot do:
location checks **while the phone is locked or the app is closed**.

- It loads the live CRM over HTTPS (`server.url` in `capacitor.config.json`) and logs in with the normal CRM login.
- Clock in / out and the manual checks take the GPS fix through the app, with the **fake-GPS flag** (`Location.isMock()`).
- From clock-in to clock-out a foreground service (`TrackerService`, with an always-visible notification) takes a GPS fix every 5 min and sends
  `POST /api/hr/check`:
  - every 30 min (the CRM setting *hr_auto_ping_minutes*), screen on or off;
  - **at once when the phone leaves the site radius** (`reason: "geofence-exit"`, saved as a *Geofence exit* check);
  - at once the first time a mock location is seen (`mock: true`).
- The server (`server/hr.js`) flags **"fake GPS app detected"**, sends the day to HR review straight away and notifies HR.
- The service stops at clock-out (or when the server says the person is no longer clocked in).
- A privacy notice is shown at first start; the app closes if it is not accepted.

Where the code is:

| File | What it does |
| --- | --- |
| `capacitor.config.json` | CRM address (`server.url`), app id `com.wiespl.attendance` |
| `android/app/src/main/java/com/wiespl/attendance/MainActivity.java` | registers the plugin, privacy notice |
| `…/AttendanceTrackerPlugin.java` | `getPosition`, `start`, `stop`, `status`, `allowAlways` – called from `public/js/views/attend.js` |
| `…/TrackerService.java` | the background location service and the check requests |
| `android/app/src/main/res/values/strings.xml` | privacy notice text |
| `www/` | fallback pages (no connection) |

The CRM page detects the app (`window.Capacitor`), so **changes to the attendance screen need no new APK** – only the native parts do.

## 1. Install the tools (once, on the PC that builds)

1. **Android Studio** (current stable) from <https://developer.android.com/studio>. It brings its own Java (JDK 21) and the Android SDK.
   In *SDK Manager* make sure *Android SDK Platform 36*, *Android SDK Build-Tools*, *Platform-Tools* and *Android Emulator* are installed.
2. **Node.js 22+** (already on the office PC).
3. In this folder: `npm install` (only the first time, and after changing Capacitor versions).

## 2. Set the CRM address

`capacitor.config.json` → `server.url` (and the *Try again* link in `www/offline.html`). Today it is the ngrok address
`https://rut-flattop-appear.ngrok-free.dev/#/attend`; change it to `https://crm.wiespl.com/#/attend` when the Cloudflare tunnel is live,
then run step 3 again and build a new APK. It must be **https**.

## 3. Copy the settings into the Android project

```bash
npx cap sync android
```

## 4. Build

### Test build (debug APK, no key needed)

Android Studio → *Open* → `android-app/android` → wait for Gradle → *Build → Build App Bundle(s) / APK(s) → Build APK(s)*.
Or from a terminal in `android-app/android`: `gradlew.bat assembleDebug` (set `JAVA_HOME` to a JDK 21 and put
`sdk.dir=D:/Android/sdk` – forward slashes – in `android/local.properties` if Android Studio did not create it).
The APK is `android/app/build/outputs/apk/debug/app-debug.apk`.

### Signed release APK (for the technicians' phones)

1. Make the signing key **once** and keep it safe (a copy outside the PC, e.g. with the MD). Every later update must be signed with the same key,
   or phones refuse to update and the app has to be uninstalled first.
   Android Studio → *Build → Generate Signed App Bundle / APK → APK → Create new…*, or:
   ```bash
   keytool -genkeypair -v -keystore wiespl-attendance.jks -alias wiespl -keyalg RSA -keysize 2048 -validity 10000
   ```
   (`keytool` is in Android Studio's `jbr\bin`.) Put `wiespl-attendance.jks` in `android-app/android/`.
2. Create `android-app/android/keystore.properties` (it is in `.gitignore` – never commit it):
   ```properties
   storeFile=wiespl-attendance.jks
   storePassword=…
   keyAlias=wiespl
   keyPassword=…
   ```
3. Build: Android Studio *Build → Generate Signed App Bundle / APK → APK → release*, or in `android-app/android`:
   `gradlew.bat assembleRelease` → `android/app/build/outputs/apk/release/app-release.apk`.
4. For a new version raise `versionCode` (and `versionName`) in `android/app/build.gradle`.

## 5. Install on a phone

Send `app-release.apk` (WhatsApp / e-mail / USB), open it and allow *Install unknown apps* for that app once.
Then on the phone:

1. Open **WIESPL Attendance**, read the privacy notice, tap *I understand*.
2. Log in with the CRM login (the one HR entered on the employee record).
3. Clock in. Allow **Location** (*While using the app*), **Notifications**, and *Allow* when asked to let the app run in the background
   (battery optimisation).
4. Recommended: tap *Set location to "Allow all the time"* on the attendance screen (or Settings → Apps → WIESPL Attendance → Permissions →
   Location → *Allow all the time*). Without it tracking still runs from clock-in, but if the phone kills the app it stays off until the app is opened again.
5. Xiaomi / Redmi / POCO, Oppo, Vivo, Realme, OnePlus also stop background apps on their own: set *Battery → No restrictions* (or *Autostart* on)
   for WIESPL Attendance. See <https://dontkillmyapp.com> for the exact steps per brand.

While the person is clocked in a notification *"WIESPL attendance: location shared"* is always shown with the time of the last check.

## 6. Test on the emulator with simulated locations

1. Android Studio → *Device Manager* → create a phone with a **Google Play** or **Google APIs** system image (API 34 or newer) and start it.
2. Run a test server on a **copy** of the data (never the live database), from the repository folder:
   ```bash
   set WIESPL_DATA_DIR=C:\temp\wiespl-copy
   set PORT=3002
   node server/index.js
   ```
   For a test build set `server.url` to `http://localhost:3002/#/attend` (and `"cleartext": true`), `npx cap sync android`, build the
   **debug** APK, and run `adb reverse tcp:3002 tcp:3002`. Only debug builds allow plain http, and only to localhost / 10.0.2.2
   (`app/src/debug/`). **Put the https address back before building the APK for the phones.**
3. Install the debug APK (`adb install -r app\build\outputs\apk\debug\app-debug.apk`), log in, set the emulator location to the site
   (*Extended controls (…) → Location*, or `adb emu geo fix <lng> <lat>` – longitude first), clock in.
4. To skip the 30-min wait set *hr_auto_ping_minutes* to 5 **in the test copy** (the app's minimum), and open the attendance page again.
   Lock the screen (`adb shell input keyevent 26`) and force Doze (`adb shell dumpsys deviceidle force-idle`): checks keep coming every 5 min.
   Move the location outside the radius: a *Geofence exit* check arrives with the next GPS fix (≤ 5 min).
5. Fake GPS: `adb emu geo fix` is a normal (not mock) GPS position. To feed a **mock** position like a fake-GPS app does:
   ```bash
   adb shell appops set com.android.shell android:mock_location allow
   adb shell cmd location providers add-test-provider gps
   adb shell cmd location providers set-test-provider-enabled gps true
   adb shell cmd location providers set-test-provider-location gps --location 18.5204,73.8567 --accuracy 5
   ```
   (`adb shell cmd location providers remove-test-provider gps` ends it.) On a real phone install any "Fake GPS" app and select it under
   *Developer options → Select mock location app*.
   The day gets the flag *fake GPS app detected*, is set to *To review*, and HR gets a pop-up notification.
6. What the service does: `adb logcat -s WIESPL-Tracker`.

## Notes

- The ngrok free address shows a "You are about to visit…" page the first time; tap *Visit Site* once. The background checks send the
  `ngrok-skip-browser-warning` header and are not affected. The Cloudflare tunnel (`crm.wiespl.com`) has no such page.
- If the login runs out (7 days) the notification says *log in again*; checks resume after logging in.
- Positions rougher than ±150 m (*hr_max_accuracy_m*) are not sent; the next fix is used.
