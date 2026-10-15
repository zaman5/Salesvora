package online.salesvora.app;

import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static volatile boolean inForeground = false;

    /** True while Salesvora is on screen — the in-app WebRTC dialer then rings by itself. */
    public static boolean isInForeground() {
        return inForeground;
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CallBridgePlugin.class);
        super.onCreate(savedInstanceState);
        CallNotifications.ensureChannels(this);
        handleCallIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleCallIntent(intent);
    }

    @Override
    public void onResume() {
        super.onResume();
        inForeground = true;
    }

    @Override
    public void onPause() {
        inForeground = false;
        super.onPause();
    }

    private void handleCallIntent(Intent intent) {
        if (intent == null || !CallNotifications.ACTION_ANSWER.equals(intent.getAction())) return;
        CallNotifications.cancelIncomingCall(this);
        CallBridgePlugin.setPendingAnswer(this, intent.getStringExtra(CallNotifications.EXTRA_CALL_ID));
        setCallMode(true);
        // Consume the action so a later rotation/recreate doesn't answer again.
        intent.setAction(Intent.ACTION_MAIN);
    }

    /** During a call answered from the lock screen, stay visible over it and keep the screen on. */
    public void setCallMode(boolean on) {
        runOnUiThread(() -> {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
                setShowWhenLocked(on);
                setTurnScreenOn(on);
            }
            if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        });
    }
}
