package com.wiespl.attendance;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

import androidx.core.content.ContextCompat;

/**
 * Keeps the location checks going until clock-out: the alarm of TrackerService, and the phone restarting or the app being
 * updated (these clear alarms). The service alive: only the next alarm and the check if due. Otherwise it is started again.
 */
public class TrackerAlarm extends BroadcastReceiver {
    @Override public void onReceive(Context c, Intent intent) {
        if (TrackerService.Config.load(c) == null) return;
        TrackerService s = TrackerService.self;
        if (s != null && TrackerService.running) { s.tick(); return; }
        TrackerService.armAlarm(c, TrackerService.WATCHDOG_MS);
        if (!TrackerService.mayRunInBackground(c)) { TrackerService.noticeStopped(c); return; }
        try {
            ContextCompat.startForegroundService(c, new Intent(c, TrackerService.class));
        } catch (Exception e) {
            Log.w("WIESPL-Tracker", "cannot start in the background", e);
            TrackerService.noticeStopped(c);
        }
    }
}
