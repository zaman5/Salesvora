package online.salesvora.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import androidx.core.app.NotificationCompat;

/**
 * Notification channels and the incoming-call notification.
 *
 * An incoming call is a high-priority CATEGORY_CALL notification with a
 * full-screen intent: on a locked or idle phone Android opens
 * IncomingCallActivity straight over the lock screen; on a phone in use it
 * shows as a heads-up with Answer / Decline buttons. Either way it rings with
 * the system ringtone and disappears after 30 seconds, which is about when
 * SignalWire stops ringing and moves on to the agent's cell or voicemail.
 */
public final class CallNotifications {
    public static final String CHANNEL_CALLS = "incoming_calls";
    public static final String CHANNEL_SMS = "sms";
    public static final String CHANNEL_MISSED = "calls";
    public static final int CALL_NOTIFICATION_ID = 4242;
    public static final long RING_TIMEOUT_MS = 30_000;

    public static final String ACTION_ANSWER = "online.salesvora.app.ANSWER_CALL";
    public static final String ACTION_DECLINE = "online.salesvora.app.DECLINE_CALL";
    public static final String EXTRA_CALL_ID = "callId";
    public static final String EXTRA_FROM = "from";
    public static final String EXTRA_TITLE = "title";

    private CallNotifications() {}

    public static void ensureChannels(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null) return;

        Uri ringtone = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
        NotificationChannel calls = new NotificationChannel(CHANNEL_CALLS, "Incoming calls", NotificationManager.IMPORTANCE_HIGH);
        calls.setDescription("Rings when someone calls your Salesvora number");
        calls.setSound(ringtone, new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build());
        calls.enableVibration(true);
        calls.setVibrationPattern(new long[] { 0, 1000, 800, 1000, 800, 1000 });
        calls.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        calls.setBypassDnd(true);
        nm.createNotificationChannel(calls);

        NotificationChannel sms = new NotificationChannel(CHANNEL_SMS, "Text messages", NotificationManager.IMPORTANCE_HIGH);
        sms.setDescription("New SMS to your Salesvora numbers");
        nm.createNotificationChannel(sms);

        NotificationChannel missed = new NotificationChannel(CHANNEL_MISSED, "Missed calls & voicemail", NotificationManager.IMPORTANCE_DEFAULT);
        nm.createNotificationChannel(missed);
    }

    public static void showIncomingCall(Context ctx, String callId, String from, String title) {
        ensureChannels(ctx);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;

        Intent screen = new Intent(ctx, IncomingCallActivity.class)
            .putExtra(EXTRA_CALL_ID, callId)
            .putExtra(EXTRA_FROM, from)
            .putExtra(EXTRA_TITLE, title)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_USER_ACTION);
        PendingIntent fullScreen = PendingIntent.getActivity(ctx, 1, screen, flags);

        Intent answer = new Intent(ctx, MainActivity.class)
            .setAction(ACTION_ANSWER)
            .putExtra(EXTRA_CALL_ID, callId)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent answerPi = PendingIntent.getActivity(ctx, 2, answer, flags);

        Intent decline = new Intent(ctx, CallActionReceiver.class).setAction(ACTION_DECLINE);
        PendingIntent declinePi = PendingIntent.getBroadcast(ctx, 3, decline, flags);

        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL_CALLS)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title == null || title.isEmpty() ? "Incoming call" : title)
            .setContentText(from == null || from.isEmpty() ? "Salesvora" : from)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(true)
            .setTimeoutAfter(RING_TIMEOUT_MS)
            .setFullScreenIntent(fullScreen, true)
            .setContentIntent(fullScreen)
            .addAction(0, "Decline", declinePi)
            .addAction(0, "Answer", answerPi);
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            b.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE));
        }

        Notification n = b.build();
        n.flags |= Notification.FLAG_INSISTENT; // keep ringing until answered, declined or timed out
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm != null) nm.notify(CALL_NOTIFICATION_ID, n);
    }

    public static void cancelIncomingCall(Context ctx) {
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm != null) nm.cancel(CALL_NOTIFICATION_ID);
    }
}
