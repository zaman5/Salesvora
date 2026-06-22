import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { trpc } from "@/providers/trpc";
import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { KeyRound, Mail, AlertCircle } from "lucide-react";

function getOAuthUrl() {
  const kimiAuthUrl = import.meta.env.VITE_KIMI_AUTH_URL;
  const appID = import.meta.env.VITE_APP_ID;
  const redirectUri = `${window.location.origin}/api/oauth/callback`;
  const state = btoa(redirectUri);

  const url = new URL(`${kimiAuthUrl}/api/oauth/authorize`);
  url.searchParams.set("client_id", appID);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "profile");
  url.searchParams.set("state", state);

  return url.toString();
}

export default function Login() {
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [role, setRole] = useState<"superadmin" | "admin" | "caller" | "viewer">("admin");
  
  const login = trpc.auth.login.useMutation();
  const devLogin = trpc.auth.devLogin.useMutation();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError("Please fill in all fields.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await login.mutateAsync({ email, password });
      // Invalidate the auth state so components refresh correctly
      window.location.href = "/";
    } catch (err: any) {
      console.error("Login failed:", err);
      setError(err?.message || "Invalid email or password");
    } finally {
      setLoading(false);
    }
  };

  const handleDevLogin = async () => {
    setError("");
    setLoading(true);
    try {
      await devLogin.mutateAsync({ role });
      window.location.href = "/";
    } catch (err: any) {
      console.error("Developer login failed:", err);
      setError(err?.message || "Developer login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 p-4">
      <Card className="w-full max-w-md bg-gray-900 border-gray-800 text-white shadow-2xl relative overflow-hidden">
        {/* Glow effects */}
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-purple-600/10 rounded-full blur-3xl pointer-events-none" />
        
        <CardHeader className="text-center pb-4 relative z-10">
          <div className="mx-auto w-12 h-12 rounded-xl bg-blue-600 flex items-center justify-center mb-4 shadow-lg shadow-blue-500/20">
            <KeyRound className="w-6 h-6 text-white" />
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight bg-gradient-to-r from-white via-gray-200 to-gray-400 bg-clip-text text-transparent">
            Welcome to Salesvora
          </CardTitle>
          <p className="text-sm text-gray-400 mt-1">Sign in to manage campaigns and calls</p>
        </CardHeader>
        
        <CardContent className="space-y-5 relative z-10">
          {error && (
            <Alert variant="destructive" className="bg-red-500/10 border-red-500/20 text-red-400">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-xs">{error}</AlertDescription>
            </Alert>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-gray-300 text-xs font-semibold">Email Address</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <Input
                  id="email"
                  type="email"
                  placeholder="name@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="bg-gray-850 border-gray-800 focus:border-blue-600 text-white pl-10 h-10 text-sm"
                  disabled={loading}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-gray-300 text-xs font-semibold">Password</Label>
              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="bg-gray-850 border-gray-800 focus:border-blue-600 text-white pl-10 h-10 text-sm"
                  disabled={loading}
                />
              </div>
            </div>

            <Button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white h-10 shadow-lg shadow-blue-500/15"
              disabled={loading}
            >
              {loading ? "Signing in..." : "Sign In with Password"}
            </Button>
          </form>

          <div className="relative flex py-2 items-center">
            <div className="flex-grow border-t border-gray-800"></div>
            <span className="flex-shrink mx-4 text-gray-500 text-xs tracking-wider uppercase font-semibold">or choose testing option</span>
            <div className="flex-grow border-t border-gray-800"></div>
          </div>
          
          <div className="space-y-3 p-3.5 bg-gray-950/40 rounded-xl border border-gray-800/40">
            <div className="space-y-1">
              <Label className="text-gray-400 text-xs font-semibold">Developer Quick Bypass Role</Label>
              <Select
                value={role}
                onValueChange={(v: any) => setRole(v)}
                disabled={loading}
              >
                <SelectTrigger className="bg-gray-850 border-gray-800 text-white text-xs h-9">
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent className="bg-gray-900 border-gray-800 text-white text-xs">
                  <SelectItem value="superadmin">Super Admin (Platform-Wide)</SelectItem>
                  <SelectItem value="admin">Admin (Full Access)</SelectItem>
                  <SelectItem value="caller">Caller (Limited Access)</SelectItem>
                  <SelectItem value="viewer">Viewer (View-Only Access)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button
              className="w-full text-xs h-9 border-gray-800 hover:bg-gray-800 hover:text-white"
              variant="outline"
              onClick={handleDevLogin}
              disabled={loading}
            >
              Quick Developer Bypass
            </Button>
          </div>

          <Button
            className="w-full text-xs bg-gray-850 hover:bg-gray-800 text-white h-9 border border-gray-800/30"
            variant="outline"
            onClick={() => {
              window.location.href = getOAuthUrl();
            }}
            disabled={loading}
          >
            Sign in with Kimi SSO
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
