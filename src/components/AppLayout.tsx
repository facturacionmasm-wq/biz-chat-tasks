import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, MessageSquare, FolderKanban, CalendarDays,
  Target, BookOpen, Plug, Settings, ChevronLeft, ChevronRight,
  Building2, Search, MessageCircle, Phone, CalendarPlus, Shield,
  GraduationCap, Receipt, LogOut, KeyRound, Bot, AlarmClock,
  Crown, BarChart3, Users, Sun, Moon, TrendingUp,
} from 'lucide-react';
import AIAssistantWidget from '@/components/AIAssistantWidget';
import { useBranding } from '@/hooks/useBranding';
import { useAuth } from '@/contexts/AuthContext';
import NotificationBell from '@/components/NotificationBell';
import { useIsMobile } from '@/hooks/use-mobile';
import { PresenceProvider } from '@/contexts/PresenceContext';
import BottomNav from '@/components/BottomNav';
import { useRybixTheme } from '@/hooks/useRybixTheme';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', exact: true },
  { to: '/calls', icon: Phone, label: 'Llamadas' },
  { to: '/whatsapp', icon: MessageSquare, label: 'WhatsApp' },
  { to: '/appointments', icon: CalendarPlus, label: 'Agenda' },
  { to: '/contacts', icon: Users, label: 'Contactos' },
  { to: '/chat', icon: MessageCircle, label: 'Chat Interno' },
  { to: '/calendar', icon: CalendarDays, label: 'Calendario' },
  { to: '/projects', icon: FolderKanban, label: 'Proyectos' },
  { to: '/knowledge', icon: BookOpen, label: 'Knowledge Hub' },
  { to: '/okrs', icon: Target, label: 'OKRs' },
  { to: '/analytics', icon: TrendingUp, label: 'Analytics' },
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

interface AppLayoutProps { children: React.ReactNode; }

const DesktopSidebar = ({ collapsed, setCollapsed, branding, user, userRole, signOut, isDark, toggleTheme }: any) => {
  const location = useLocation();
  const isActive = (to: string, exact = false) =>
    exact ? location.pathname === to : (location.pathname === to || location.pathname.startsWith(to + '/'));

  const NavItem = ({ to, icon: Icon, label, exact = false }: any) => (
    <NavLink
      to={to}
      title={collapsed ? label : undefined}
      className={`flex items-center gap-2.5 rounded-xl text-sm font-medium transition-all duration-150
        ${collapsed ? 'justify-center px-2 py-2.5' : 'px-3 py-2.5'}
        ${isActive(to, exact)
          ? 'bg-sidebar-custom-active/15 text-sidebar-custom-active'
          : 'text-sidebar-custom-fg hover:bg-sidebar-custom-hover hover:text-sidebar-custom-fg-bright'
        }`}
    >
      <Icon size={17} className="shrink-0" />
      {!collapsed && <span className="truncate">{label}</span>}
      {!collapsed && isActive(to, exact) && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-sidebar-custom-active shrink-0" />}
    </NavLink>
  );

  return (
    <aside className={`${collapsed ? 'w-[4.5rem]' : 'w-60'} shrink-0 bg-sidebar-custom-bg flex flex-col h-full transition-all duration-300 ease-in-out border-r border-sidebar-custom-border`}>
      <div className={`h-16 flex items-center border-b border-sidebar-custom-border ${collapsed ? 'justify-center px-2' : 'px-5 gap-3'}`}>
        {branding.logoUrl
          ? <img src={branding.logoUrl} alt={branding.orgName} className="h-9 w-9 rounded-xl object-contain shrink-0" />
          : <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-teal-400 flex items-center justify-center shrink-0"><Building2 size={17} className="text-white" /></div>
        }
        {!collapsed && (
          <div className="min-w-0">
            <h1 className="text-sidebar-custom-fg-bright font-bold text-sm leading-tight truncate">{branding.orgName}</h1>
            {branding.slogan && <p className="text-[10px] text-sidebar-custom-muted truncate">{branding.slogan}</p>}
          </div>
        )}
      </div>

      {!collapsed && (
        <div className="px-3 py-3">
          <div
            onClick={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }))}
            className="flex items-center gap-2 bg-sidebar-custom-hover/80 rounded-xl px-3 py-2 text-sidebar-custom-muted text-xs cursor-pointer hover:bg-sidebar-custom-hover transition-colors"
          >
            <Search size={13} />
            <span>Buscar...</span>
            <kbd className="ml-auto text-[9px] bg-sidebar-custom-bg/60 px-1.5 py-0.5 rounded-md border border-sidebar-custom-border font-mono">⌘K</kbd>
          </div>
        </div>
      )}

      <nav className="flex-1 overflow-y-auto scrollbar-thin px-2 py-1 space-y-0.5">
        {navItems.map(item => <NavItem key={item.to} {...item} />)}
        <div className="mt-4 pt-3 border-t border-sidebar-custom-border">
          {!collapsed && <p className="text-[9px] uppercase tracking-widest text-sidebar-custom-muted font-semibold px-3 mb-2">Administración</p>}
          {adminItems.map(item => <NavItem key={item.to} {...item} />)}
        </div>
        {userRole === 'super_admin' && (
          <div className="mt-3 pt-3 border-t border-sidebar-custom-border">
            {!collapsed && <p className="text-[9px] uppercase tracking-widest text-sidebar-custom-muted font-semibold px-3 mb-2">Super Admin</p>}
            {superAdminItems.map(item => <NavItem key={item.to} {...item} />)}
          </div>
        )}
      </nav>

      <div className="p-3 border-t border-sidebar-custom-border space-y-1.5">
        {!collapsed && user && (
          <div className="px-2 py-1.5 rounded-xl bg-sidebar-custom-hover/50">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary to-teal-400 flex items-center justify-center text-white text-[10px] font-bold shrink-0">
                {user.email?.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold text-sidebar-custom-fg-bright truncate">{user.email}</p>
                <p className="text-[9px] text-sidebar-custom-muted capitalize">{userRole || 'staff'}</p>
              </div>
            </div>
          </div>
        )}
        <button onClick={toggleTheme} className={`w-full flex items-center gap-2.5 rounded-xl text-sm font-medium text-sidebar-custom-fg hover:bg-sidebar-custom-hover hover:text-sidebar-custom-fg-bright transition-all ${collapsed ? 'justify-center px-2 py-2.5' : 'px-3 py-2.5'}`}>
          {isDay ? <Sun size={16} className="shrink-0" /> : <Moon size={16} className="shrink-0" />}
          {!collapsed && <span>{isDay ? 'Modo noche' : 'Modo día'}</span>}
        </button>
        <button onClick={signOut} className={`w-full flex items-center gap-2.5 rounded-xl text-sm font-medium text-sidebar-custom-fg hover:bg-destructive/10 hover:text-destructive transition-all ${collapsed ? 'justify-center px-2 py-2.5' : 'px-3 py-2.5'}`}>
          <LogOut size={16} className="shrink-0" />
          {!collapsed && <span>Cerrar sesión</span>}
        </button>
        <button onClick={() => setCollapsed(!collapsed)} className="w-full flex items-center justify-center py-1.5 rounded-xl text-sidebar-custom-muted hover:text-sidebar-custom-fg-bright hover:bg-sidebar-custom-hover transition-colors">
          {collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
        </button>
      </div>
    </aside>
  );
};

const AppLayout = ({ children }: AppLayoutProps) => {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const branding = useBranding();
  const { user, userRole, signOut } = useAuth();
  const isMobile = useIsMobile();
  const { isDay, toggle: toggleTheme } = useRybixTheme();

  const allItems = [...navItems, ...adminItems, ...superAdminItems];
  const currentLabel = allItems.find(n => n.exact ? location.pathname === n.to : (location.pathname === n.to || location.pathname.startsWith(n.to + '/')))?.label || branding.orgName;

  return (
    <PresenceProvider>
      <div className="flex h-screen bg-background overflow-hidden">
        {!isMobile && <DesktopSidebar collapsed={collapsed} setCollapsed={setCollapsed} branding={branding} user={user} userRole={userRole} signOut={signOut} isDark={isDay} toggleTheme={toggleTheme} />}
        <div className="flex-1 flex flex-col min-w-0">
          <header className={`h-14 shrink-0 flex items-center justify-between px-4 sm:px-5 bg-card/90 backdrop-blur-lg ${!isMobile ? 'border-b border-border' : ''}`}>
            <div className="flex items-center gap-3">
              {isMobile && branding.logoUrl && <img src={branding.logoUrl} alt={branding.orgName} className="h-8 w-8 rounded-xl object-contain" />}
              <h2 className="text-base font-bold text-foreground truncate">{currentLabel}</h2>
            </div>
            <div className="flex items-center gap-1.5">
              {isMobile && (
                <button onClick={toggleTheme} className="p-2.5 rounded-xl text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                  {isDay ? <Moon size={17} /> : <Sun size={17} />}
                </button>
              )}
              <NotificationBell />
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary to-teal-400 flex items-center justify-center text-white text-xs font-bold ml-1 cursor-pointer shadow-soft">
                {user?.email?.charAt(0).toUpperCase() || 'U'}
              </div>
            </div>
          </header>
          <main className={`flex-1 min-h-0 overflow-auto ${isMobile ? 'pb-[var(--bottom-nav-height)]' : ''}`}>
            {children}
          </main>
        </div>
        {isMobile && <BottomNav />}
        <AIAssistantWidget />
      </div>
    </PresenceProvider>
  );
};

export default AppLayout;
