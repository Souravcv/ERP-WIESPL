package com.wiespl.attendance;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Context;
import android.content.Intent;
import android.location.Location;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import android.webkit.CookieManager;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.android.gms.location.CurrentLocationRequest;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

/**
 * Called from the CRM page #/attend (public/js/views/attend.js) through window.Capacitor.nativePromise('AttendanceTracker', …):
 *  getPosition – one GPS fix with the mock flag (used for clock in / out and the manual checks)
 *  start       – after clock-in: start the background location service (checks every N minutes and on leaving the site)
 *  stop        – after clock-out
 *  status      – is the service running, when was the last check sent
 *  allowAlways – open the settings page to allow location "all the time" (keeps tracking after the phone restarts the app)
 */
@CapacitorPlugin(
    name = "AttendanceTracker",
    permissions = {
        @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }),
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
    }
)
public class AttendanceTrackerPlugin extends Plugin {

    private boolean hasLocation() {
        return getPermissionState("location") == PermissionState.GRANTED;
    }

    @PluginMethod
    public void getPosition(PluginCall call) {
        if (!hasLocation()) { requestPermissionForAlias("location", call, "afterLocationForPosition"); return; }
        fix(call);
    }

    @PermissionCallback
    private void afterLocationForPosition(PluginCall call) {
        if (!hasLocation()) { call.reject("Location is not allowed: allow location for WIESPL Attendance in the phone settings"); return; }
        fix(call);
    }

    @SuppressLint("MissingPermission")
    private void fix(PluginCall call) {
        CurrentLocationRequest req = new CurrentLocationRequest.Builder()
            .setPriority(Priority.PRIORITY_HIGH_ACCURACY).setMaxUpdateAgeMillis(0).setDurationMillis(20000).build();
        LocationServices.getFusedLocationProviderClient(getContext()).getCurrentLocation(req, null)
            .addOnSuccessListener(loc -> {
                if (loc == null) { call.reject("No GPS fix in 20 seconds: switch on GPS, step outside or near a window and try again"); return; }
                call.resolve(toJs(loc));
            })
            .addOnFailureListener(e -> call.reject("Location not available: switch on GPS (" + e.getMessage() + ")"));
    }

    static JSObject toJs(Location loc) {
        JSObject o = new JSObject();
        o.put("lat", loc.getLatitude());
        o.put("lng", loc.getLongitude());
        o.put("accuracy", Math.round(loc.getAccuracy()));
        o.put("mock", TrackerService.isMock(loc));
        return o;
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (!hasLocation()) { requestPermissionForAlias("location", call, "afterLocationForStart"); return; }
        askNotifications(call);
    }

    @PermissionCallback
    private void afterLocationForStart(PluginCall call) {
        if (!hasLocation()) { call.reject("Location is not allowed: the app cannot record your attendance without it"); return; }
        askNotifications(call);
    }

    // Android 13+: the "location is being shared" notification needs this permission to show (the service runs either way).
    private void askNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "afterNotifications");
            return;
        }
        startService(call);
    }

    @PermissionCallback
    private void afterNotifications(PluginCall call) {
        startService(call);
    }

    private void startService(PluginCall call) {
        Context ctx = getContext();
        String origin = call.getString("origin", originOf(getBridge().getServerUrl()));
        TrackerService.Config c = new TrackerService.Config();
        c.origin = origin;
        c.intervalMinutes = Math.max(5, call.getInt("intervalMinutes", 30));
        JSObject site = call.getObject("site");
        if (site != null && site.has("lat") && site.has("lng")) {
            c.siteName = site.getString("name", "the site");
            c.siteLat = site.optDouble("lat");
            c.siteLng = site.optDouble("lng");
            c.siteRadius = site.optDouble("radius", 200);
        }
        c.save(ctx);
        CookieManager.getInstance().flush(); // the login cookie must be on disk if Android restarts the service later
        ContextCompat.startForegroundService(ctx, new Intent(ctx, TrackerService.class));
        askBatteryExemption();
        JSObject out = new JSObject();
        out.put("running", true);
        out.put("background", ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_BACKGROUND_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED || Build.VERSION.SDK_INT < 29);
        call.resolve(out);
    }

    // Without this, many phones stop the service after some time with the screen off. Asked once (the page calls start on every visit).
    @SuppressLint("BatteryLife")
    private void askBatteryExemption() {
        PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        if (pm == null || pm.isIgnoringBatteryOptimizations(getContext().getPackageName())) return;
        android.content.SharedPreferences p = getContext().getSharedPreferences("app", Context.MODE_PRIVATE);
        if (p.getBoolean("batteryAsked", false)) return;
        p.edit().putBoolean("batteryAsked", true).apply();
        try {
            Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getContext().getPackageName()));
            getActivity().startActivity(i);
        } catch (Exception ignored) { /* some phones have no such screen */ }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Context ctx = getContext();
        TrackerService.Config.clear(ctx);
        ctx.stopService(new Intent(ctx, TrackerService.class));
        call.resolve();
    }

    @PluginMethod
    public void status(PluginCall call) {
        TrackerService.Config c = TrackerService.Config.load(getContext());
        JSObject out = new JSObject();
        out.put("running", c != null && TrackerService.running);
        out.put("lastSent", TrackerService.lastSentText);
        out.put("lastResult", TrackerService.lastResult);
        call.resolve(out);
    }

    @PluginMethod
    public void allowAlways(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    static String originOf(String url) {
        if (url == null) return "";
        Uri u = Uri.parse(url);
        return u.getScheme() + "://" + u.getAuthority();
    }
}
