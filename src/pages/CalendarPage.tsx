import { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, startOfWeek, endOfWeek, isSameMonth, isSameDay, addMonths, subMonths } from 'date-fns';
import { es } from 'date-fns/locale';
import { supabase } from '@/integrations/supabase/client';

interface CalendarAppointment {
  id: string;
  title: string;
  date: Date;
  endDate: Date;
  status: string;
  source: string | null;
}

const statusColors: Record<string, string> = {
  scheduled: 'bg-primary/10 text-[var(--rx-brand)] border-l-2 border-primary',
  confirmed: 'bg-green-500/10 text-green-600 border-l-2 border-green-500',
  completed: 'bg-[var(--rx-s2)] text-[var(--rx-t2)] border-l-2 border-muted-foreground',
  cancelled: 'bg-destructive/10 text-[var(--rx-rose)] border-l-2 border-destructive',
  no_show: 'bg-orange-500/10 text-orange-600 border-l-2 border-orange-500',
};

const CalendarPage = () => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<'month' | 'agenda'>('month');
  const [appointments, setAppointments] = useState<CalendarAppointment[]>([]);
  const [loading, setLoading] = useState(true);

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  const loadAppointments = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('appointments')
        .select('id, contact_name, service_type, start_at, end_at, status, source')
        .is('deleted_at', null)
        .gte('start_at', calendarStart.toISOString())
        .lte('start_at', calendarEnd.toISOString())
        .order('start_at', { ascending: true });

      if (error) throw error;

      setAppointments((data || []).map(a => ({
        id: a.id,
        title: `${a.service_type || 'Cita'} - ${a.contact_name}`,
        date: new Date(a.start_at),
        endDate: new Date(a.end_at),
        status: a.status,
        source: a.source,
      })));
    } catch (err) {
      console.error('Error loading calendar appointments:', err);
    } finally {
      setLoading(false);
    }
  }, [calendarStart.toISOString(), calendarEnd.toISOString()]);

  useEffect(() => { loadAppointments(); }, [loadAppointments]);

  // Realtime
  useEffect(() => {
    const channel = supabase
      .channel('calendar_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' }, () => loadAppointments())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadAppointments]);

  const getEventsForDay = (day: Date) => appointments.filter(e => isSameDay(e.date, day));

  if (view === 'agenda') {
    const upcoming = appointments
      .filter(a => a.date >= new Date() && a.status !== 'cancelled')
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    return (
      <div className="rx-page">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
          <h1 className="rx-page-title">Agenda</h1>
          <div className="flex items-center gap-2">
            <button onClick={() => setView('month')} className={`text-xs px-3 py-1.5 rounded-md text-[var(--rx-t2)] hover:bg-[var(--rx-s2)]`}>Mes</button>
            <button onClick={() => setView('agenda')} className={`text-xs px-3 py-1.5 rounded-md bg-[var(--rx-brand)] text-[var(--rx-brand)]-foreground`}>Agenda</button>
            <button onClick={loadAppointments} className="p-1.5 rounded-lg bg-[var(--rx-s2)] hover:bg-[var(--rx-s2)]/80 text-[var(--rx-t2)]"><RefreshCw size={14} /></button>
          </div>
        </div>
        {upcoming.length === 0 ? (
          <p className="text-sm text-[var(--rx-t2)] text-center py-8">No hay citas próximas</p>
        ) : (
          <div className="space-y-3">
            {upcoming.map(ev => (
              <div key={ev.id} className={`p-4 rounded-lg ${statusColors[ev.status] || statusColors.scheduled}`}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                  <h3 className="font-medium text-sm">{ev.title}</h3>
                  <span className="text-xs">{format(ev.date, "d MMM yyyy 'a las' HH:mm", { locale: es })}</span>
                </div>
                <p className="text-xs mt-1 opacity-70">Hasta {format(ev.endDate, 'HH:mm')}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 h-full flex flex-col">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-lg sm:text-xl font-bold text-foreground">
            {format(currentDate, 'MMMM yyyy', { locale: es })}
          </h1>
          <div className="flex items-center gap-1">
            <button onClick={() => setCurrentDate(subMonths(currentDate, 1))} className="p-1 rounded hover:bg-[var(--rx-s2)] text-[var(--rx-t2)]"><ChevronLeft size={18} /></button>
            <button onClick={() => setCurrentDate(new Date())} className="text-xs px-2 py-1 rounded hover:bg-[var(--rx-s2)] text-[var(--rx-t2)]">Hoy</button>
            <button onClick={() => setCurrentDate(addMonths(currentDate, 1))} className="p-1 rounded hover:bg-[var(--rx-s2)] text-[var(--rx-t2)]"><ChevronRight size={18} /></button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setView('month')} className="text-xs px-3 py-1.5 rounded-md bg-[var(--rx-brand)] text-[var(--rx-brand)]-foreground">Mes</button>
          <button onClick={() => setView('agenda')} className="text-xs px-3 py-1.5 rounded-md text-[var(--rx-t2)] hover:bg-[var(--rx-s2)]">Agenda</button>
          <button onClick={loadAppointments} className="p-1.5 rounded-lg bg-[var(--rx-s2)] hover:bg-[var(--rx-s2)]/80 text-[var(--rx-t2)]"><RefreshCw size={14} /></button>
        </div>
      </div>

      <div className="flex-1 border border-[var(--rx-b1)] rounded-xl overflow-hidden bg-card min-h-0">
        <div className="grid grid-cols-7 border-b border-[var(--rx-b1)]">
          {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map(d => (
            <div key={d} className="text-xs font-semibold text-[var(--rx-t2)] text-center py-2 border-r border-[var(--rx-b1)] last:border-r-0">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 flex-1 overflow-auto">
          {days.map((day, i) => {
            const dayEvents = getEventsForDay(day);
            const isToday = isSameDay(day, new Date());
            const isCurrentMonth = isSameMonth(day, currentDate);
            return (
              <div key={i} className={`min-h-[60px] sm:min-h-[100px] p-1 border-r border-b border-[var(--rx-b1)] last:border-r-0 ${!isCurrentMonth ? 'bg-[var(--rx-s2)]/30' : ''}`}>
                <div className={`text-xs font-medium mb-0.5 w-5 h-5 sm:w-6 sm:h-6 flex items-center justify-center rounded-full ${isToday ? 'bg-[var(--rx-brand)] text-[var(--rx-brand)]-foreground' : isCurrentMonth ? 'text-foreground' : 'text-[var(--rx-t2)]'}`}>
                  {format(day, 'd')}
                </div>
                <div className="space-y-0.5 hidden sm:block">
                  {dayEvents.filter(e => e.status !== 'cancelled').slice(0, 2).map(ev => (
                    <div key={ev.id} className={`text-[10px] px-1 py-0.5 rounded truncate ${statusColors[ev.status] || statusColors.scheduled}`}>{ev.title}</div>
                  ))}
                  {dayEvents.filter(e => e.status !== 'cancelled').length > 2 && (
                    <p className="text-[10px] text-[var(--rx-t2)] px-1">+{dayEvents.filter(e => e.status !== 'cancelled').length - 2}</p>
                  )}
                </div>
                {dayEvents.filter(e => e.status !== 'cancelled').length > 0 && (
                  <div className="sm:hidden flex gap-0.5 mt-0.5">
                    {dayEvents.filter(e => e.status !== 'cancelled').slice(0, 3).map(ev => (
                      <div key={ev.id} className="w-1.5 h-1.5 rounded-full bg-[var(--rx-brand)]" />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default CalendarPage;
