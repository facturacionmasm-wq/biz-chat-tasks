import { useState, useEffect } from 'react';
import { CalendarDays, CheckCircle2, AlertTriangle, TrendingUp, Clock, Target, FolderKanban, Sparkles, ArrowRight, Phone, PhoneMissed, MessageSquare, CalendarPlus, Download, X } from 'lucide-react';
import { tasks, projects, okrs, calendarEvents } from '@/data/mockData';
import { mockCallRecords, mockAppointments, mockWAConversations } from '@/data/mockCallsData';
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

  const urgentTasks = tasks.filter(t => t.priority === 'high' && t.status !== 'done');
  const todayEvents = calendarEvents.filter(e => {
    const today = new Date();
    return e.date.toDateString() === today.toDateString() || e.date > today;
  }).slice(0, 4);
  const activeProjects = projects.filter(p => p.status === 'active');
  const avgOkrProgress = Math.round(okrs.reduce((sum, o) => sum + o.progress, 0) / okrs.length);

  const callStats = {
    total: mockCallRecords.length,
    completed: mockCallRecords.filter(c => c.status === 'completed').length,
    missed: mockCallRecords.filter(c => c.status === 'missed').length,
  };
  const openWA = mockWAConversations.filter(c => c.status === 'open' || c.status === 'pending').length;
  const unreadWA = mockWAConversations.reduce((s, c) => s + c.unreadCount, 0);
  const upcomingApts = mockAppointments.filter(a => a.status === 'scheduled' || a.status === 'confirmed');

  const stats = [
    { label: 'Llamadas hoy', value: callStats.total, icon: Phone, color: 'text-primary', link: '/calls' },
    { label: 'WhatsApp abiertos', value: openWA, icon: MessageSquare, color: 'text-success', link: '/whatsapp' },
    { label: 'Citas próximas', value: upcomingApts.length, icon: CalendarPlus, color: 'text-warning', link: '/appointments' },
    { label: 'Llamadas perdidas', value: callStats.missed, icon: PhoneMissed, color: 'text-destructive', link: '/calls' },
  ];

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 max-w-7xl mx-auto">
      {/* PWA Install Banner */}
      {showInstallBanner && (
        <div className="flex items-center gap-3 bg-primary/10 border border-primary/20 rounded-xl p-3 sm:p-4">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center shrink-0">
            <Download size={20} className="text-primary-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground">Instala RYBIX en tu dispositivo</p>
            <p className="text-xs text-muted-foreground">Acceso rápido desde tu pantalla de inicio, sin tiendas de apps.</p>
          </div>
          <button onClick={handleInstall} className="shrink-0 bg-primary text-primary-foreground text-xs sm:text-sm font-medium px-3 sm:px-4 py-2 rounded-lg hover:opacity-90">
            Instalar
          </button>
          <button onClick={dismissBanner} className="shrink-0 p-1 text-muted-foreground hover:text-foreground">
            <X size={16} />
          </button>
        </div>
      )}

      {/* Welcome */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 sm:gap-4">
          {branding.logoUrl && (
            <img src={branding.logoUrl} alt={branding.orgName} className="h-8 sm:h-10 object-contain" />
          )}
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-foreground">Buenos días, {user?.email?.split('@')[0] || ''} 👋</h1>
            <p className="text-muted-foreground text-xs sm:text-sm mt-1">Resumen de comunicación, atención y agenda.</p>
          </div>
        </div>
        <div className="flex items-center gap-2 bg-primary/10 text-primary border border-primary/20 rounded-lg px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium w-fit">
          <Sparkles size={16} />
          <span>Resumen IA semanal</span>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        {stats.map(s => (
          <Link to={s.link} key={s.label} className="bg-card border border-border rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-muted-foreground">{s.label}</span>
              <s.icon size={18} className={s.color} />
            </div>
            <p className="text-2xl font-bold text-foreground">{s.value}</p>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
        {/* Recent calls */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <Phone size={16} className="text-primary" /> Llamadas recientes
            </h3>
            <Link to="/calls" className="text-xs text-primary hover:underline flex items-center gap-1">
              Ver todas <ArrowRight size={12} />
            </Link>
          </div>
          <div className="space-y-2">
            {mockCallRecords.slice(0, 4).map(call => (
              <div key={call.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-secondary/50 transition-colors">
                <div className={`w-2 h-2 rounded-full shrink-0 ${call.status === 'completed' ? 'bg-success' : call.status === 'missed' ? 'bg-destructive' : 'bg-warning'}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground truncate">{call.extractedData.contactName || call.fromNumber}</p>
                  <p className="text-xs text-muted-foreground">{call.agentName} · {format(call.startedAt, 'HH:mm')}</p>
                </div>
                <span className="text-xs text-muted-foreground">{call.duration > 0 ? `${Math.floor(call.duration / 60)}m` : '—'}</span>
              </div>
            ))}
          </div>
        </div>

        {/* WhatsApp unread */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <MessageSquare size={16} className="text-success" /> WhatsApp ({unreadWA} sin leer)
            </h3>
            <Link to="/whatsapp" className="text-xs text-primary hover:underline flex items-center gap-1">
              Inbox <ArrowRight size={12} />
            </Link>
          </div>
          <div className="space-y-2">
            {mockWAConversations.filter(c => c.status !== 'closed').slice(0, 4).map(conv => (
              <div key={conv.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-secondary/50 transition-colors">
                <div className="w-7 h-7 rounded-full bg-success/10 flex items-center justify-center text-[10px] font-bold text-success">
                  {conv.contactName.split(' ').map(n => n[0]).join('').slice(0, 2)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground truncate">{conv.contactName}</p>
                  <p className="text-xs text-muted-foreground">{conv.assignedTo} · {format(conv.lastMessageAt, 'HH:mm')}</p>
                </div>
                {conv.unreadCount > 0 && (
                  <span className="bg-success text-success-foreground text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">{conv.unreadCount}</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Upcoming appointments */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <CalendarPlus size={16} className="text-warning" /> Citas próximas
            </h3>
            <Link to="/appointments" className="text-xs text-primary hover:underline flex items-center gap-1">
              Ver agenda <ArrowRight size={12} />
            </Link>
          </div>
          <div className="space-y-2">
            {upcomingApts.map(apt => (
              <div key={apt.id} className="flex items-start gap-3 p-2 rounded-lg hover:bg-secondary/50 transition-colors">
                <div className="text-center shrink-0 w-10">
                  <p className="text-[10px] uppercase text-muted-foreground">{format(apt.startAt, 'MMM', { locale: es })}</p>
                  <p className="text-lg font-bold text-foreground leading-tight">{format(apt.startAt, 'd')}</p>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{apt.contactName}</p>
                  <p className="text-xs text-muted-foreground">{apt.serviceType} · {format(apt.startAt, 'HH:mm')}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Projects & AI Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <h3 className="font-semibold text-foreground flex items-center gap-2 mb-4">
            <FolderKanban size={16} className="text-primary" /> Proyectos activos
          </h3>
          <div className="space-y-3">
            {activeProjects.map(proj => (
              <div key={proj.id} className="p-3 rounded-lg border border-border hover:bg-secondary/30 transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-semibold text-foreground">{proj.name}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    proj.progress >= 60 ? 'bg-success/10 text-success' : proj.progress >= 30 ? 'bg-warning/10 text-warning' : 'bg-destructive/10 text-destructive'
                  }`}>{proj.progress}%</span>
                </div>
                <div className="w-full h-1.5 bg-secondary rounded-full overflow-hidden">
                  <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${proj.progress}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <h3 className="font-semibold text-foreground flex items-center gap-2 mb-4">
            <Sparkles size={16} className="text-primary" /> Resumen IA semanal
          </h3>
          <div className="space-y-3 text-sm text-muted-foreground">
            <div className="p-3 bg-primary/5 rounded-lg border border-primary/10">
              <p className="font-medium text-foreground mb-1">📞 Comunicación</p>
              <p>Se atendieron {callStats.completed} llamadas esta semana. {callStats.missed} perdidas. {openWA} conversaciones de WhatsApp abiertas con {unreadWA} mensajes sin leer.</p>
            </div>
            <div className="p-3 bg-warning/5 rounded-lg border border-warning/10">
              <p className="font-medium text-foreground mb-1">⚠️ Atención requerida</p>
              <p>Hay {mockWAConversations.filter(c => c.status === 'pending').length} conversación(es) de WhatsApp sin asignar. Se sugiere asignar a un agente para evitar demoras.</p>
            </div>
            <div className="p-3 bg-success/5 rounded-lg border border-success/10">
              <p className="font-medium text-foreground mb-1">✅ Citas y seguimiento</p>
              <p>{upcomingApts.length} citas programadas. La próxima es con {upcomingApts[0]?.contactName} el {upcomingApts[0] ? format(upcomingApts[0].startAt, "d MMM 'a las' HH:mm", { locale: es }) : '—'}.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
