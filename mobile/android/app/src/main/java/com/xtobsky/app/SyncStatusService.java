package com.xtobsky.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

public class SyncStatusService extends Service {
    private static final String PREFS_NAME = "x_to_bsky_mobile";
    private static final String KEY_API_BASE_URL = "api_base_url";
    private static final String CHANNEL_ID = "sync_status";
    private static final int NOTIFICATION_ID = 7010;

    private final AtomicBoolean running = new AtomicBoolean(false);
    private ExecutorService executorService;

    @Override
    public void onCreate() {
        super.onCreate();
        ensureNotificationChannel();
        executorService = Executors.newSingleThreadExecutor();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        startForeground(NOTIFICATION_ID, buildNotification("同步监控已启动", "正在等待后端同步状态..."));
        if (running.compareAndSet(false, true)) {
            executorService.submit(this::pollLoop);
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running.set(false);
        if (executorService != null) {
            executorService.shutdownNow();
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void pollLoop() {
        while (running.get()) {
            try {
                String apiBaseUrl = readApiBaseUrl();
                if (apiBaseUrl.isEmpty()) {
                  stopSelf();
                  return;
                }

                JSONObject payload = fetchStats(apiBaseUrl + "/api/stats");
                JSONObject engine = payload.getJSONObject("engine");
                JSONObject stats = payload.getJSONObject("stats");

                boolean syncRunning = engine.optBoolean("running", false);
                boolean paused = engine.optBoolean("paused", false);
                String currentTweetId = engine.optString("currentTweetId", "");
                int pending = stats.optInt("pending", 0);

                String title = syncRunning ? (paused ? "同步已暂停" : "同步进行中") : "同步已结束";
                String body = !currentTweetId.isEmpty() ? "当前推文 " + currentTweetId : "待处理 " + pending + " 条";
                updateNotification(title, body, syncRunning && !paused);

                if (!syncRunning) {
                    stopSelf();
                    return;
                }

                Thread.sleep(10000);
            } catch (Exception exception) {
                updateNotification("同步状态更新失败", exception.getMessage() != null ? exception.getMessage() : "请返回应用检查连接。", false);
                try {
                    Thread.sleep(15000);
                } catch (InterruptedException interruptedException) {
                    Thread.currentThread().interrupt();
                    return;
                }
            }
        }
    }

    private String readApiBaseUrl() {
        SharedPreferences preferences = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String raw = preferences.getString(KEY_API_BASE_URL, "");
        return raw == null ? "" : raw.replaceAll("/$", "");
    }

    private JSONObject fetchStats(String url) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setRequestMethod("GET");
        connection.setConnectTimeout(5000);
        connection.setReadTimeout(5000);

        try (BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
            StringBuilder builder = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                builder.append(line);
            }
            return new JSONObject(builder.toString());
        } finally {
            connection.disconnect();
        }
    }

    private Notification buildNotification(String title, String body) {
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
    }

    private void updateNotification(String title, String body, boolean ongoing) {
        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setOnlyAlertOnce(true)
            .setOngoing(ongoing)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();

        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.notify(NOTIFICATION_ID, notification);
        }
    }

    private void ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }

        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) {
            return;
        }

        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Sync Status",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Shows ongoing sync progress for X to Bluesky.");
        manager.createNotificationChannel(channel);
    }
}
