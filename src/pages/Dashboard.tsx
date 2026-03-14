import { useState, useEffect } from 'react';
import { Phone, PhoneMissed, MessageSquare, CalendarPlus, Download, X, ArrowRight, Sparkles, FolderKanban } from 'lucide-react';
import { mockCallRecords, mockAppointments, mockWAConversations } from '@/data/mockCallsData';
import { projects } from '@/data/mockData';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Link } from 'react-router-dom';
import { useBranding } from '@/hooks/useBranding';
import { useAuth } from '@/contexts/AuthContext';

const Dashboard = () => {
  const branding = useBranding();
  const { user } = useAuth();
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  useEffect(() => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    const dismissed = sessionStorage.getItem('pwa-banner-dismissed');
    if (!isStandalone && !dismissed) setShowInstallBanner(true);
    const handler = (e: Event) => { e.preventDefault(); setDeferredPrompt(e); };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => { if (deferredPrompt) { deferredPrompt.prompt(); setShowInstallBanner(false); } else { window.location.href = '/install'; } };
  const dismissBanner = () => { setShowInstallBanner(false); sessionStorage.setItem('pwa-banner-dismissed', '1'); };

  const activeProjects = projects.filter(p => p.status === 'active');

  const callStats = {
    total: mockCallRecords.length,
    completed: mockCallRecords.filter(c => c.status === 'completed').length,
    missed: mockCallRecords.filter(c => c.status === 'missed').length,
  };
  const openWA = mockWAConversations.filter(c => c.status === 'open' || c.status === 'pending').length;
  const unreadWA = mockWAConversations.reduce((s, c) => s + c.unreadCount, 0);
  const upcomingApts = mockAppointments.filter(a => a.status === 'scheduled' || a.status === 'confirmed');

  const stats = [
    { label: 'Llamadas hoy', value: callStats.total, icon: Phone, gradient: 'gradient-primary', iconColor: 'text-primary', link: '/calls' },
    { label: 'WhatsApp', value: openWA, subtitle: `${unreadWA} sin leer`, icon: MessageSquare, gradient: 'gradient-success', iconColor: 'text-success', link: '/whatsapp' },
    { label: 'Citas próximas', value: upcomingApts.length, icon: CalendarPlus, gradient: 'gradient-warning', iconColor: 'text-warning', link: '/appointments' },
    { label: 'Perdidas', value: callStats.missed, icon: PhoneMissed, gradient: 'gradient-destructive', iconColor: 'text-destructive', link: '/calls' },
  ];

  return (
    <div className="p-4 sm:p-6 space-y-5 sm:space-y-6 max-w-7xl mx-auto animate-fade-in">
      {/* PWA Install Banner */}
      {showInstallBanner && (
        <div className="flex items-center gap-3 bg-primary/10 rounded-2xl p-4 shadow-soft">
          <div className="w-11 h-11 rounded-2xl bg-primary flex items-center justify-center shrink-0">
            <Download size={20} className="text-primary-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-foreground">Instala la app</p>
            <p className="text-xs text-muted-foreground">Acceso directo desde tu pantalla de inicio</p>
          </div>
          <button onClick={handleInstall} className="shrink-0 bg-primary text-primary-foreground text-xs font-bold px-4 py-2.5 rounded-xl hover:opacity-90 active:scale-95 transition-all">
            Instalar
          </button>
          <button onClick={dismissBanner} className="shrink-0 p-1.5 text-muted-foreground hover:text-foreground rounded-full">
            <X size={16} />
          </button>
        </div>
      )}

      {/* Welcome */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-foreground">
          Hola, {user?.email?.split('@')[0] || ''} 👋
        </h1>
        <p className="text-muted-foreground text-sm mt-1">Tu resumen de hoy</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        {stats.map(s => (
          <Link to={s.link} key={s.label} className={`${s.gradient} rounded-2xl p-4 sm:p-5 shadow-soft hover:shadow-card transition-all active:scale-[0.98]`}>
            <div className="flex items-start justify-between mb-3">
              <div className={`w-10 h-10 sm:w-11 sm:h-11 rounded-2xl bg-card shadow-soft flex items-center justify-center`}>
                <s.icon size={20} className={s.iconColor} />
              </div>
            </div>
            <p className="text-2xl sm:text-3xl font-extrabold text-foreground">{s.value}</p>
            <p className="text-xs sm:text-sm text-muted-foreground font-medium mt-0.5">{s.label}</p>
            {s.subtitle && <p className="text-[10px] text-muted-foreground mt-0.5">{s.subtitle}</p>}
          </Link>
        ))}
      </div>

      {/* Content sections */}
      <div className="space-y-4">
        {/* Recent calls */}
        <div className="bg-card rounded-2xl p-5 shadow-card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-foreground flex items-center gap-2">
              <Phone size={18} className="text-primary" /> Llamadas recientes
            </h3>
            <Link to="/calls" className="text-xs text-primary font-semibold hover:underline flex items-center gap-1">
              Ver todas <ArrowRight size={12} />
            </Link>
          </div>
          <div className="space-y-1">
            {mockCallRecords.slice(0, 4).map(call => (
              <div key={call.id} className="flex items-center gap-3 p-3 rounded-xl hover:bg-muted/50 transition-colors">
                <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${call.status === 'completed' ? 'bg-success' : call.status === 'missed' ? 'bg-destructive' : 'bg-warning'}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground truncate">{call.extractedData.contactName || call.fromNumber}</p>
                  <p className="text-xs text-muted-foreground">{call.agentName} · {format(call.startedAt, 'HH:mm')}</p>
                </div>
                <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-1 rounded-lg">{call.duration > 0 ? `${Math.floor(call.duration / 60)}m` : '—'}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Two column: WhatsApp + Appointments */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* WhatsApp */}
          <div className="bg-card rounded-2xl p-5 shadow-card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-foreground flex items-center gap-2">
                <MessageSquare size={18} className="text-success" /> WhatsApp
              </h3>
              <Link to="/whatsapp" className="text-xs text-primary font-semibold hover:underline flex items-center gap-1">
                Inbox <ArrowRight size={12} />
              </Link>
            </div>
            <div className="space-y-1">
              {mockWAConversations.filter(c => c.status !== 'closed').slice(0, 4).map(conv => (
                <div key={conv.id} className="flex items-center gap-3 p-3 rounded-xl hover:bg-muted/50 transition-colors">
                  <div className="w-9 h-9 rounded-full bg-success/10 flex items-center justify-center text-xs font-bold text-success">
                    {conv.contactName.split(' ').map(n => n[0]).join('').slice(0, 2)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground truncate">{conv.contactName}</p>
                    <p className="text-xs text-muted-foreground">{conv.assignedTo} · {format(conv.lastMessageAt, 'HH:mm')}</p>
                  </div>
                  {conv.unreadCount > 0 && (
                    <span className="bg-success text-success-foreground text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">{conv.unreadCount}</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Appointments */}
          <div className="bg-card rounded-2xl p-5 shadow-card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-foreground flex items-center gap-2">
                <CalendarPlus size={18} className="text-warning" /> Citas próximas
              </h3>
              <Link to="/appointments" className="text-xs text-primary font-semibold hover:underline flex items-center gap-1">
                Ver agenda <ArrowRight size={12} />
              </Link>
            </div>
            <div className="space-y-1">
              {upcomingApts.map(apt => (
                <div key={apt.id} className="flex items-start gap-3 p-3 rounded-xl hover:bg-muted/50 transition-colors">
                  <div className="text-center shrink-0 w-11 bg-warning/10 rounded-xl py-1.5">
                    <p className="text-[10px] uppercase text-warning font-bold">{format(apt.startAt, 'MMM', { locale: es })}</p>
                    <p className="text-lg font-extrabold text-foreground leading-tight">{format(apt.startAt, 'd')}</p>
                  </div>
                  <div className="min-w-0 pt-1">
                    <p className="text-sm font-semibold text-foreground truncate">{apt.contactName}</p>
                    <p className="text-xs text-muted-foreground">{apt.serviceType} · {format(apt.startAt, 'HH:mm')}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Projects & AI Summary */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-card rounded-2xl p-5 shadow-card">
            <h3 className="font-bold text-foreground flex items-center gap-2 mb-4">
              <FolderKanban size={18} className="text-primary" /> Proyectos activos
            </h3>
            <div className="space-y-3">
              {activeProjects.map(proj => (
                <div key={proj.id} className="p-3 rounded-xl bg-muted/40 hover:bg-muted/60 transition-colors">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-bold text-foreground">{proj.name}</p>
                    <span className={`text-xs px-2.5 py-1 rounded-full font-bold ${
                      proj.progress >= 60 ? 'bg-success/10 text-success' : proj.progress >= 30 ? 'bg-warning/10 text-warning' : 'bg-destructive/10 text-destructive'
                    }`}>{proj.progress}%</span>
                  </div>
                  <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${proj.progress}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-card rounded-2xl p-5 shadow-card">
            <h3 className="font-bold text-foreground flex items-center gap-2 mb-4">
              <Sparkles size={18} className="text-primary" /> Resumen IA
            </h3>
            <div className="space-y-3 text-sm text-muted-foreground">
              <div className="p-4 gradient-primary rounded-xl">
                <p className="font-bold text-foreground mb-1">📞 Comunicación</p>
                <p>Se atendieron {callStats.completed} llamadas. {callStats.missed} perdidas. {openWA} conversaciones WhatsApp abiertas.</p>
              </div>
              <div className="p-4 gradient-warning rounded-xl">
                <p className="font-bold text-foreground mb-1">⚠️ Atención requerida</p>
                <p>Hay {mockWAConversations.filter(c => c.status === 'pending').length} conversación(es) sin asignar.</p>
              </div>
              <div className="p-4 gradient-success rounded-xl">
                <p className="font-bold text-foreground mb-1">✅ Citas</p>
                <p>{upcomingApts.length} programadas. Próxima: {upcomingApts[0]?.contactName} el {upcomingApts[0] ? format(upcomingApts[0].startAt, "d MMM 'a las' HH:mm", { locale: es }) : '—'}.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
