import React, { forwardRef } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import AppLayout from "./components/AppLayout";
import Dashboard from "./pages/Dashboard";
import ChatPage from "./pages/ChatPage";
import ProjectsPage from "./pages/ProjectsPage";
import CalendarPage from "./pages/CalendarPage";
import OKRsPage from "./pages/OKRsPage";
import KnowledgePage from "./pages/KnowledgePage";
import IntegrationsPage from "./pages/IntegrationsPage";
import SettingsPage from "./pages/SettingsPage";
import CallsPage from "./pages/CallsPage";
import WhatsAppInboxPage from "./pages/WhatsAppInboxPage";
import AppointmentsPage from "./pages/AppointmentsPage";
import AuditLogPage from "./pages/AuditLogPage";
import AITrainingPage from "./pages/AITrainingPage";
import ExpensesPage from "./pages/ExpensesPage";
import AuthPage from "./pages/AuthPage";
import OnboardingPage from "./pages/OnboardingPage";
import SubscriptionBlockedPage from "./pages/SubscriptionBlockedPage";
import CredentialsPage from "./pages/CredentialsPage";
import InstallPage from "./pages/InstallPage";
import PendingApprovalPage from "./pages/PendingApprovalPage";
import AssistantAdminPage from "./pages/AssistantAdminPage";
import RemindersPage from "./pages/RemindersPage";
import SuperAdminPage from "./pages/SuperAdminPage";
import UsagePage from "./pages/UsagePage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import SchemaDocsPage from "./pages/SchemaDocsPage";
import NotFound from "./pages/NotFound";
import ContactsPage from "./pages/ContactsPage";
import AnalyticsPage from "./pages/AnalyticsPage";
import { Loader2 } from "lucide-react";
import CommandPalette from "./components/CommandPalette";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
});

type RouteGuardProps = { children: React.ReactNode };

const LoadingScreen = () => (
  <div className="min-h-screen flex items-center justify-center bg-background">
    <Loader2 className="animate-spin text-primary" size={32} />
  </div>
);

const ProtectedRoute = forwardRef<HTMLDivElement, RouteGuardProps>(({ children }, _ref) => {
  const { user, loading, onboardingCompleted, subscriptionStatus, userRole, profileStatus } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/auth" replace />;
  if (profileStatus === 'pending_approval') return <Navigate to="/pending-approval" replace />;
  if (onboardingCompleted === false) return <Navigate to="/onboarding" replace />;
  if (userRole !== 'super_admin' && subscriptionStatus?.is_blocked) return <Navigate to="/blocked" replace />;
  return <>{children}</>;
});
ProtectedRoute.displayName = 'ProtectedRoute';

const AdminRoute = forwardRef<HTMLDivElement, RouteGuardProps>(({ children }, _ref) => {
  const { user, loading, userRole } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/auth" replace />;
  if (userRole !== 'super_admin') return <Navigate to="/" replace />;
  return <>{children}</>;
});
AdminRoute.displayName = 'AdminRoute';

const OnboardingRoute = forwardRef<HTMLDivElement, RouteGuardProps>(({ children }, _ref) => {
  const { user, loading, onboardingCompleted } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/auth" replace />;
  if (onboardingCompleted === true) return <Navigate to="/" replace />;
  return <>{children}</>;
});
OnboardingRoute.displayName = 'OnboardingRoute';

const BlockedRoute = forwardRef<HTMLDivElement, RouteGuardProps>(({ children }, _ref) => {
  const { user, loading, subscriptionStatus, userRole } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/auth" replace />;
  if (userRole === 'super_admin' || !subscriptionStatus?.is_blocked) return <Navigate to="/" replace />;
  return <>{children}</>;
});
BlockedRoute.displayName = 'BlockedRoute';

const AuthRoute = forwardRef<HTMLDivElement, RouteGuardProps>(({ children }, _ref) => {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
});
AuthRoute.displayName = 'AuthRoute';

const PendingApprovalRoute = forwardRef<HTMLDivElement, RouteGuardProps>(({ children }, _ref) => {
  const { user, loading, profileStatus } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/auth" replace />;
  if (profileStatus !== 'pending_approval') return <Navigate to="/" replace />;
  return <>{children}</>;
});
PendingApprovalRoute.displayName = 'PendingApprovalRoute';

const P = ({ children }: { children: React.ReactNode }) => (
  <ProtectedRoute><AppLayout>{children}</AppLayout></ProtectedRoute>
);

const AppRoutes = () => (
  <Routes>
    <Route path="/auth" element={<AuthRoute><AuthPage /></AuthRoute>} />
    <Route path="/install" element={<InstallPage />} />
    <Route path="/reset-password" element={<ResetPasswordPage />} />
    <Route path="/onboarding" element={<OnboardingRoute><OnboardingPage /></OnboardingRoute>} />
    <Route path="/blocked" element={<BlockedRoute><SubscriptionBlockedPage /></BlockedRoute>} />
    <Route path="/pending-approval" element={<PendingApprovalRoute><PendingApprovalPage /></PendingApprovalRoute>} />
    <Route path="/" element={<P><Dashboard /></P>} />
    <Route path="/calls" element={<P><CallsPage /></P>} />
    <Route path="/whatsapp" element={<P><WhatsAppInboxPage /></P>} />
    <Route path="/appointments" element={<P><AppointmentsPage /></P>} />
    <Route path="/contacts" element={<P><ContactsPage /></P>} />
    <Route path="/analytics" element={<P><AnalyticsPage /></P>} />
    <Route path="/chat" element={<P><ChatPage /></P>} />
    <Route path="/calendar" element={<P><CalendarPage /></P>} />
    <Route path="/projects" element={<P><ProjectsPage /></P>} />
    <Route path="/knowledge" element={<P><KnowledgePage /></P>} />
    <Route path="/okrs" element={<P><OKRsPage /></P>} />
    <Route path="/ai-training" element={<P><AITrainingPage /></P>} />
    <Route path="/expenses" element={<P><ExpensesPage /></P>} />
    <Route path="/settings" element={<P><SettingsPage /></P>} />
    <Route path="/credentials" element={<P><CredentialsPage /></P>} />
    <Route path="/assistant-admin" element={<P><AssistantAdminPage /></P>} />
    <Route path="/reminders" element={<P><RemindersPage /></P>} />
    <Route path="/integrations" element={<P><IntegrationsPage /></P>} />
    <Route path="/audit" element={<P><AuditLogPage /></P>} />
    <Route path="/usage" element={<P><UsagePage /></P>} />
    <Route path="/super-admin" element={<AdminRoute><AppLayout><SuperAdminPage /></AppLayout></AdminRoute>} />
    <Route path="/schema-docs" element={<AdminRoute><AppLayout><SchemaDocsPage /></AppLayout></AdminRoute>} />
    <Route path="*" element={<NotFound />} />
  </Routes>
);

const AppWithPalette = () => {
  const [paletteOpen, setPaletteOpen] = React.useState(false);

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setPaletteOpen(prev => !prev);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  return (
    <>
      <AppRoutes />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <AppWithPalette />
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
