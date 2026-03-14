import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Phone, MessageSquare, CalendarPlus, MoreHorizontal,
  FolderKanban, CalendarDays, Target, BookOpen, MessageCircle,
  GraduationCap, Receipt, KeyRound, AlarmClock, BarChart3,
  Plug, Shield, Bot, Settings, Crown, LogOut, X
} from 'lucide-react';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { useAuth } from '@/contexts/AuthContext';

const mainTabs = [
  { to: '/', icon: LayoutDashboard, label: 'Inicio' },
  { to: '/calls', icon: Phone, label: 'Llamadas' },
  { to: '/whatsapp', icon: MessageSquare, label: 'WhatsApp' },
  { to: '/appointments', icon: CalendarPlus, label: 'Agenda' },
];

const moreItems = [
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
  { to: '/integrations', icon: Plug, label: 'Integraciones' },
  { to: '/audit', icon: Shield, label: 'Auditoría' },
  { to: '/assistant-admin', icon: Bot, label: 'Asistente IA' },
  { to: '/settings', icon: Settings, label: 'Configuración' },
];

const BottomNav = () => {
  const [moreOpen, setMoreOpen] = useState(false);
  const location = useLocation();
  const { userRole, signOut } = useAuth();

  const isMoreActive = moreItems.some(item => 
    location.pathname === item.to || location.pathname.startsWith(item.to + '/')
  ) || (userRole === 'super_admin' && location.pathname.startsWith('/super-admin'));

  return (
    <>
      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-card/95 backdrop-blur-lg border-t border-border shadow-elevated safe-area-bottom">
        <div className="flex items-stretch justify-around h-[var(--bottom-nav-height)]">
          {mainTabs.map(tab => {
            const isActive = tab.to === '/' ? location.pathname === '/' : location.pathname.startsWith(tab.to);
            return (
              <NavLink
                key={tab.to}
                to={tab.to}
                className="flex flex-col items-center justify-center gap-0.5 flex-1 relative"
              >
                {isActive && (
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-1 bg-primary rounded-b-full" />
                )}
                <tab.icon
                  size={22}
                  className={`transition-colors ${isActive ? 'text-primary' : 'text-muted-foreground'}`}
                />
                <span className={`text-[10px] font-medium transition-colors ${isActive ? 'text-primary' : 'text-muted-foreground'}`}>
                  {tab.label}
                </span>
              </NavLink>
            );
          })}
          
          {/* More button */}
          <button
            onClick={() => setMoreOpen(true)}
            className="flex flex-col items-center justify-center gap-0.5 flex-1 relative"
          >
            {isMoreActive && (
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-1 bg-primary rounded-b-full" />
            )}
            <MoreHorizontal
              size={22}
              className={`transition-colors ${isMoreActive ? 'text-primary' : 'text-muted-foreground'}`}
            />
            <span className={`text-[10px] font-medium transition-colors ${isMoreActive ? 'text-primary' : 'text-muted-foreground'}`}>
              Más
            </span>
          </button>
        </div>
      </nav>

      {/* More sheet */}
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="rounded-t-3xl px-2 pb-8 max-h-[75vh]">
          <SheetTitle className="text-center text-base font-bold mb-3">Más opciones</SheetTitle>
          <div className="grid grid-cols-4 gap-1 overflow-y-auto">
            {moreItems.map(item => {
              const isActive = location.pathname.startsWith(item.to);
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => setMoreOpen(false)}
                  className={`flex flex-col items-center gap-1.5 p-3 rounded-2xl transition-colors ${
                    isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'
                  }`}
                >
                  <item.icon size={22} />
                  <span className="text-[10px] font-medium text-center leading-tight">{item.label}</span>
                </NavLink>
              );
            })}
            {userRole === 'super_admin' && (
              <NavLink
                to="/super-admin"
                onClick={() => setMoreOpen(false)}
                className={`flex flex-col items-center gap-1.5 p-3 rounded-2xl transition-colors ${
                  location.pathname.startsWith('/super-admin') ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                <Crown size={22} />
                <span className="text-[10px] font-medium text-center leading-tight">SuperAdmin</span>
              </NavLink>
            )}
          </div>
          <div className="mt-4 pt-4 border-t border-border">
            <button
              onClick={() => { signOut(); setMoreOpen(false); }}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors"
            >
              <LogOut size={18} />
              Cerrar sesión
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
};

export default BottomNav;
