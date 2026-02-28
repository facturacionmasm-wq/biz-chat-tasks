import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, MessageSquare, FolderKanban, CalendarDays,
  Target, BookOpen, Plug, Settings, ChevronLeft, ChevronRight,
  Building2, Bell, Search, Sparkles, MessageCircle, Phone, CalendarPlus, Shield, GraduationCap, Receipt, LogOut, KeyRound, Menu, X
} from 'lucide-react';
import { useBranding } from '@/hooks/useBranding';
import { useAuth } from '@/contexts/AuthContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';

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
];

const adminItems = [
  { to: '/integrations', icon: Plug, label: 'Integraciones' },
  { to: '/audit', icon: Shield, label: 'Auditoría' },
  { to: '/settings', icon: Settings, label: 'Configuración' },
];

interface AppLayoutProps {
  children: React.ReactNode;
}

const SidebarContent = ({
  collapsed,
  branding,
  location,
  user,
  userRole,
  signOut,
  setCollapsed,
  onNavClick,
}: {
  collapsed: boolean;
  branding: any;
  location: any;
  user: any;
  userRole: string | null;
  signOut: () => void;
  setCollapsed?: (v: boolean) => void;
  onNavClick?: () => void;
}) => (
  <>
    {/* Logo */}
    <div className={`h-14 flex items-center border-b border-sidebar-custom-border ${collapsed ? 'justify-center px-2' : 'px-4 gap-3'}`}>
      {branding.logoUrl ? (
        <img src={branding.logoUrl} alt={branding.orgName} className="h-8 w-8 rounded-lg object-contain shrink-0" />
      ) : (
        <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
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
        <div className="flex items-center gap-2 bg-sidebar-custom-hover rounded-md px-3 py-1.5 text-sidebar-custom-muted text-sm cursor-pointer hover:bg-sidebar-custom-hover/80">
          <Search size={14} />
          <span>Buscar...</span>
          <kbd className="ml-auto text-[10px] bg-sidebar-custom-bg px-1.5 py-0.5 rounded border border-sidebar-custom-border hidden sm:inline">⌘K</kbd>
        </div>
      </div>
    )}

    {/* Nav */}
    <nav className="flex-1 overflow-y-auto scrollbar-thin px-2 py-1">
      <div className="space-y-0.5">
        {navItems.map(item => {
          const isActive = item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to);
          return (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onNavClick}
              className={`flex items-center gap-2.5 rounded-md text-sm font-medium transition-colors ${collapsed ? 'justify-center px-2 py-2' : 'px-3 py-2'} ${
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
        <div className="space-y-0.5">
          {adminItems.map(item => {
            const isActive = location.pathname.startsWith(item.to);
            return (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={onNavClick}
                className={`flex items-center gap-2.5 rounded-md text-sm font-medium transition-colors ${collapsed ? 'justify-center px-2 py-2' : 'px-3 py-2'} ${
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

      {/* AI Copilot */}
      <div className="mt-4 px-1">
        <button className={`w-full flex items-center gap-2.5 rounded-lg text-sm font-medium bg-primary/10 text-primary border border-primary/20 transition-colors hover:bg-primary/20 ${collapsed ? 'justify-center px-2 py-2' : 'px-3 py-2'}`}>
          <Sparkles size={18} className="shrink-0" />
          {!collapsed && <span>AI Copilot</span>}
        </button>
      </div>
    </nav>

    {/* User & Logout */}
    <div className="p-2 border-t border-sidebar-custom-border space-y-1">
      {!collapsed && user && (
        <div className="px-2 py-1.5">
          <p className="text-xs font-medium text-sidebar-custom-fg-bright truncate">{user.email}</p>
          <p className="text-[10px] text-sidebar-custom-muted capitalize">{userRole || 'staff'}</p>
        </div>
      )}
      <button
        onClick={signOut}
        className={`w-full flex items-center gap-2.5 rounded-md text-sm font-medium text-sidebar-custom-fg hover:bg-sidebar-custom-hover hover:text-destructive transition-colors ${collapsed ? 'justify-center px-2 py-2' : 'px-3 py-2'}`}
      >
        <LogOut size={16} className="shrink-0" />
        {!collapsed && <span>Cerrar sesión</span>}
      </button>
      {setCollapsed && (
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center justify-center py-1.5 rounded-md text-sidebar-custom-muted hover:text-sidebar-custom-fg-bright hover:bg-sidebar-custom-hover transition-colors"
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      )}
    </div>
  </>
);

const AppLayout = ({ children }: AppLayoutProps) => {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const branding = useBranding();
  const { user, userRole, signOut } = useAuth();
  const isMobile = useIsMobile();

  const sidebarProps = { branding, location, user, userRole, signOut };

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Mobile sidebar (Sheet) */}
      {isMobile && (
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="w-64 p-0 bg-sidebar-custom-bg border-sidebar-custom-border">
            <SheetTitle className="sr-only">Menú de navegación</SheetTitle>
            <div className="flex flex-col h-full">
              <SidebarContent
                collapsed={false}
                {...sidebarProps}
                onNavClick={() => setMobileOpen(false)}
              />
            </div>
          </SheetContent>
        </Sheet>
      )}

      {/* Desktop sidebar */}
      {!isMobile && (
        <aside className={`${collapsed ? 'w-16' : 'w-60'} shrink-0 bg-sidebar-custom-bg flex flex-col h-full transition-all duration-200`}>
          <SidebarContent
            collapsed={collapsed}
            setCollapsed={setCollapsed}
            {...sidebarProps}
          />
        </aside>
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-12 shrink-0 bg-card border-b border-border flex items-center justify-between px-3 sm:px-4">
          <div className="flex items-center gap-2">
            {isMobile && (
              <button onClick={() => setMobileOpen(true)} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                <Menu size={20} />
              </button>
            )}
            <h2 className="text-sm font-semibold text-foreground truncate">
              {navItems.find(n => n.to === '/' ? location.pathname === '/' : location.pathname.startsWith(n.to))?.label ||
               adminItems.find(n => location.pathname.startsWith(n.to))?.label || branding.orgName}
            </h2>
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            <button className="relative p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
              <Bell size={18} />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-destructive rounded-full" />
            </button>
            <button className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors hidden sm:block">
              <MessageCircle size={18} />
            </button>
            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs font-bold ml-1 cursor-pointer">
              {user?.email?.charAt(0).toUpperCase() || 'U'}
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 min-h-0 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
};

export default AppLayout;
