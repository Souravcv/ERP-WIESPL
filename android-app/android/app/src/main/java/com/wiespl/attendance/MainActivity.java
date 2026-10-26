package com.wiespl.attendance;

import android.content.SharedPreferences;
import android.os.Bundle;
import android.text.Html;

import androidx.appcompat.app.AlertDialog;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final int NOTICE_VERSION = 1;   // raise when the privacy notice text changes, so everyone sees it again

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AttendanceTrackerPlugin.class);
        super.onCreate(savedInstanceState);
        SharedPreferences p = getSharedPreferences("app", MODE_PRIVATE);
        if (p.getInt("privacyAccepted", 0) < NOTICE_VERSION) showPrivacyNotice(p);
    }

    // Shown at first start, before any location is taken. Closing it closes the app.
    private void showPrivacyNotice(SharedPreferences p) {
        new AlertDialog.Builder(this)
            .setTitle(R.string.privacy_title)
            .setMessage(Html.fromHtml(getString(R.string.privacy_text), Html.FROM_HTML_MODE_LEGACY))
            .setCancelable(false)
            .setPositiveButton(R.string.privacy_agree, (d, w) -> p.edit().putInt("privacyAccepted", NOTICE_VERSION).apply())
            .setNegativeButton(R.string.privacy_close, (d, w) -> finish())
            .show();
    }
}
