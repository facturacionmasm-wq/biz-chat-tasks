import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
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
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<AppLayout><Dashboard /></AppLayout>} />
          <Route path="/calls" element={<AppLayout><CallsPage /></AppLayout>} />
          <Route path="/whatsapp" element={<AppLayout><WhatsAppInboxPage /></AppLayout>} />
          <Route path="/appointments" element={<AppLayout><AppointmentsPage /></AppLayout>} />
          <Route path="/chat" element={<AppLayout><ChatPage /></AppLayout>} />
          <Route path="/calendar" element={<AppLayout><CalendarPage /></AppLayout>} />
          <Route path="/projects" element={<AppLayout><ProjectsPage /></AppLayout>} />
          <Route path="/knowledge" element={<AppLayout><KnowledgePage /></AppLayout>} />
          <Route path="/okrs" element={<AppLayout><OKRsPage /></AppLayout>} />
          <Route path="/integrations" element={<AppLayout><IntegrationsPage /></AppLayout>} />
          <Route path="/audit" element={<AppLayout><AuditLogPage /></AppLayout>} />
          <Route path="/ai-training" element={<AppLayout><AITrainingPage /></AppLayout>} />
          <Route path="/settings" element={<AppLayout><SettingsPage /></AppLayout>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
