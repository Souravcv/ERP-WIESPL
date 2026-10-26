package com.wiespl.attendance;

import android.annotation.SuppressLint;
import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.os.Build;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.Log;
import android.webkit.CookieManager;

import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

import org.json.JSONObject;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Foreground location service, running from clock-in to clock-out with a notification that is always visible.
 * It takes a GPS fix every few minutes and sends POST /api/hr/check (with the CRM login cookie of the WebView):
 *  - every intervalMinutes (30 by default, the CRM setting hr_auto_ping_minutes), screen locked or not;
 *  - at once when the phone leaves the site radius (reason "geofence-exit");
 *  - at once the first time a mock (fake GPS app) position is seen.
 * The server measures the distance itself; the radius check here only decides when to send.
 */
public class TrackerService extends Service {
    private static final String TAG = "WIESPL-Tracker";
    private static final String CHANNEL = "attendance";
    private static final int NOTE_ID = 7001;
    private static final long FIX_EVERY_MS = 5 * 60_000L;   // GPS fix every 5 min (decides geofence exits)
    private static final long RETRY_MS = 2 * 60_000L;       // after a failed send
    private static final float MAX_ACCURACY_M = 150;        // the server refuses rougher fixes (hr_max_accuracy_m)
    static final String ACTION_CHECK = "com.wiespl.attendance.CHECK";

    static volatile boolean running = false;
    static volatile String lastSentText = null;
    static volatile String lastResult = null;

    private FusedLocationProviderClient fused;
    private final ExecutorService net = Executors.newSingleThreadExecutor();
    private Config cfg;
    private long lastSentAt = 0, lastTryAt = 0;   // elapsedRealtime
    private Boolean wasInside = null;
    private boolean mockReported = false;
    private boolean sending = false;

    private final LocationCallback callback = new LocationCallback() {
        @Override public void onLocationResult(LocationResult r) { for (Location l : r.getLocations()) onFix(l, null); }
    };

    // ------------------------------------------------------------------ settings shared with the plugin
    static class Config {
        String origin; int intervalMinutes = 30;
        String siteName; double siteLat = Double.NaN, siteLng = Double.NaN, siteRadius = 200;
        boolean hasSite() { return !Double.isNaN(siteLat) && !Double.isNaN(siteLng); }

        private static SharedPreferences prefs(Context c) { return c.getSharedPreferences("tracker", MODE_PRIVATE); }
        void save(Context c) {
            prefs(c).edit().putBoolean("active", true).putString("origin", origin).putInt("interval", intervalMinutes)
                .putString("siteName", siteName).putString("siteLat", String.valueOf(siteLat)).putString("siteLng", String.valueOf(siteLng))
                .putString("siteRadius", String.valueOf(siteRadius)).apply();
        }
        static Config load(Context c) {
            SharedPreferences p = prefs(c);
            if (!p.getBoolean("active", false)) return null;
            Config x = new Config();
            x.origin = p.getString("origin", "");
            x.intervalMinutes = p.getInt("interval", 30);
            x.siteName = p.getString("siteName", null);
            x.siteLat = Double.parseDouble(p.getString("siteLat", "NaN"));
            x.siteLng = Double.parseDouble(p.getString("siteLng", "NaN"));
            x.siteRadius = Double.parseDouble(p.getString("siteRadius", "200"));
            return x;
        }
        static void clear(Context c) { prefs(c).edit().clear().apply(); }
    }

    static boolean isMock(Location l) {
        return Build.VERSION.SDK_INT >= 31 ? l.isMock() : l.isFromMockProvider();
    }

    // Same rule as fence() in server/hr.js: inside if the distance less the GPS uncertainty (up to 100 m) is within the radius.
    private boolean inside(Location l) {
        float[] d = new float[1];
        Location.distanceBetween(l.getLatitude(), l.getLongitude(), cfg.siteLat, cfg.siteLng, d);
        return d[0] - Math.min(l.getAccuracy(), 100) <= cfg.siteRadius;
    }

    // ------------------------------------------------------------------ lifecycle
    @Override public IBinder onBind(Intent i) { return null; }

    @Override public void onCreate() {
        super.onCreate();
        fused = LocationServices.getFusedLocationProviderClient(this);
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= 26 && nm != null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Attendance location", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Shown while you are clocked in and your location is shared with WIESPL HR");
            nm.createNotificationChannel(ch);
        }
    }

    @SuppressLint("MissingPermission")
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        cfg = Config.load(this);
        if (cfg == null) { stopSelf(); return START_NOT_STICKY; }
        try {
            ServiceCompat.startForeground(this, NOTE_ID, note("Clocked in · location checks every " + cfg.intervalMinutes + " min"),
                Build.VERSION.SDK_INT >= 29 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION : 0);
        } catch (Exception e) {
            // Android refuses a location service started in the background without "Allow all the time": wait for the app.
            Log.w(TAG, "cannot start in the background", e);
            stopSelf();
            return START_NOT_STICKY;
        }
        if (!running) {
            running = true;
            LocationRequest req = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, FIX_EVERY_MS)
                .setMinUpdateIntervalMillis(FIX_EVERY_MS / 2).setWaitForAccurateLocation(true).build();
            fused.requestLocationUpdates(req, callback, Looper.getMainLooper());
            freshFix("interval");   // first check right away
        } else if (intent != null && ACTION_CHECK.equals(intent.getAction())) {
            if (SystemClock.elapsedRealtime() - lastSentAt >= cfg.intervalMinutes * 60_000L - 60_000L) freshFix("interval");
        }
        scheduleAlarm();
        return START_STICKY;
    }

    @Override public void onDestroy() {
        running = false;
        fused.removeLocationUpdates(callback);
        AlarmManager am = getSystemService(AlarmManager.class);
        if (am != null) am.cancel(alarmIntent());
        net.shutdown();
        super.onDestroy();
    }

    // Backstop: an alarm that fires even in Doze (inexact, at most ~every 9 min), in case the location updates are held back.
    private void scheduleAlarm() {
        AlarmManager am = getSystemService(AlarmManager.class);
        if (am == null) return;
        long at = SystemClock.elapsedRealtime() + cfg.intervalMinutes * 60_000L;
        am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, at, alarmIntent());
    }
    private PendingIntent alarmIntent() {
        Intent i = new Intent(this, TrackerService.class).setAction(ACTION_CHECK);
        return PendingIntent.getService(this, 1, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    @SuppressLint("MissingPermission")
    private void freshFix(String reason) {
        fused.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, null).addOnSuccessListener(l -> { if (l != null) onFix(l, reason); });
    }

    // ------------------------------------------------------------------ deciding when to send
    private void onFix(Location l, String forced) {
        if (cfg == null) return;
        boolean mock = isMock(l);
        long now = SystemClock.elapsedRealtime();
        String reason = forced;
        if (cfg.hasSite() && l.getAccuracy() <= MAX_ACCURACY_M) {
            boolean in = inside(l);
            if (Boolean.TRUE.equals(wasInside) && !in) reason = "geofence-exit";
            wasInside = in;
        }
        if (mock && !mockReported) reason = reason == null ? "interval" : reason;
        if (reason == null && now - lastSentAt >= cfg.intervalMinutes * 60_000L) reason = "interval";
        if (reason == null || sending || l.getAccuracy() > MAX_ACCURACY_M && !mock) return;
        if (!"geofence-exit".equals(reason) && now - lastTryAt < RETRY_MS) return;
        send(l, reason, mock);
    }

    private void send(Location l, String reason, boolean mock) {
        sending = true;
        lastTryAt = SystemClock.elapsedRealtime();
        String cookie = CookieManager.getInstance().getCookie(cfg.origin);
        PowerManager pm = getSystemService(PowerManager.class);
        PowerManager.WakeLock wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "wiespl:check");
        wl.acquire(60_000L);
        net.execute(() -> {
            int code = -1; String msg = null;
            try {
                JSONObject body = new JSONObject();
                body.put("lat", l.getLatitude()).put("lng", l.getLongitude()).put("accuracy", Math.round(l.getAccuracy()))
                    .put("mock", mock).put("reason", reason).put("source", "android");
                HttpURLConnection c = (HttpURLConnection) new URL(cfg.origin + "/api/hr/check").openConnection();
                c.setConnectTimeout(20000); c.setReadTimeout(30000); c.setDoOutput(true); c.setRequestMethod("POST");
                c.setRequestProperty("Content-Type", "application/json");
                c.setRequestProperty("ngrok-skip-browser-warning", "1");
                if (cookie != null) c.setRequestProperty("Cookie", cookie);
                try (OutputStream o = c.getOutputStream()) { o.write(body.toString().getBytes(StandardCharsets.UTF_8)); }
                code = c.getResponseCode();
                InputStream in = code < 400 ? c.getInputStream() : c.getErrorStream();
                String text = in == null ? "" : read(in);
                JSONObject j = text.isEmpty() ? new JSONObject() : new JSONObject(text);
                msg = code == 200 ? summary(j) : j.optString("error", "HTTP " + code);
            } catch (Exception e) {
                msg = "no connection (" + e.getClass().getSimpleName() + ")";
            }
            final int fc = code; final String fm = msg;
            new android.os.Handler(Looper.getMainLooper()).post(() -> afterSend(fc, fm, reason, mock));
            if (wl.isHeld()) wl.release();
        });
    }

    private static String read(InputStream in) throws java.io.IOException {
        java.io.ByteArrayOutputStream b = new java.io.ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        for (int n; (n = in.read(buf)) > 0; ) b.write(buf, 0, n);
        in.close();
        return b.toString("UTF-8");
    }

    private static String summary(JSONObject j) {
        if (j.isNull("site")) return "recorded";
        boolean in = j.optBoolean("inside", true);
        return (in ? "at " : "OUTSIDE ") + j.optString("site") + " (" + j.optInt("distance") + " m)";
    }

    private void afterSend(int code, String msg, String reason, boolean mock) {
        sending = false;
        String time = new SimpleDateFormat("HH:mm", Locale.US).format(new Date());
        Log.i(TAG, "check " + reason + " → " + code + " " + msg);
        lastResult = code + " " + msg;
        if (code == 200) {
            lastSentAt = SystemClock.elapsedRealtime();
            lastSentText = time;
            if (mock) mockReported = true;
            update("Clocked in · last check " + time + ": " + msg);
        } else if (code == 401) {
            update("Open WIESPL Attendance and log in again: location checks are paused");
        } else if (code == 409) {
            // Not clocked in any more (clocked out on another device, or the day was closed): stop.
            Config.clear(this);
            stopSelf();
        } else {
            update("Clocked in · check at " + time + " not sent: " + msg + " (trying again)");
        }
    }

    // ------------------------------------------------------------------ notification
    private Notification note(String text) {
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_location)
            .setContentTitle("WIESPL attendance: location shared")
            .setContentText(text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
            .setOngoing(true).setOnlyAlertOnce(true).setContentIntent(pi)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build();
    }
    private void update(String text) {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null) nm.notify(NOTE_ID, note(text));
    }
}
