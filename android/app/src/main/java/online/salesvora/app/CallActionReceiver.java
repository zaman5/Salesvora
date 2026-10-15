package online.salesvora.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * "Decline" on the incoming-call notification. Stops ringing on this phone;
 * the caller keeps hearing ringback until SignalWire's timeout, then goes to
 * the agent's cell (if set) or voicemail, exactly like an unanswered call.
 */
public class CallActionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (CallNotifications.ACTION_DECLINE.equals(intent.getAction())) {
            CallNotifications.cancelIncomingCall(context);
            CallBridgePlugin.clearPendingAnswer(context);
        }
    }
}
