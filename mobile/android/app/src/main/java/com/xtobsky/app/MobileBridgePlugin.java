package com.xtobsky.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.OpenableColumns;
import android.util.Base64;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKey;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;

@CapacitorPlugin(name = "MobileBridge")
public class MobileBridgePlugin extends Plugin {
    private static final String PREFS_NAME = "x_to_bsky_mobile";
    private static final String KEY_API_BASE_URL = "api_base_url";
    private static final String SECURE_PREFS_NAME = "x_to_bsky_secure";
    private static final String KEY_X_BEARER_TOKEN = "x_bearer_token";
    private static final String KEY_BSKY_APP_PASSWORD = "bsky_app_password";
    private static final String CHANNEL_ID = "sync_status";
    private static final int NOTIFICATION_ID = 7010;

    @PluginMethod
    public void getRuntimeConfig(PluginCall call) {
        SharedPreferences preferences = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        JSObject result = new JSObject();
        result.put("apiBaseUrl", preferences.getString(KEY_API_BASE_URL, ""));
        call.resolve(result);
    }

    @PluginMethod
    public void setRuntimeConfig(PluginCall call) {
        String apiBaseUrl = call.getString("apiBaseUrl", "");
        SharedPreferences preferences = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        preferences.edit().putString(KEY_API_BASE_URL, apiBaseUrl).apply();
        call.resolve();
    }

    @PluginMethod
    public void clearRuntimeConfig(PluginCall call) {
        SharedPreferences preferences = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        preferences.edit().remove(KEY_API_BASE_URL).apply();
        call.resolve();
    }

    @PluginMethod
    public void getSecureCredentials(PluginCall call) {
        try {
            SharedPreferences preferences = getSecurePreferences();
            JSObject result = new JSObject();
            result.put("xBearerToken", preferences.getString(KEY_X_BEARER_TOKEN, ""));
            result.put("bskyAppPassword", preferences.getString(KEY_BSKY_APP_PASSWORD, ""));
            call.resolve(result);
        } catch (Exception exception) {
            call.reject("Failed to load secure credentials.", exception);
        }
    }

    @PluginMethod
    public void setSecureCredentials(PluginCall call) {
        try {
            SharedPreferences preferences = getSecurePreferences();
            preferences.edit()
                .putString(KEY_X_BEARER_TOKEN, call.getString("xBearerToken", ""))
                .putString(KEY_BSKY_APP_PASSWORD, call.getString("bskyAppPassword", ""))
                .apply();
            call.resolve();
        } catch (Exception exception) {
            call.reject("Failed to store secure credentials.", exception);
        }
    }

    @PluginMethod
    public void clearSecureCredentials(PluginCall call) {
        try {
            SharedPreferences preferences = getSecurePreferences();
            preferences.edit()
                .remove(KEY_X_BEARER_TOKEN)
                .remove(KEY_BSKY_APP_PASSWORD)
                .apply();
            call.resolve();
        } catch (Exception exception) {
            call.reject("Failed to clear secure credentials.", exception);
        }
    }

    @PluginMethod
    public void pickArchive(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[] {
            "application/zip",
            "application/json",
            "text/plain"
        });
        startActivityForResult(call, intent, "handlePickArchive");
    }

    @ActivityCallback
    private void handlePickArchive(PluginCall call, android.content.Intent result) {
        if (call == null) {
            return;
        }

        Uri uri = result != null ? result.getData() : null;
        if (uri == null) {
            call.reject("No archive selected.");
            return;
        }

        try {
            getContext().getContentResolver().takePersistableUriPermission(
                uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION
            );
        } catch (Exception ignored) {
        }

        try (InputStream inputStream = getContext().getContentResolver().openInputStream(uri);
             ByteArrayOutputStream outputStream = new ByteArrayOutputStream()) {
            if (inputStream == null) {
                call.reject("Unable to open selected archive.");
                return;
            }

            byte[] buffer = new byte[8192];
            int length;
            while ((length = inputStream.read(buffer)) != -1) {
                outputStream.write(buffer, 0, length);
            }

            String name = getDisplayName(uri);
            String mimeType = getContext().getContentResolver().getType(uri);

            JSObject resultObject = new JSObject();
            resultObject.put("name", name);
            resultObject.put("mimeType", mimeType != null ? mimeType : "application/octet-stream");
            resultObject.put("data", Base64.encodeToString(outputStream.toByteArray(), Base64.NO_WRAP));
            call.resolve(resultObject);
        } catch (Exception exception) {
            call.reject("Failed to read selected archive.", exception);
        }
    }

    @PluginMethod
    public void notifySyncStatus(PluginCall call) {
        String title = call.getString("title", "Sync status");
        String body = call.getString("body", "");
        boolean ongoing = call.getBoolean("ongoing", false);

        NotificationManager notificationManager = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
        if (notificationManager == null) {
            call.reject("Notification manager unavailable.");
            return;
        }

        ensureNotificationChannel(notificationManager);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(getContext(), CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setOngoing(ongoing)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW);

        notificationManager.notify(NOTIFICATION_ID, builder.build());
        call.resolve();
    }

    @PluginMethod
    public void clearSyncStatus(PluginCall call) {
        NotificationManager notificationManager = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
        if (notificationManager != null) {
            notificationManager.cancel(NOTIFICATION_ID);
        }
        call.resolve();
    }

    @PluginMethod
    public void startBackgroundSyncMonitor(PluginCall call) {
        Intent intent = new Intent(getContext(), SyncStatusService.class);
        ContextCompat.startForegroundService(getContext(), intent);
        call.resolve();
    }

    @PluginMethod
    public void stopBackgroundSyncMonitor(PluginCall call) {
        Intent intent = new Intent(getContext(), SyncStatusService.class);
        getContext().stopService(intent);
        call.resolve();
    }

    private SharedPreferences getSecurePreferences() throws Exception {
        MasterKey masterKey = new MasterKey.Builder(getContext())
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build();

        return EncryptedSharedPreferences.create(
            getContext(),
            SECURE_PREFS_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        );
    }

    private void ensureNotificationChannel(NotificationManager notificationManager) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }

        NotificationChannel channel = notificationManager.getNotificationChannel(CHANNEL_ID);
        if (channel != null) {
            return;
        }

        NotificationChannel newChannel = new NotificationChannel(
            CHANNEL_ID,
            "Sync Status",
            NotificationManager.IMPORTANCE_LOW
        );
        newChannel.setDescription("Shows ongoing sync progress for X to Bluesky.");
        notificationManager.createNotificationChannel(newChannel);
    }

    private String getDisplayName(Uri uri) {
        try (Cursor cursor = getContext().getContentResolver().query(
            uri,
            new String[] { OpenableColumns.DISPLAY_NAME },
            null,
            null,
            null
        )) {
            if (cursor != null && cursor.moveToFirst()) {
                int nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (nameIndex >= 0) {
                    String displayName = cursor.getString(nameIndex);
                    if (displayName != null && !displayName.isBlank()) {
                        return displayName;
                    }
                }
            }
        } catch (Exception ignored) {
        }

        return "archive";
    }
}
