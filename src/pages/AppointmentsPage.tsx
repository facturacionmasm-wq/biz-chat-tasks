import { useState, useCallback, useEffect } from 'react';
import { CalendarPlus, Phone, MessageSquare, Monitor, User, Clock, CheckCircle2, XCircle, AlertCircle, Plus, ChevronLeft, ChevronRight, RefreshCw, Users } from 'lucide-react';
import { format, startOfWeek, endOfWeek, eachDayOfInterval, addWeeks, subWeeks, isSameDay, addDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface Appointment {
  id: string;
  contactName: string;
  contactPhone: string | null;
  contactEmail: string | null;
  serviceType: string | null;
  startAt: Date;
  endAt: Date;
  status: string;
  source: string | null;
  notes: string | null;
  userId: string | null;
  employeeName?: string;
}

interface Employee {
  userId: string;
  name: string;
}

interface AvailabilityRule {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  userId: string | null;
  active: boolean;
}

const statusConfig: Record<string, { label: string; className: string; icon: any }> = {
  scheduled: { label: 'Agendada', className: 'bg-primary/10 text-primary', icon: Clock },
  confirmed: { label: 'Confirmada', className: 'bg-success/10 text-success', icon: CheckCircle2 },
  completed: { label: 'Completada', className: 'bg-muted text-muted-foreground', icon: CheckCircle2 },
  cancelled: { label: 'Cancelada', className: 'bg-destructive/10 text-destructive', icon: XCircle },
  no_show: { label: 'No asistió', className: 'bg-warning/10 text-warning', icon: AlertCircle },
};

const sourceIcons: Record<string, { icon: any; label: string }> = {
  call: { icon: Phone, label: 'Llamada' },
  whatsapp: { icon: MessageSquare, label: 'WhatsApp' },
  app: { icon: Monitor, label: 'App' },
};

const HOURS = Array.from({ length: 12 }, (_, i) => i + 8); // 8:00 - 19:00

const AppointmentsPage = () => {
  const [view, setView] = useState<'list' | 'calendar'>('calendar');
  const [currentWeek, setCurrentWeek] = useState(new Date());
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [availRules, setAvailRules] = useState<AvailabilityRule[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const weekStart = startOfWeek(currentWeek, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(currentWeek, { weekStartsOn: 1 });
  const weekDays = eachDayOfInterval({ start: weekStart, end: addDays(weekStart, 6) });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [aptsRes, profilesRes, rulesRes] = await Promise.all([
        supabase
          .from('appointments')
          .select('*')
          .is('deleted_at', null)
          .gte('start_at', weekStart.toISOString())
          .lte('start_at', weekEnd.toISOString())
          .order('start_at', { ascending: true }),
        supabase.from('profiles_safe' as any).select('user_id, name').eq('status', 'active') as unknown as Promise<{ data: any[] | null; error: any }>,
        supabase.from('availability_rules').select('*').eq('active', true),
      ]);

      if (profilesRes.data) {
        setEmployees(profilesRes.data.map(p => ({ userId: p.user_id, name: p.name })));
      }

      if (rulesRes.data) {
        setAvailRules(rulesRes.data.map(r => ({
          dayOfWeek: r.day_of_week,
          startTime: r.start_time,
          endTime: r.end_time,
          userId: r.user_id,
          active: r.active ?? true,
        })));
      }

      if (aptsRes.data) {
        const profileMap = new Map((profilesRes.data || []).map(p => [p.user_id, p.name]));
        setAppointments(aptsRes.data.map(a => ({
          id: a.id,
          contactName: a.contact_name,
          contactPhone: a.contact_phone,
          contactEmail: a.contact_email,
          serviceType: a.service_type,
          startAt: new Date(a.start_at),
          endAt: new Date(a.end_at),
          status: a.status,
          source: a.source,
          notes: a.notes,
          userId: a.user_id,
          employeeName: a.user_id ? profileMap.get(a.user_id) || 'Desconocido' : 'Sin asignar',
        })));
      }
    } catch (err) {
      console.error('Error loading appointments:', err);
    } finally {
      setLoading(false);
    }
  }, [weekStart.toISOString(), weekEnd.toISOString()]);

  useEffect(() => { loadData(); }, [loadData]);

  // Realtime
  useEffect(() => {
    const channel = supabase
      .channel('appointments_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' }, () => loadData())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadData]);

  const filteredAppointments = selectedEmployee
    ? appointments.filter(a => a.userId === selectedEmployee)
    : appointments;

  const getAptsForDayHour = (day: Date, hour: number) =>
    filteredAppointments.filter(a => isSameDay(a.startAt, day) && a.startAt.getHours() === hour);

  const stats = {
    total: appointments.length,
    scheduled: appointments.filter(a => a.status === 'scheduled').length,
    confirmed: appointments.filter(a => a.status === 'confirmed').length,
    cancelled: appointments.filter(a => a.status === 'cancelled').length,
  };

  return (
    <div className="p-4 sm:p-6 h-full flex flex-col max-w-full overflow-hidden">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 shrink-0">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <CalendarPlus size={20} className="text-primary" /> Agenda de Citas
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Semana del {format(weekStart, "d MMM", { locale: es })} al {format(weekEnd, "d MMM yyyy", { locale: es })}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setView('calendar')} className={`text-xs px-3 py-1.5 rounded-md ${view === 'calendar' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'}`}>Calendario</button>
          <button onClick={() => setView('list')} className={`text-xs px-3 py-1.5 rounded-md ${view === 'list' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'}`}>Lista</button>
          <button onClick={loadData} className="p-1.5 rounded-lg bg-muted hover:bg-muted/80 text-muted-foreground"><RefreshCw size={14} /></button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-2 sm:gap-3 mb-4 shrink-0">
        <div className="bg-card border border-border rounded-lg p-2 sm:p-3 text-center">
          <p className="text-lg sm:text-xl font-bold text-foreground">{stats.total}</p>
          <p className="text-[10px] sm:text-xs text-muted-foreground">Total</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-2 sm:p-3 text-center">
          <p className="text-lg sm:text-xl font-bold text-primary">{stats.scheduled}</p>
          <p className="text-[10px] sm:text-xs text-muted-foreground">Agendadas</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-2 sm:p-3 text-center">
          <p className="text-lg sm:text-xl font-bold text-success">{stats.confirmed}</p>
          <p className="text-[10px] sm:text-xs text-muted-foreground">Confirmadas</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-2 sm:p-3 text-center">
          <p className="text-lg sm:text-xl font-bold text-destructive">{stats.cancelled}</p>
          <p className="text-[10px] sm:text-xs text-muted-foreground">Canceladas</p>
        </div>
      </div>

      {/* Employee filter + Week navigation */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 mb-4 shrink-0">
        <div className="flex items-center gap-2 flex-1">
          <Users size={14} className="text-muted-foreground shrink-0" />
          <select
            value={selectedEmployee || ''}
            onChange={e => setSelectedEmployee(e.target.value || null)}
            className="bg-card border border-border rounded-lg text-sm px-2 py-1.5 outline-none text-foreground flex-1 min-w-0"
          >
            <option value="">Todos los empleados</option>
            {employees.map(emp => (
              <option key={emp.userId} value={emp.userId}>{emp.name}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2 justify-center">
          <button onClick={() => setCurrentWeek(subWeeks(currentWeek, 1))} className="p-1.5 rounded hover:bg-secondary text-muted-foreground"><ChevronLeft size={16} /></button>
          <button onClick={() => setCurrentWeek(new Date())} className="text-xs px-3 py-1.5 rounded-md bg-muted text-muted-foreground hover:bg-muted/80">Hoy</button>
          <button onClick={() => setCurrentWeek(addWeeks(currentWeek, 1))} className="p-1.5 rounded hover:bg-secondary text-muted-foreground"><ChevronRight size={16} /></button>
        </div>
      </div>

      {/* Calendar View */}
      {view === 'calendar' && (
        <div className="flex-1 border border-border rounded-xl bg-card overflow-auto min-h-0">
          {/* Day headers */}
          <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-border sticky top-0 bg-card z-10">
            <div className="border-r border-border" />
            {weekDays.map(day => {
              const isToday = isSameDay(day, new Date());
              return (
                <div key={day.toISOString()} className={`text-center py-2 border-r border-border last:border-r-0 ${isToday ? 'bg-primary/5' : ''}`}>
                  <p className="text-[10px] sm:text-xs text-muted-foreground uppercase">{format(day, 'EEE', { locale: es })}</p>
                  <p className={`text-sm font-bold ${isToday ? 'text-primary' : 'text-foreground'}`}>{format(day, 'd')}</p>
                </div>
              );
            })}
          </div>

          {/* Time grid */}
          {HOURS.map(hour => (
            <div key={hour} className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-border last:border-b-0 min-h-[60px]">
              <div className="border-r border-border flex items-start justify-end pr-2 pt-1">
                <span className="text-[10px] text-muted-foreground">{`${hour}:00`}</span>
              </div>
              {weekDays.map(day => {
                const dayApts = getAptsForDayHour(day, hour);
                const isToday = isSameDay(day, new Date());
                const dayOfWeek = day.getDay();
                const hasAvailability = availRules.some(r =>
                  r.dayOfWeek === dayOfWeek &&
                  (!selectedEmployee || r.userId === selectedEmployee) &&
                  parseInt(r.startTime.split(':')[0]) <= hour &&
                  parseInt(r.endTime.split(':')[0]) > hour
                );

                return (
                  <div key={day.toISOString()} className={`border-r border-border last:border-r-0 p-0.5 ${
                    isToday ? 'bg-primary/5' : hasAvailability ? '' : 'bg-muted/20'
                  }`}>
                    {dayApts.map(apt => {
                      const sc = statusConfig[apt.status] || statusConfig.scheduled;
                      return (
                        <div key={apt.id} className={`text-[10px] rounded px-1 py-0.5 mb-0.5 truncate cursor-pointer ${sc.className}`} title={`${apt.contactName} - ${apt.serviceType || 'General'}`}>
                          <span className="font-medium">{format(apt.startAt, 'HH:mm')}</span>{' '}
                          <span className="hidden sm:inline">{apt.contactName}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {/* List View */}
      {view === 'list' && (
        <div className="flex-1 overflow-auto min-h-0">
          {filteredAppointments.length === 0 ? (
            <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground">
              <CalendarPlus size={32} className="mx-auto mb-2 opacity-50" />
              <p className="text-sm">No hay citas para esta semana</p>
              <p className="text-xs mt-1">El Voice Agent puede agendar citas automáticamente</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredAppointments.map(apt => {
                const sc = statusConfig[apt.status] || statusConfig.scheduled;
                const src = sourceIcons[apt.source || 'app'] || sourceIcons.app;
                const SIcon = sc.icon;
                const SrcIcon = src.icon;
                return (
                  <div key={apt.id} className="bg-card border border-border rounded-xl p-4 shadow-sm hover:bg-secondary/10 transition-colors">
                    <div className="flex items-center justify-between mb-2">
                      <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${sc.className}`}><SIcon size={12} /> {sc.label}</span>
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><SrcIcon size={12} /> {src.label}</span>
                        {apt.employeeName && (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><User size={12} /> {apt.employeeName}</span>
                        )}
                      </div>
                    </div>
                    <p className="font-medium text-foreground">{apt.contactName}</p>
                    {apt.contactPhone && <p className="text-xs text-muted-foreground">{apt.contactPhone}</p>}
                    <div className="flex items-center justify-between text-xs text-muted-foreground mt-2">
                      <span>{apt.serviceType || 'General'}</span>
                      <span className="font-medium text-foreground">
                        {format(apt.startAt, "EEE d MMM", { locale: es })} · {format(apt.startAt, 'HH:mm')} - {format(apt.endAt, 'HH:mm')}
                      </span>
                    </div>
                    {apt.notes && <p className="text-xs text-muted-foreground mt-2 italic">{apt.notes}</p>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AppointmentsPage;
