import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
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
} from "lucide-react";

const adminNavItems = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/" },
  { icon: Users, label: "Users", path: "/users" },
  { icon: List, label: "Leads", path: "/leads" },
  { icon: Phone, label: "Campaigns", path: "/campaigns" },
  { icon: PhoneCall, label: "Dialer", path: "/dialer" },
  { icon: Radio, label: "Auto Dialer", path: "/auto-dialer" },
  { icon: Headphones, label: "Monitoring", path: "/monitoring" },
  { icon: Bot, label: "AI Agents", path: "/ai-agents" },
  { icon: MessageSquare, label: "SMS", path: "/sms" },
  { icon: BarChart3, label: "Reports", path: "/reports" },
  { icon: Settings, label: "Settings", path: "/settings" },
];

const callerNavItems = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/" },
  { icon: PhoneCall, label: "Dialer", path: "/dialer" },
  { icon: Radio, label: "Auto Dialer", path: "/auto-dialer" },
  { icon: List, label: "My Leads", path: "/leads" },
  { icon: Phone, label: "Campaigns", path: "/campaigns" },
  { icon: BarChart3, label: "My Calls", path: "/call-logs" },
  { icon: Settings, label: "Settings", path: "/settings" },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isLoading } = useAuth();
  const logout = trpc.auth.logout.useMutation({
    onSuccess: () => {
      window.location.reload();
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-950">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    );
  }

  if (!user) {
    navigate("/login");
    return null;
  }

  const isAdmin = user.role === "admin" || user.role === "superadmin";
  const navItems = isAdmin ? adminNavItems : callerNavItems;

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100 overflow-hidden">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 bg-gray-900 border-r border-gray-800 transition-all duration-300 flex flex-col ${
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        } ${sidebarOpen ? "w-64" : "w-20"}`}
      >
        {/* Logo */}
        <div className="flex items-center justify-between h-16 px-4 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center flex-shrink-0">
              <Phone className="w-5 h-5 text-white" />
            </div>
            {sidebarOpen && (
              <div>
                <h1 className="text-lg font-bold text-white leading-tight">Salesvora</h1>
              </div>
            )}
          </div>
          <button
            onClick={() => setMobileOpen(false)}
            className="lg:hidden text-gray-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation — scrolls when needed but scrollbar is hidden */}
        <nav className="flex-1 overflow-y-auto scrollbar-none py-4 px-3 space-y-1">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-blue-600/20 text-blue-400 border border-blue-600/30"
                    : "text-gray-400 hover:text-white hover:bg-gray-800"
                } ${!sidebarOpen && "justify-center"}`}
              >
                <item.icon className="w-5 h-5 flex-shrink-0" />
                {sidebarOpen && <span>{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* User section */}
        <div className="border-t border-gray-800 p-3">
          <div className={`flex items-center gap-3 px-3 py-2 mb-2 ${!sidebarOpen && "justify-center"}`}>
            <div className="w-9 h-9 rounded-full bg-gray-700 flex items-center justify-center flex-shrink-0">
              <Users className="w-4 h-4" />
            </div>
            {sidebarOpen && (
              <div className="min-w-0">
                <p className="text-sm font-medium text-white truncate">{user.name || "User"}</p>
                <p className="text-xs text-gray-500 capitalize">{user.role}</p>
              </div>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => logout.mutate()}
            className={`w-full text-gray-400 hover:text-white hover:bg-gray-800 ${!sidebarOpen && "px-2"}`}
          >
            <LogOut className="w-4 h-4 mr-2" />
            {sidebarOpen && "Logout"}
          </Button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="h-16 bg-gray-900 border-b border-gray-800 flex items-center justify-between px-4 lg:px-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileOpen(true)}
              className="lg:hidden text-gray-400 hover:text-white"
            >
              <Menu className="w-5 h-5" />
            </button>
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="hidden lg:flex text-gray-400 hover:text-white"
            >
              {sidebarOpen ? <ChevronLeft className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
            </button>
            <h2 className="text-lg font-semibold text-white">
              {navItems.find((item) => item.path === location.pathname)?.label || "Salesvora"}
            </h2>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-gray-800 rounded-full">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-xs text-gray-300">Online</span>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
