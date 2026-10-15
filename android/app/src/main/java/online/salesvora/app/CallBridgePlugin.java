package online.salesvora.app;

import android.content.Context;
import android.content.SharedPreferences;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Tells the web app that the agent tapped "Answer" on the native ringing
 * screen. The web dialer may not be loaded yet at that moment (the app was
 * closed), so the request is stored with a timestamp; the web app reads it via
 * consumePendingAnswer() as soon as it starts and auto-answers the WebRTC call
 * that SignalWire rings it with. Live apps also get an "answerRequested" event.
 */
@CapacitorPlugin(name = "CallBridge")
public class CallBridgePlugin extends Plugin {
    private static final String PREFS = "salesvora_call_bridge";
    private static final long PENDING_TTL_MS = 60_000;
    private static CallBridgePlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    public static void setPendingAnswer(Context ctx, String callId) {
        prefs(ctx).edit()
            .putString("callId", callId == null ? "" : callId)
            .putLong("at", System.currentTimeMillis())
            .apply();
        if (instance != null) {
            JSObject data = new JSObject();
            data.put("callId", callId == null ? "" : callId);
            instance.notifyListeners("answerRequested", data, true);
        }
    }

    public static void clearPendingAnswer(Context ctx) {
        prefs(ctx).edit().clear().apply();
    }

    @PluginMethod
    public void consumePendingAnswer(PluginCall call) {
        SharedPreferences p = prefs(getContext());
        long at = p.getLong("at", 0);
        boolean pending = at > 0 && System.currentTimeMillis() - at < PENDING_TTL_MS;
        JSObject res = new JSObject();
        res.put("pending", pending);
        res.put("callId", pending ? p.getString("callId", "") : "");
        clearPendingAnswer(getContext());
        call.resolve(res);
    }

    @PluginMethod
    public void endCallUi(PluginCall call) {
        CallNotifications.cancelIncomingCall(getContext());
        if (getActivity() instanceof MainActivity) ((MainActivity) getActivity()).setCallMode(false);
        call.resolve();
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
