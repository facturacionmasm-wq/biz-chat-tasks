import { useState } from 'react';
import { CalendarPlus, Phone, MessageSquare, Monitor, User, Clock, CheckCircle2, XCircle, AlertCircle, Plus } from 'lucide-react';
import { mockAppointments, type Appointment } from '@/data/mockCallsData';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

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

const AppointmentsPage = () => {
  const [view, setView] = useState<'list' | 'calendar'>('list');

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <CalendarPlus size={20} className="text-primary" /> Agenda de Citas
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Gestión inteligente de citas</p>
        </div>
        <button className="flex items-center gap-1.5 bg-primary text-primary-foreground text-sm font-medium px-4 py-2 rounded-lg hover:opacity-90 w-fit">
          <Plus size={16} /> Nueva Cita
        </button>
      </div>

      {/* Availability rules - scrollable on mobile */}
      <div className="bg-card border border-border rounded-xl p-4 mb-6 shadow-sm overflow-x-auto">
        <h3 className="text-sm font-semibold text-foreground mb-3">🕐 Disponibilidad configurada</h3>
        <div className="flex gap-3 text-xs min-w-[500px] sm:min-w-0 sm:grid sm:grid-cols-5">
          {['Lun', 'Mar', 'Mié', 'Jue', 'Vie'].map(day => (
            <div key={day} className="bg-secondary rounded-lg p-2 text-center flex-1">
              <p className="font-medium text-foreground">{day}</p>
              <p className="text-muted-foreground">9:00 - 18:00</p>
              <p className="text-muted-foreground">Buffer: 15 min</p>
            </div>
          ))}
        </div>
      </div>

      {/* Appointments - card list on mobile, table on desktop */}
      <div className="hidden md:block bg-card border border-border rounded-xl overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Estado</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Contacto</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Servicio</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Fecha y hora</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Agente</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Origen</th>
            </tr>
          </thead>
          <tbody>
            {mockAppointments.map(apt => {
              const sc = statusConfig[apt.status];
              const src = sourceIcons[apt.source];
              const SIcon = sc.icon;
              const SrcIcon = src.icon;
              return (
                <tr key={apt.id} className="border-b border-border last:border-b-0 hover:bg-secondary/30 transition-colors">
                  <td className="px-4 py-3"><span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${sc.className}`}><SIcon size={12} /> {sc.label}</span></td>
                  <td className="px-4 py-3"><p className="font-medium text-foreground">{apt.contactName}</p><p className="text-xs text-muted-foreground">{apt.contactPhone}</p></td>
                  <td className="px-4 py-3 text-muted-foreground">{apt.serviceType}</td>
                  <td className="px-4 py-3"><p className="text-foreground font-medium">{format(apt.startAt, "EEE d MMM", { locale: es })}</p><p className="text-xs text-muted-foreground">{format(apt.startAt, 'HH:mm')} - {format(apt.endAt, 'HH:mm')}</p></td>
                  <td className="px-4 py-3 text-muted-foreground">{apt.agentName}</td>
                  <td className="px-4 py-3"><span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><SrcIcon size={12} /> {src.label}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile card list */}
      <div className="md:hidden space-y-3">
        {mockAppointments.map(apt => {
          const sc = statusConfig[apt.status];
          const src = sourceIcons[apt.source];
          const SIcon = sc.icon;
          const SrcIcon = src.icon;
          return (
            <div key={apt.id} className="bg-card border border-border rounded-xl p-4 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${sc.className}`}><SIcon size={12} /> {sc.label}</span>
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><SrcIcon size={12} /> {src.label}</span>
              </div>
              <p className="font-medium text-foreground">{apt.contactName}</p>
              <p className="text-xs text-muted-foreground mb-2">{apt.contactPhone}</p>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{apt.serviceType}</span>
                <span>{format(apt.startAt, "d MMM HH:mm", { locale: es })}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default AppointmentsPage;
