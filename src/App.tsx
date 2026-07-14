import { Routes, Route } from "react-router";
import { AppLayout } from "@/shared/components/layout";
import { WebRTCProvider } from "@/providers/WebRTCProvider";

// ── Feature pages ────────────────────────────────────────────────────────────
import { LoginPage } from "@/features/auth";
import { AuthGuard, AdminGuard } from "@/features/auth";
import { DashboardPage } from "@/features/dashboard";
import { UsersPage } from "@/features/users";
import { LeadsPage } from "@/features/leads";
import { CampaignsPage } from "@/features/campaigns";
import { DialerPage, AutoDialerPage } from "@/features/dialer";
import { MonitoringPage } from "@/features/monitoring";
import { ReportsPage } from "@/features/reports";
import { AIAgentsPage } from "@/features/ai-agents";
import { SMSCampaignsPage } from "@/features/sms";
import { CallLogsPage } from "@/features/call-logs";
import { SettingsPage } from "@/features/settings";
import NotFound from "./pages/NotFound";

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <AppLayout>{children}</AppLayout>
    </AuthGuard>
  );
}

function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminGuard>
      <AppLayout>{children}</AppLayout>
    </AdminGuard>
  );
}

export default function App() {
  return (
    <WebRTCProvider>
      <Routes>
        {/* Public */}
        <Route path="/login" element={<LoginPage />} />

        {/* Protected — all authenticated users */}
        <Route path="/"          element={<Layout><DashboardPage /></Layout>} />
        <Route path="/leads"     element={<Layout><LeadsPage /></Layout>} />
        <Route path="/campaigns" element={<Layout><CampaignsPage /></Layout>} />
        <Route path="/dialer"    element={<Layout><DialerPage /></Layout>} />
        <Route path="/call-logs" element={<Layout><CallLogsPage /></Layout>} />
        <Route path="/settings"  element={<Layout><SettingsPage /></Layout>} />

        <Route path="/auto-dialer" element={<Layout><AutoDialerPage /></Layout>} />
        {/* Callers can send/receive SMS and see their own campaigns too — the
            page itself already scopes campaign editing to admins. */}
        <Route path="/sms"        element={<Layout><SMSCampaignsPage /></Layout>} />

        {/* Protected — admin / superadmin only */}
        <Route path="/users"       element={<AdminLayout><UsersPage /></AdminLayout>} />
        <Route path="/monitoring"  element={<AdminLayout><MonitoringPage /></AdminLayout>} />
        <Route path="/reports"     element={<AdminLayout><ReportsPage /></AdminLayout>} />
        <Route path="/ai-agents"   element={<AdminLayout><AIAgentsPage /></AdminLayout>} />

        <Route path="*" element={<NotFound />} />
      </Routes>
    </WebRTCProvider>
  );
}