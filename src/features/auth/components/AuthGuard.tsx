import { Navigate } from "react-router";
import { useAuth } from "@/shared/hooks/useAuth";

function Spinner() {
  return (
    <div className="flex items-center justify-center h-screen bg-gray-950">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
    </div>
  );
}

/** Redirects unauthenticated users to /login. */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/** Redirects non-admin users to /. */
export function AdminGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  const isAdmin = user.role === "admin" || user.role === "superadmin";
  if (!isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}