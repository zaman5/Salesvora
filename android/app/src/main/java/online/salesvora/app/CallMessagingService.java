package online.salesvora.app;

import androidx.annotation.NonNull;
import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

/**
 * Replaces the push plugin's own service (see AndroidManifest.xml) so that a
 * "call" push — data-only, high priority, sent by the server when someone dials
 * an agent whose app is closed — opens the native ringing screen even when the
 * app is not running. Every other message still goes to the plugin, which
 * hands it to the web app or lets Android show it as a normal notification.
 */
public class CallMessagingService extends MessagingService {

    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        Map<String, String> data = message.getData();
        if ("call".equals(data.get("kind")) && !MainActivity.isInForeground()) {
            // App open = the in-app WebRTC dialer is already ringing; don't double-ring.
            CallNotifications.showIncomingCall(this, data.get("callId"), data.get("from"), data.get("body"));
            return;
        }
        super.onMessageReceived(message);
    }
}
