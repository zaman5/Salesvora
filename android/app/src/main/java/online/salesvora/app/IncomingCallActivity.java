package online.salesvora.app;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * Full-screen ringing screen shown over the lock screen (via the call
 * notification's full-screen intent). Built in code so it has no layout/theme
 * dependencies. Answer opens Salesvora, which connects the call in the WebRTC
 * dialer; Decline just stops ringing on this phone.
 */
public class IncomingCallActivity extends Activity {
    private final Handler handler = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        showOverLockScreen();

        String callId = getIntent().getStringExtra(CallNotifications.EXTRA_CALL_ID);
        String from = getIntent().getStringExtra(CallNotifications.EXTRA_FROM);
        String title = getIntent().getStringExtra(CallNotifications.EXTRA_TITLE);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER_HORIZONTAL);
        root.setBackgroundColor(Color.parseColor("#0B1220"));
        root.setPadding(dp(24), dp(96), dp(24), dp(64));

        TextView label = text("Incoming call · Salesvora", 15, "#93A3B8", false);
        TextView name = text(title == null || title.isEmpty() ? "Unknown caller" : title, 30, "#FFFFFF", true);
        name.setPadding(0, dp(16), 0, dp(6));
        TextView number = text(from == null ? "" : from, 17, "#CBD5E1", false);
        root.addView(label);
        root.addView(name);
        root.addView(number);

        LinearLayout spacer = new LinearLayout(this);
        root.addView(spacer, new LinearLayout.LayoutParams(1, 0, 1f));

        LinearLayout buttons = new LinearLayout(this);
        buttons.setOrientation(LinearLayout.HORIZONTAL);
        buttons.setGravity(Gravity.CENTER);
        Button decline = roundButton("Decline", "#DC2626");
        Button answer = roundButton("Answer", "#16A34A");
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(dp(96), dp(96));
        lp.setMargins(dp(28), 0, dp(28), 0);
        buttons.addView(decline, lp);
        buttons.addView(answer, lp);
        root.addView(buttons);

        decline.setOnClickListener(v -> {
            CallNotifications.cancelIncomingCall(this);
            CallBridgePlugin.clearPendingAnswer(this);
            finishAndRemoveTask();
        });
        answer.setOnClickListener(v -> {
            CallNotifications.cancelIncomingCall(this);
            startActivity(new Intent(this, MainActivity.class)
                .setAction(CallNotifications.ACTION_ANSWER)
                .putExtra(CallNotifications.EXTRA_CALL_ID, callId)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP));
            finish();
        });

        setContentView(root);
        // Same lifetime as the ringing notification.
        handler.postDelayed(this::finishAndRemoveTask, CallNotifications.RING_TIMEOUT_MS);
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }

    private void showOverLockScreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
            KeyguardManager km = getSystemService(KeyguardManager.class);
            if (km != null) km.requestDismissKeyguard(this, null);
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    private TextView text(String value, int sp, String color, boolean bold) {
        TextView t = new TextView(this);
        t.setText(value);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(Color.parseColor(color));
        t.setGravity(Gravity.CENTER);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    private Button roundButton(String label, String color) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextColor(Color.WHITE);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        GradientDrawable bg = new GradientDrawable();
        bg.setShape(GradientDrawable.OVAL);
        bg.setColor(Color.parseColor(color));
        b.setBackground(bg);
        return b;
    }

    private int dp(int v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }
}
