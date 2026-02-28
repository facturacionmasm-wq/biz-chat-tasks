import { useState } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { calendarEvents } from '@/data/mockData';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, startOfWeek, endOfWeek, isSameMonth, isSameDay, addMonths, subMonths } from 'date-fns';
import { es } from 'date-fns/locale';

const eventColors: Record<string, string> = {
  meeting: 'bg-primary/10 text-primary border-l-2 border-primary',
  deadline: 'bg-destructive/10 text-destructive border-l-2 border-destructive',
  milestone: 'bg-warning/10 text-warning border-l-2 border-warning',
  event: 'bg-success/10 text-success border-l-2 border-success',
  presentation: 'bg-accent text-accent-foreground border-l-2 border-primary',
};

const CalendarPage = () => {
  const [currentDate, setCurrentDate] = useState(new Date(2026, 1, 27));
  const [view, setView] = useState<'month' | 'week' | 'agenda'>('month');

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  const getEventsForDay = (day: Date) => calendarEvents.filter(e => isSameDay(e.date, day));

  const upcomingEvents = calendarEvents
    .filter(e => e.date >= new Date(2026, 1, 27))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  if (view === 'agenda') {
    return (
      <div className="p-4 sm:p-6 max-w-4xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
          <h1 className="text-xl font-bold text-foreground">Agenda</h1>
          <div className="flex items-center gap-2">
            {(['month', 'week', 'agenda'] as const).map(v => (
              <button key={v} onClick={() => setView(v)} className={`text-xs px-3 py-1.5 rounded-md ${view === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'}`}>
                {v === 'month' ? 'Mes' : v === 'week' ? 'Semana' : 'Agenda'}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-3">
          {upcomingEvents.map(ev => (
            <div key={ev.id} className={`p-4 rounded-lg ${eventColors[ev.type]}`}>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                <h3 className="font-medium text-sm">{ev.title}</h3>
                <span className="text-xs">{format(ev.date, "d MMM yyyy 'a las' HH:mm", { locale: es })}</span>
              </div>
              {ev.endDate && <p className="text-xs mt-1 opacity-70">Hasta {format(ev.endDate, 'HH:mm')}</p>}
            </div>
          ))}
        </div>
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
            <button onClick={() => setCurrentDate(subMonths(currentDate, 1))} className="p-1 rounded hover:bg-secondary text-muted-foreground"><ChevronLeft size={18} /></button>
            <button onClick={() => setCurrentDate(addMonths(currentDate, 1))} className="p-1 rounded hover:bg-secondary text-muted-foreground"><ChevronRight size={18} /></button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {(['month', 'week', 'agenda'] as const).map(v => (
            <button key={v} onClick={() => setView(v)} className={`text-xs px-3 py-1.5 rounded-md ${view === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'}`}>
              {v === 'month' ? 'Mes' : v === 'week' ? 'Semana' : 'Agenda'}
            </button>
          ))}
          <button className="flex items-center gap-1 bg-primary text-primary-foreground text-sm px-3 py-1.5 rounded-lg hover:opacity-90">
            <Plus size={14} /> Evento
          </button>
        </div>
      </div>

      <div className="flex-1 border border-border rounded-xl overflow-hidden bg-card min-h-0">
        <div className="grid grid-cols-7 border-b border-border">
          {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map(d => (
            <div key={d} className="text-xs font-semibold text-muted-foreground text-center py-2 border-r border-border last:border-r-0">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 flex-1 overflow-auto">
          {days.map((day, i) => {
            const dayEvents = getEventsForDay(day);
            const isToday = isSameDay(day, new Date(2026, 1, 27));
            const isCurrentMonth = isSameMonth(day, currentDate);
            return (
              <div key={i} className={`min-h-[60px] sm:min-h-[100px] p-1 border-r border-b border-border last:border-r-0 ${!isCurrentMonth ? 'bg-muted/30' : ''}`}>
                <div className={`text-xs font-medium mb-0.5 w-5 h-5 sm:w-6 sm:h-6 flex items-center justify-center rounded-full ${isToday ? 'bg-primary text-primary-foreground' : isCurrentMonth ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {format(day, 'd')}
                </div>
                <div className="space-y-0.5 hidden sm:block">
                  {dayEvents.slice(0, 2).map(ev => (
                    <div key={ev.id} className={`text-[10px] px-1 py-0.5 rounded truncate ${eventColors[ev.type]}`}>{ev.title}</div>
                  ))}
                  {dayEvents.length > 2 && <p className="text-[10px] text-muted-foreground px-1">+{dayEvents.length - 2}</p>}
                </div>
                {dayEvents.length > 0 && <div className="sm:hidden flex gap-0.5 mt-0.5">{dayEvents.slice(0, 3).map(ev => (<div key={ev.id} className="w-1.5 h-1.5 rounded-full bg-primary" />))}</div>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default CalendarPage;
