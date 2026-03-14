import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, MessageSquare, FolderKanban, CalendarDays,
  Target, BookOpen, Plug, Settings, ChevronLeft, ChevronRight,
  Building2, Search, MessageCircle, Phone, CalendarPlus, Shield, GraduationCap, Receipt, LogOut, KeyRound, Bot, AlarmClock, Crown, BarChart3
} from 'lucide-react';
import AIAssistantWidget from '@/components/AIAssistantWidget';
import { useBranding } from '@/hooks/useBranding';
import { useAuth } from '@/contexts/AuthContext';
import NotificationBell from '@/components/NotificationBell';
import { useIsMobile } from '@/hooks/use-mobile';
import { PresenceProvider } from '@/contexts/PresenceContext';
import BottomNav from '@/components/BottomNav';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/calls', icon: Phone, label: 'Llamadas' },
  { to: '/whatsapp', icon: MessageSquare, label: 'WhatsApp' },
  { to: '/appointments', icon: CalendarPlus, label: 'Agenda' },
  { to: '/chat', icon: MessageCircle, label: 'Chat Interno' },
  { to: '/calendar', icon: CalendarDays, label: 'Calendario' },
  { to: '/projects', icon: FolderKanban, label: 'Proyectos' },
  { to: '/knowledge', icon: BookOpen, label: 'Knowledge Hub' },
  { to: '/okrs', icon: Target, label: 'OKRs' },
  { to: '/ai-training', icon: GraduationCap, label: 'Entrenamiento IA' },
  { to: '/expenses', icon: Receipt, label: 'Gastos' },
  { to: '/credentials', icon: KeyRound, label: 'Credenciales' },
  { to: '/reminders', icon: AlarmClock, label: 'Recordatorios' },
  { to: '/usage', icon: BarChart3, label: 'Consumo' },
];

const adminItems = [
  { to: '/integrations', icon: Plug, label: 'Integraciones' },
  { to: '/audit', icon: Shield, label: 'Auditoría' },
  { to: '/assistant-admin', icon: Bot, label: 'Asistente IA' },
  { to: '/settings', icon: Settings, label: 'Configuración' },
];

const superAdminItems = [
  { to: '/super-admin', icon: Crown, label: 'SuperAdmin' },
];

interface AppLayoutProps {
  children: React.ReactNode;
}

const DesktopSidebar = ({
  collapsed,
  setCollapsed,
  branding,
  location,
  user,
  userRole,
  signOut,
}: {
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  branding: any;
  location: any;
  user: any;
  userRole: string | null;
  signOut: () => void;
}) => (
  <aside className={`${collapsed ? 'w-[4.5rem]' : 'w-60'} shrink-0 bg-sidebar-custom-bg flex flex-col h-full transition-all duration-300 ease-in-out`}>
    {/* Logo */}
    <div className={`h-16 flex items-center border-b border-sidebar-custom-border ${collapsed ? 'justify-center px-2' : 'px-5 gap-3'}`}>
      {branding.logoUrl ? (
        <img src={branding.logoUrl} alt={branding.orgName} className="h-9 w-9 rounded-xl object-contain shrink-0" />
      ) : (
        <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center shrink-0">
          <Building2 size={18} className="text-primary-foreground" />
        </div>
      )}
      {!collapsed && (
        <div className="min-w-0">
          <h1 className="text-sidebar-custom-fg-bright font-bold text-sm leading-tight truncate">{branding.orgName}</h1>
          {branding.slogan && <p className="text-[10px] text-sidebar-custom-muted truncate">{branding.slogan}</p>}
        </div>
      )}
    </div>

    {/* Search */}
    {!collapsed && (
      <div className="px-3 py-3">
        <div className="flex items-center gap-2 bg-sidebar-custom-hover rounded-xl px-3 py-2 text-sidebar-custom-muted text-sm cursor-pointer hover:bg-sidebar-custom-hover/80 transition-colors">
          <Search size={14} />
          <span>Buscar...</span>
          <kbd className="ml-auto text-[10px] bg-sidebar-custom-bg px-1.5 py-0.5 rounded-md border border-sidebar-custom-border">⌘K</kbd>
        </div>
      </div>
    )}

    {/* Nav */}
    <nav className="flex-1 overflow-y-auto scrollbar-thin px-2 py-1">
      <div className="space-y-1">
        {navItems.map(item => {
          const isActive = item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to);
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={`flex items-center gap-2.5 rounded-xl text-sm font-medium transition-all ${collapsed ? 'justify-center px-2 py-2.5' : 'px-3 py-2.5'} ${
                isActive
                  ? 'bg-sidebar-custom-active/15 text-sidebar-custom-active'
                  : 'text-sidebar-custom-fg hover:bg-sidebar-custom-hover hover:text-sidebar-custom-fg-bright'
              }`}
            >
              <item.icon size={18} className="shrink-0" />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </NavLink>
          );
        })}
      </div>

      {/* Admin section */}
      <div className="mt-6 pt-4 border-t border-sidebar-custom-border">
        {!collapsed && (
          <p className="text-[10px] uppercase tracking-wider text-sidebar-custom-muted font-semibold px-3 mb-2">Admin</p>
        )}
        <div className="space-y-1">
          {adminItems.map(item => {
            const isActive = location.pathname.startsWith(item.to);
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={`flex items-center gap-2.5 rounded-xl text-sm font-medium transition-all ${collapsed ? 'justify-center px-2 py-2.5' : 'px-3 py-2.5'} ${
                  isActive
                    ? 'bg-sidebar-custom-active/15 text-sidebar-custom-active'
                    : 'text-sidebar-custom-fg hover:bg-sidebar-custom-hover hover:text-sidebar-custom-fg-bright'
                }`}
              >
                <item.icon size={18} className="shrink-0" />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </NavLink>
            );
          })}
        </div>
      </div>

      {/* Super Admin */}
      {userRole === 'super_admin' && (
        <div className="mt-4 pt-4 border-t border-sidebar-custom-border">
          {!collapsed && (
            <p className="text-[10px] uppercase tracking-wider text-sidebar-custom-muted font-semibold px-3 mb-2">Super Admin</p>
          )}
          <div className="space-y-1">
            {superAdminItems.map(item => {
              const isActive = location.pathname.startsWith(item.to);
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={`flex items-center gap-2.5 rounded-xl text-sm font-medium transition-all ${collapsed ? 'justify-center px-2 py-2.5' : 'px-3 py-2.5'} ${
                    isActive
                      ? 'bg-sidebar-custom-active/15 text-sidebar-custom-active'
                      : 'text-sidebar-custom-fg hover:bg-sidebar-custom-hover hover:text-sidebar-custom-fg-bright'
                  }`}
                >
                  <item.icon size={18} className="shrink-0" />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </NavLink>
              );
            })}
          </div>
        </div>
      )}
    </nav>

    {/* User & Logout */}
    <div className="p-3 border-t border-sidebar-custom-border space-y-1">
      {!collapsed && user && (
        <div className="px-2 py-2">
          <p className="text-xs font-medium text-sidebar-custom-fg-bright truncate">{user.email}</p>
          <p className="text-[10px] text-sidebar-custom-muted capitalize">{userRole || 'staff'}</p>
        </div>
      )}
      <button
        onClick={signOut}
        className={`w-full flex items-center gap-2.5 rounded-xl text-sm font-medium text-sidebar-custom-fg hover:bg-sidebar-custom-hover hover:text-destructive transition-all ${collapsed ? 'justify-center px-2 py-2.5' : 'px-3 py-2.5'}`}
      >
        <LogOut size={16} className="shrink-0" />
        {!collapsed && <span>Cerrar sesión</span>}
      </button>
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-center py-2 rounded-xl text-sidebar-custom-muted hover:text-sidebar-custom-fg-bright hover:bg-sidebar-custom-hover transition-colors"
      >
        {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
      </button>
    </div>
  </aside>
);

const AppLayout = ({ children }: AppLayoutProps) => {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const branding = useBranding();
  const { user, userRole, signOut } = useAuth();
  const isMobile = useIsMobile();

  const allItems = [...navItems, ...adminItems, ...superAdminItems];
  const currentLabel = allItems.find(n => n.to === '/' ? location.pathname === '/' : location.pathname.startsWith(n.to))?.label || branding.orgName;

  return (
    <PresenceProvider>
      <div className="flex h-screen bg-background overflow-hidden">
        {/* Desktop sidebar */}
        {!isMobile && (
          <DesktopSidebar
            collapsed={collapsed}
            setCollapsed={setCollapsed}
            branding={branding}
            location={location}
            user={user}
            userRole={userRole}
            signOut={signOut}
          />
        )}

        {/* Main Content */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Top bar */}
          <header className={`h-14 shrink-0 bg-card/80 backdrop-blur-lg flex items-center justify-between px-4 sm:px-5 ${isMobile ? '' : 'border-b border-border'}`}>
            <div className="flex items-center gap-3">
              {isMobile && branding.logoUrl && (
                <img src={branding.logoUrl} alt={branding.orgName} className="h-8 w-8 rounded-xl object-contain" />
              )}
              <h2 className="text-base font-bold text-foreground truncate">
                {currentLabel}
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <NotificationBell />
              {!isMobile && (
                <button className="p-2.5 rounded-xl text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                  <MessageCircle size={18} />
                </button>
              )}
              <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs font-bold ml-1 cursor-pointer shadow-soft">
                {user?.email?.charAt(0).toUpperCase() || 'U'}
              </div>
            </div>
          </header>

          {/* Page content */}
          <main className={`flex-1 min-h-0 overflow-auto ${isMobile ? 'pb-[var(--bottom-nav-height)]' : ''}`}>
            {children}
          </main>
        </div>

        {/* Mobile bottom navigation */}
        {isMobile && <BottomNav />}

        {/* AI Assistant Widget */}
        <AIAssistantWidget />
      </div>
    </PresenceProvider>
  );
};

export default AppLayout;
