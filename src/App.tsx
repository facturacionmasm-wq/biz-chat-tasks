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
import NotFound from "./pages/NotFound";
import { Loader2 } from "lucide-react";

const queryClient = new QueryClient();

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading, onboardingCompleted, subscriptionStatus, userRole } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="animate-spin text-primary" size={32} />
      </div>
    );
  }

  if (!user) return <Navigate to="/auth" replace />;
  if (onboardingCompleted === false) return <Navigate to="/onboarding" replace />;

  // Super admins bypass subscription checks
  if (userRole !== 'super_admin' && subscriptionStatus?.is_blocked) {
    return <Navigate to="/blocked" replace />;
  }

  return <>{children}</>;
};

const OnboardingRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading, onboardingCompleted } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/auth" replace />;
  if (onboardingCompleted === true) return <Navigate to="/" replace />;
  return <>{children}</>;
};

const BlockedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading, subscriptionStatus, userRole } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/auth" replace />;
  // If not blocked, redirect to app
  if (userRole === 'super_admin' || !subscriptionStatus?.is_blocked) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
};

const AuthRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
};

const AppRoutes = () => (
  <Routes>
    <Route path="/auth" element={<AuthRoute><AuthPage /></AuthRoute>} />
    <Route path="/onboarding" element={<OnboardingRoute><OnboardingPage /></OnboardingRoute>} />
    <Route path="/blocked" element={<BlockedRoute><SubscriptionBlockedPage /></BlockedRoute>} />
    <Route path="/" element={<ProtectedRoute><AppLayout><Dashboard /></AppLayout></ProtectedRoute>} />
    <Route path="/calls" element={<ProtectedRoute><AppLayout><CallsPage /></AppLayout></ProtectedRoute>} />
    <Route path="/whatsapp" element={<ProtectedRoute><AppLayout><WhatsAppInboxPage /></AppLayout></ProtectedRoute>} />
    <Route path="/appointments" element={<ProtectedRoute><AppLayout><AppointmentsPage /></AppLayout></ProtectedRoute>} />
    <Route path="/chat" element={<ProtectedRoute><AppLayout><ChatPage /></AppLayout></ProtectedRoute>} />
    <Route path="/calendar" element={<ProtectedRoute><AppLayout><CalendarPage /></AppLayout></ProtectedRoute>} />
    <Route path="/projects" element={<ProtectedRoute><AppLayout><ProjectsPage /></AppLayout></ProtectedRoute>} />
    <Route path="/knowledge" element={<ProtectedRoute><AppLayout><KnowledgePage /></AppLayout></ProtectedRoute>} />
    <Route path="/okrs" element={<ProtectedRoute><AppLayout><OKRsPage /></AppLayout></ProtectedRoute>} />
    <Route path="/integrations" element={<ProtectedRoute><AppLayout><IntegrationsPage /></AppLayout></ProtectedRoute>} />
    <Route path="/audit" element={<ProtectedRoute><AppLayout><AuditLogPage /></AppLayout></ProtectedRoute>} />
    <Route path="/ai-training" element={<ProtectedRoute><AppLayout><AITrainingPage /></AppLayout></ProtectedRoute>} />
    <Route path="/expenses" element={<ProtectedRoute><AppLayout><ExpensesPage /></AppLayout></ProtectedRoute>} />
    <Route path="/settings" element={<ProtectedRoute><AppLayout><SettingsPage /></AppLayout></ProtectedRoute>} />
    <Route path="/credentials" element={<ProtectedRoute><AppLayout><CredentialsPage /></AppLayout></ProtectedRoute>} />
    <Route path="/install" element={<InstallPage />} />
    <Route path="*" element={<NotFound />} />
  </Routes>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
