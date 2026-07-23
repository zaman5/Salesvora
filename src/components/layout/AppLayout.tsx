import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  LayoutDashboard,
  Users,
  Phone,
  List,
  BarChart3,
  Headphones,
  Bot,
  MessageSquare,
  Settings,
  LogOut,
  Menu,
  X,
  Radio,
  PhoneCall,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Mail,
  Sun,
  Moon,
  type LucideIcon,
} from "lucide-react";

type NavLeaf = { icon: LucideIcon; label: string; path: string };
type NavGroup = { icon: LucideIcon; label: string; children: NavLeaf[] };
type NavEntry = NavLeaf | NavGroup;

function isGroup(item: NavEntry): item is NavGroup {
  return "children" in item;
}

// "Caller" and "Mail Sender" bundle several pages behind one button with a
// dropdown, so the sidebar stays short while every page is still one click away.
const adminNavItems: NavEntry[] = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/" },
  { icon: Users, label: "Users", path: "/users" },
  {
    icon: PhoneCall, label: "Caller", children: [
      { icon: List, label: "Leads", path: "/leads" },
      { icon: PhoneCall, label: "Dialer", path: "/dialer" },
      { icon: Radio, label: "Auto Dialer", path: "/auto-dialer" },
      { icon: Headphones, label: "Monitoring", path: "/monitoring" },
      { icon: Phone, label: "Campaigns", path: "/campaigns" },
      { icon: MessageSquare, label: "SMS", path: "/sms" },
      { icon: BarChart3, label: "Call Logs", path: "/call-logs" },
    ],
  },
  { icon: Bot, label: "AI Agents", path: "/ai-agents" },
  {
    icon: Mail, label: "Mail Sender", children: [
      { icon: LayoutDashboard, label: "Dashboard", path: "/mailsender?tab=dashboard" },
      { icon: Phone, label: "Campaigns", path: "/mailsender?tab=campaigns" },
      { icon: Users, label: "Prospects", path: "/mailsender?tab=prospects" },
      { icon: MessageSquare, label: "Unified Inbox", path: "/mailsender?tab=inbox" },
      { icon: Mail, label: "Email Accounts", path: "/mailsender?tab=accounts" },
      { icon: Radio, label: "Email Warmup", path: "/mailsender?tab=warmup" },
    ],
  },
  { icon: BarChart3, label: "Reports", path: "/reports" },
  { icon: Settings, label: "Settings", path: "/settings" },
];

const callerNavItems: NavEntry[] = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/" },
  {
    icon: PhoneCall, label: "Caller", children: [
      { icon: List, label: "My Leads", path: "/leads" },
      { icon: PhoneCall, label: "Dialer", path: "/dialer" },
      { icon: Radio, label: "Auto Dialer", path: "/auto-dialer" },
      { icon: Phone, label: "Campaigns", path: "/campaigns" },
      { icon: MessageSquare, label: "SMS", path: "/sms" },
      { icon: BarChart3, label: "My Calls", path: "/call-logs" },
    ],
  },
];

// Most leaf paths have no query string, so match on pathname alone. Mail
// Sender's children all share the /mailsender pathname and are told apart by
// ?tab= instead — compare that, defaulting to "dashboard" (its own default)
// when the URL has no tab param at all, e.g. a bare /mailsender link.
function pathMatches(itemPath: string, pathname: string, search: string): boolean {
  const [itemPathname, itemQuery] = itemPath.split("?");
  if (pathname !== itemPathname) return false;
  if (!itemQuery) return true;
  const itemTab = new URLSearchParams(itemQuery).get("tab");
  const currentTab = new URLSearchParams(search).get("tab") || "dashboard";
  return itemTab === currentTab;
}

function findActiveLabel(items: NavEntry[], pathname: string, search: string): string | undefined {
  for (const item of items) {
    if (isGroup(item)) {
      const child = item.children.find((c) => pathMatches(c.path, pathname, search));
      if (child) return child.label;
    } else if (pathMatches(item.path, pathname, search)) {
      return item.label;
    }
  }
  return undefined;
}

function groupHasActiveChild(item: NavGroup, pathname: string, search: string): boolean {
  return item.children.some((c) => pathMatches(c.path, pathname, search));
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isLoading } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const logout = trpc.auth.logout.useMutation({
    onSuccess: () => {
      window.location.reload();
    },
  });

  // App-wide new-message popup: poll a small unread summary (not the whole
  // inbox) from every page — there's no push channel from the server.
  const { data: unreadSummary } = trpc.sms.unreadSummary.useQuery(undefined, {
    enabled: !!user,
    refetchInterval: 5000,
  });
  const lastSeenIdRef = useRef<number | null>(null);
  const sawFirstLoadRef = useRef(false);
  useEffect(() => {
    if (!unreadSummary) return;
    const latestId = unreadSummary.latest?.id ?? null;
    // Don't toast for messages that were already unread before this tab opened.
    if (!sawFirstLoadRef.current) {
      sawFirstLoadRef.current = true;
      lastSeenIdRef.current = latestId;
      return;
    }
    if (latestId !== null && latestId !== lastSeenIdRef.current) {
      lastSeenIdRef.current = latestId;
      const msg = unreadSummary.latest!.message || "";
      toast(`New message from ${unreadSummary.latest!.fromNumber}`, {
        description: msg.length > 80 ? `${msg.slice(0, 80)}…` : msg,
        action: { label: "Open", onClick: () => navigate("/sms") },
      });
    }
  }, [unreadSummary, navigate]);

  // Mail Sender's Unified Inbox has its own unread mail, separate from
  // Salesvora's SMS system — poll it the same way so the sidebar badge and a
  // toast notification work even while browsing pages outside Mail Sender.
  const isAdminUser = user?.role === "admin" || user?.role === "superadmin";
  const [mailUnreadCount, setMailUnreadCount] = useState(0);
  const mailKnownIdsRef = useRef<Set<string> | null>(null);
  const pathnameRef = useRef(location.pathname);
  useEffect(() => {
    pathnameRef.current = location.pathname;
  }, [location.pathname]);
  useEffect(() => {
    if (!isAdminUser) return;
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch("/api/mail/inbox?folder=inbox", { credentials: "include" });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled || !Array.isArray(data?.emails)) return;
        const rawEmails: Array<{
          id: string; uid: number; accountId: number; unread: boolean;
          name?: string; email?: string; subject?: string;
        }> = data.emails;
        const accounts: Array<{ email: string }> = Array.isArray(data.accounts) ? data.accounts : [];
        const ownEmails = new Set(accounts.map((a) => a.email.toLowerCase()));

        // Match Inbox.jsx's own unread count exactly: drop duplicate
        // accountId+uid rows, and exclude mail sent from one of the user's
        // own connected accounts (warmup traffic between them isn't "new
        // mail to review").
        const seen = new Set<string>();
        const emails = rawEmails.filter((e) => {
          const key = `${e.accountId}-${e.uid}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        const unread = emails.filter((e) => e.unread && !ownEmails.has((e.email || "").toLowerCase()));
        setMailUnreadCount(unread.length);

        if (mailKnownIdsRef.current === null) {
          mailKnownIdsRef.current = new Set(emails.map((e) => e.id));
          return;
        }
        const known = mailKnownIdsRef.current;
        const fresh = unread.filter((e) => !known.has(e.id));
        if (fresh.length > 0) {
          emails.forEach((e) => known.add(e.id));
          if (!pathnameRef.current.startsWith("/mailsender")) {
            const first = fresh[0];
            toast(fresh.length > 1 ? `${fresh.length} new emails in Mail Sender` : "New email in Mail Sender", {
              description: first.subject || first.name || first.email || undefined,
              action: { label: "Open", onClick: () => navigate("/mailsender?tab=inbox") },
            });
          }
        }
      } catch {
        // ignore network errors — badge just stays at its last known value
      }
    }
    poll();
    const timer = setInterval(poll, 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isAdminUser, navigate]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50 dark:bg-gray-950">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    );
  }

  if (!user) {
    navigate("/login");
    return null;
  }

  const isAdmin = user.role === "admin" || user.role === "superadmin";
  const isSuperAdmin = user.role === "superadmin";
  // Settings (Telnyx/SIP connection + number assignment) is superadmin-only.
  const navItems = isAdmin
    ? adminNavItems.filter((item) => !("path" in item) || item.path !== "/settings" || isSuperAdmin)
    : callerNavItems;

  function toggleGroup(label: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  return (
    <div className="flex h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100 overflow-hidden">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 bg-white border-r border-gray-200 dark:bg-gray-900 dark:border-gray-800 transition-all duration-300 flex flex-col ${
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        } ${sidebarOpen ? "w-64" : "w-20"}`}
      >
        {/* Logo */}
        <div className="flex items-center justify-between h-16 px-4 border-b border-gray-200 dark:border-gray-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center flex-shrink-0">
              <Phone className="w-5 h-5 text-white" />
            </div>
            {sidebarOpen && (
              <div>
                <h1 className="text-lg font-bold text-gray-900 dark:text-white leading-tight">Salesvora</h1>
              </div>
            )}
          </div>
          <button
            onClick={() => setMobileOpen(false)}
            aria-label="Close sidebar"
            className="lg:hidden text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation — scrolls when needed but scrollbar is hidden */}
        <nav className="flex-1 overflow-y-auto scrollbar-none py-4 px-3 space-y-1">
          {navItems.map((item) => {
            const unreadBadge = (path: string) => {
              if (path === "/sms") return unreadSummary?.unreadCount || 0;
              if (path === "/mailsender?tab=inbox") return mailUnreadCount;
              return 0;
            };

            if (isGroup(item)) {
              const hasActiveChild = groupHasActiveChild(item, location.pathname, location.search);
              const expanded = expandedGroups.has(item.label) || hasActiveChild;
              const groupBadge = item.children.reduce((sum, c) => sum + unreadBadge(c.path), 0);
              return (
                <div key={item.label}>
                  <button
                    type="button"
                    onClick={() => toggleGroup(item.label)}
                    className={`relative w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                      hasActiveChild
                        ? "bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-600/20 dark:text-blue-400 dark:border-blue-600/30"
                        : "text-gray-600 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-white dark:hover:bg-gray-800"
                    } ${!sidebarOpen && "justify-center"}`}
                  >
                    <span className="relative flex-shrink-0">
                      <item.icon className="w-5 h-5" />
                      {!sidebarOpen && groupBadge > 0 && (
                        <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-green-500 text-[10px] font-semibold text-white flex items-center justify-center">
                          {groupBadge > 9 ? "9+" : groupBadge}
                        </span>
                      )}
                    </span>
                    {sidebarOpen && <span className="flex-1 text-left">{item.label}</span>}
                    {sidebarOpen && groupBadge > 0 && (
                      <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-green-500 text-[10px] font-semibold text-white flex items-center justify-center">
                        {groupBadge > 99 ? "99+" : groupBadge}
                      </span>
                    )}
                    {sidebarOpen && (
                      <ChevronDown className={`w-4 h-4 flex-shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} />
                    )}
                  </button>

                  {expanded && (
                    <div className={`mt-1 space-y-1 ${sidebarOpen ? "pl-6" : "pl-0"}`}>
                      {item.children.map((child) => {
                        const isActive = pathMatches(child.path, location.pathname, location.search);
                        const badge = unreadBadge(child.path);
                        return (
                          <Link
                            key={child.path}
                            to={child.path}
                            onClick={() => setMobileOpen(false)}
                            className={`relative flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                              isActive
                                ? "bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-600/20 dark:text-blue-400 dark:border-blue-600/30"
                                : "text-gray-600 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-white dark:hover:bg-gray-800"
                            } ${!sidebarOpen && "justify-center"}`}
                          >
                            <child.icon className="w-4 h-4 flex-shrink-0" />
                            {sidebarOpen && <span>{child.label}</span>}
                            {sidebarOpen && badge > 0 && (
                              <span className="ml-auto min-w-[20px] h-5 px-1.5 rounded-full bg-green-500 text-[10px] font-semibold text-white flex items-center justify-center">
                                {badge > 99 ? "99+" : badge}
                              </span>
                            )}
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            }

            const isActive = pathMatches(item.path, location.pathname, location.search);
            const badge = unreadBadge(item.path);
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setMobileOpen(false)}
                className={`relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-600/20 dark:text-blue-400 dark:border-blue-600/30"
                    : "text-gray-600 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-white dark:hover:bg-gray-800"
                } ${!sidebarOpen && "justify-center"}`}
              >
                <span className="relative flex-shrink-0">
                  <item.icon className="w-5 h-5" />
                  {!sidebarOpen && badge > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-green-500 text-[10px] font-semibold text-white flex items-center justify-center">
                      {badge > 9 ? "9+" : badge}
                    </span>
                  )}
                </span>
                {sidebarOpen && <span>{item.label}</span>}
                {sidebarOpen && badge > 0 && (
                  <span className="ml-auto min-w-[20px] h-5 px-1.5 rounded-full bg-green-500 text-[10px] font-semibold text-white flex items-center justify-center">
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* User section */}
        <div className="border-t border-gray-200 dark:border-gray-800 p-3">
          <div className={`flex items-center gap-3 px-3 py-2 mb-2 ${!sidebarOpen && "justify-center"}`}>
            <div className="w-9 h-9 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center flex-shrink-0">
              <Users className="w-4 h-4 text-gray-600 dark:text-gray-300" />
            </div>
            {sidebarOpen && (
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{user.name || "User"}</p>
                <p className="text-xs text-gray-500 capitalize">{user.role}</p>
              </div>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => logout.mutate()}
            className={`w-full text-gray-600 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-white dark:hover:bg-gray-800 ${!sidebarOpen && "px-2"}`}
          >
            <LogOut className="w-4 h-4 mr-2" />
            {sidebarOpen && "Logout"}
          </Button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="h-16 bg-white border-b border-gray-200 dark:bg-gray-900 dark:border-gray-800 flex items-center justify-between px-4 lg:px-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
            >
              <Menu className="w-5 h-5" />
            </button>
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
              className="hidden lg:flex text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
            >
              {sidebarOpen ? <ChevronLeft className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
            </button>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              {findActiveLabel(navItems, location.pathname, location.search) || "Salesvora"}
            </h2>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={toggleTheme}
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              className="flex items-center justify-center w-8 h-8 rounded-full text-gray-500 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-300 dark:hover:text-white dark:hover:bg-gray-800 transition-colors"
            >
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-gray-100 dark:bg-gray-800 rounded-full">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-xs text-gray-600 dark:text-gray-300">Online</span>
            </div>
          </div>
        </header>

        {/* Page content — Mail Sender renders its own full-bleed shell (sidebar,
            header, scroll areas), so it skips the default padding/scroll wrapper. */}
        <main className={location.pathname === "/mailsender" ? "flex-1 overflow-hidden" : "flex-1 overflow-auto p-4 lg:p-6"}>
          {children}
        </main>
      </div>
    </div>
  );
}
