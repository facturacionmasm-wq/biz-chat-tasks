import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, LayoutDashboard, Phone, MessageSquare, CalendarPlus,
  Users, FolderKanban, BookOpen, Target, TrendingUp, Settings,
  Receipt, AlarmClock, BarChart3, LogOut, Sun, Moon,
  ArrowRight, Hash, Zap,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useRybixTheme } from '@/hooks/useRybixTheme';

interface Command {
  id: string;
  label: string;
  description?: string;
  icon: React.ElementType;
  iconColor: string;
  action: () => void;
  group: string;
  keywords?: string[];
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export default function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const { isDay, toggle } = useRybixTheme();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const nav = useCallback((to: string) => {
    navigate(to);
    onClose();
  }, [navigate, onClose]);

  const commands: Command[] = [
    // Navigation
    { id: 'dashboard', label: 'Dashboard', description: 'Vista general', icon: LayoutDashboard, iconColor: 'var(--rx-brand)', action: () => nav('/'), group: 'Navegación', keywords: ['inicio', 'home'] },
    { id: 'calls', label: 'Llamadas', description: 'Historial y agente de voz', icon: Phone, iconColor: 'var(--rx-sky)', action: () => nav('/calls'), group: 'Navegación', keywords: ['call', 'voz', 'voice'] },
    { id: 'whatsapp', label: 'WhatsApp Inbox', description: 'Conversaciones y bot', icon: MessageSquare, iconColor: '#25d366', action: () => nav('/whatsapp'), group: 'Navegación', keywords: ['chat', 'mensaje', 'wa'] },
    { id: 'appointments', label: 'Agenda', description: 'Citas y disponibilidad', icon: CalendarPlus, iconColor: 'var(--rx-amber)', action: () => nav('/appointments'), group: 'Navegación', keywords: ['cita', 'appointment', 'schedule'] },
    { id: 'contacts', label: 'Contactos', description: 'CRM de clientes', icon: Users, iconColor: 'var(--rx-violet)', action: () => nav('/contacts'), group: 'Navegación', keywords: ['crm', 'cliente', 'contact'] },
    { id: 'projects', label: 'Proyectos', description: 'Gestión de proyectos', icon: FolderKanban, iconColor: 'var(--rx-rose)', action: () => nav('/projects'), group: 'Navegación', keywords: ['proyecto', 'kanban', 'tarea'] },
    { id: 'analytics', label: 'Analytics', description: 'Métricas y reportes', icon: TrendingUp, iconColor: 'var(--rx-sky)', action: () => nav('/analytics'), group: 'Navegación' },
    { id: 'knowledge', label: 'Knowledge Hub', description: 'Base de conocimientos IA', icon: BookOpen, iconColor: 'var(--rx-emerald)', action: () => nav('/knowledge'), group: 'Navegación', keywords: ['kb', 'conocimiento', 'articulo'] },
    { id: 'okrs', label: 'OKRs', description: 'Objetivos y resultados clave', icon: Target, iconColor: 'var(--rx-amber)', action: () => nav('/okrs'), group: 'Navegación' },
    { id: 'expenses', label: 'Gastos', description: 'Registro de gastos', icon: Receipt, iconColor: 'var(--rx-violet)', action: () => nav('/expenses'), group: 'Navegación' },
    { id: 'reminders', label: 'Recordatorios', description: 'Alertas y notificaciones', icon: AlarmClock, iconColor: 'var(--rx-rose)', action: () => nav('/reminders'), group: 'Navegación' },
    { id: 'usage', label: 'Consumo', description: 'Uso y facturación', icon: BarChart3, iconColor: 'var(--rx-sky)', action: () => nav('/usage'), group: 'Navegación' },
    { id: 'settings', label: 'Configuración', description: 'Perfil y empresa', icon: Settings, iconColor: 'var(--rx-t2)', action: () => nav('/settings'), group: 'Navegación' },
    // Actions
    {
      id: 'theme',
      label: isDay ? 'Cambiar a modo noche' : 'Cambiar a modo día',
      description: isDay ? 'Activar tema oscuro' : 'Activar tema claro',
      icon: isDay ? Moon : Sun,
      iconColor: isDay ? 'var(--rx-violet)' : 'var(--rx-amber)',
      action: () => { toggle(); onClose(); },
      group: 'Acciones',
      keywords: ['tema', 'theme', 'dark', 'light', 'oscuro', 'claro', 'noche', 'dia'],
    },
    {
      id: 'logout',
      label: 'Cerrar sesión',
      description: 'Salir de la cuenta',
      icon: LogOut,
      iconColor: 'var(--rx-rose)',
      action: () => { signOut(); onClose(); },
      group: 'Acciones',
      keywords: ['logout', 'salir', 'exit'],
    },
  ];

  const filtered = query.trim()
    ? commands.filter(cmd => {
        const q = query.toLowerCase();
        return (
          cmd.label.toLowerCase().includes(q) ||
          cmd.description?.toLowerCase().includes(q) ||
          cmd.keywords?.some(k => k.toLowerCase().includes(q)) ||
          cmd.group.toLowerCase().includes(q)
        );
      })
    : commands;

  // Group results
  const groups = filtered.reduce<Record<string, Command[]>>((acc, cmd) => {
    if (!acc[cmd.group]) acc[cmd.group] = [];
    acc[cmd.group].push(cmd);
    return acc;
  }, {});

  const flatFiltered = Object.values(groups).flat();

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelected(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => { setSelected(0); }, [query]);

  // Scroll selected into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${selected}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected(s => Math.min(s + 1, flatFiltered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected(s => Math.max(s - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      flatFiltered[selected]?.action();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,.6)',
          backdropFilter: 'blur(8px)',
          zIndex: 9000,
          animation: 'rxFadeUp .15s ease both',
        }}
      />

      {/* Palette */}
      <div
        style={{
          position: 'fixed',
          top: '15%',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(600px, calc(100vw - 32px))',
          background: 'var(--rx-s1)',
          border: '1px solid var(--rx-b2)',
          borderRadius: 18,
          boxShadow: '0 24px 80px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.06)',
          zIndex: 9001,
          overflow: 'hidden',
          animation: 'rxScaleIn .18s cubic-bezier(.16,1,.3,1) both',
        }}
        onKeyDown={handleKey}
      >
        {/* Search input */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '14px 18px',
          borderBottom: '1px solid var(--rx-b1)',
        }}>
          <Search size={18} style={{ color: 'var(--rx-brand)', flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Buscar páginas, acciones..."
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              fontSize: 15, color: 'var(--rx-t1)', fontFamily: 'var(--rx-font-body)',
            }}
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--rx-t3)', padding: 2 }}
            >✕</button>
          )}
          <span className="rx-kbd">ESC</span>
        </div>

        {/* Results */}
        <div
          ref={listRef}
          style={{ maxHeight: 380, overflowY: 'auto', padding: '8px 0' }}
        >
          {flatFiltered.length === 0 ? (
            <div style={{ padding: '32px 24px', textAlign: 'center' }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>🔍</div>
              <div style={{ fontSize: 13, color: 'var(--rx-t3)' }}>Sin resultados para "{query}"</div>
            </div>
          ) : (
            Object.entries(groups).map(([group, cmds]) => {
              let globalIdx = 0;
              // compute start index for this group
              let startIdx = 0;
              for (const [g, cs] of Object.entries(groups)) {
                if (g === group) break;
                startIdx += cs.length;
              }

              return (
                <div key={group}>
                  <div style={{
                    fontSize: 10, fontWeight: 700, color: 'var(--rx-t3)',
                    textTransform: 'uppercase', letterSpacing: '.1em',
                    padding: '8px 18px 4px',
                  }}>
                    {group}
                  </div>
                  {cmds.map((cmd, i) => {
                    const idx = startIdx + i;
                    const isActive = idx === selected;
                    const Icon = cmd.icon;
                    return (
                      <div
                        key={cmd.id}
                        data-idx={idx}
                        onClick={cmd.action}
                        onMouseEnter={() => setSelected(idx)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 12,
                          padding: '9px 18px', cursor: 'pointer',
                          background: isActive ? 'var(--rx-s2)' : 'transparent',
                          transition: 'background .1s',
                        }}
                      >
                        <div style={{
                          width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                          background: `${cmd.iconColor}18`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          <Icon size={15} style={{ color: cmd.iconColor }} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--rx-t1)' }}>
                            {cmd.label}
                          </div>
                          {cmd.description && (
                            <div style={{ fontSize: 11, color: 'var(--rx-t3)', marginTop: 1 }}>
                              {cmd.description}
                            </div>
                          )}
                        </div>
                        {isActive && (
                          <ArrowRight size={14} style={{ color: 'var(--rx-brand)', flexShrink: 0 }} />
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 16,
          padding: '10px 18px',
          borderTop: '1px solid var(--rx-b1)',
          background: 'var(--rx-s2)',
        }}>
          {[
            { key: '↑↓', label: 'navegar' },
            { key: '↵', label: 'seleccionar' },
            { key: 'ESC', label: 'cerrar' },
          ].map(k => (
            <div key={k.key} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span className="rx-kbd">{k.key}</span>
              <span style={{ fontSize: 10, color: 'var(--rx-t3)' }}>{k.label}</span>
            </div>
          ))}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5 }}>
            <Zap size={11} style={{ color: 'var(--rx-brand)' }} />
            <span style={{ fontSize: 10, color: 'var(--rx-t3)', fontWeight: 600 }}>RYBIX Command</span>
          </div>
        </div>
      </div>
    </>
  );
}
