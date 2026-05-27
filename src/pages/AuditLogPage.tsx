import { Shield, Search, Filter } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { useState } from 'react';

const mockAuditEvents = [
  { id: '1', actor: 'Ana García', eventType: 'call.created', resourceType: 'call_record', resourceId: 'call-1', payload: { from: '+52 55 1234 5678' }, createdAt: new Date(2026, 1, 27, 9, 15) },
  { id: '2', actor: 'Sistema', eventType: 'call.summary_generated', resourceType: 'call_record', resourceId: 'call-1', payload: { version: 1 }, createdAt: new Date(2026, 1, 27, 9, 29) },
  { id: '3', actor: 'Ana García', eventType: 'appointment.created', resourceType: 'appointment', resourceId: 'apt-1', payload: { source: 'call' }, createdAt: new Date(2026, 1, 27, 9, 30) },
  { id: '4', actor: 'Carlos López', eventType: 'whatsapp.message_sent', resourceType: 'whatsapp_message', resourceId: 'wam-6', payload: { to: '+52 33 9876 5432' }, createdAt: new Date(2026, 1, 27, 10, 50) },
  { id: '5', actor: 'Sistema', eventType: 'otp.requested', resourceType: 'otp_challenge', resourceId: 'otp-1', payload: { phone: '+52 55 ****5678' }, createdAt: new Date(2026, 1, 27, 11, 0) },
  { id: '6', actor: 'Sistema', eventType: 'notification.whatsapp_unread', resourceType: 'internal_message', resourceId: 'msg-1', payload: { user: 'Juan Martínez' }, createdAt: new Date(2026, 1, 27, 11, 30) },
  { id: '7', actor: 'Laura Sánchez', eventType: 'knowledge.article_created', resourceType: 'knowledge_item', resourceId: 'kb-10', payload: { title: 'Proceso de ventas actualizado' }, createdAt: new Date(2026, 1, 27, 12, 0) },
  { id: '8', actor: 'Ana García', eventType: 'user.role_changed', resourceType: 'user_roles', resourceId: 'role-1', payload: { from: 'staff', to: 'admin' }, createdAt: new Date(2026, 1, 27, 14, 0) },
];

const eventTypeLabels: Record<string, { label: string; color: string }> = {
  'call.created': { label: 'Llamada registrada', color: 'bg-primary/10 text-[var(--rx-brand)]' },
  'call.summary_generated': { label: 'Resumen generado', color: 'bg-accent text-accent-foreground' },
  'appointment.created': { label: 'Cita agendada', color: 'bg-[rgba(0,232,122,.1)] text-[var(--rx-emerald)]' },
  'whatsapp.message_sent': { label: 'WhatsApp enviado', color: 'bg-[rgba(0,232,122,.1)] text-[var(--rx-emerald)]' },
  'otp.requested': { label: 'OTP solicitado', color: 'bg-warning/10 text-[var(--rx-amber)]' },
  'notification.whatsapp_unread': { label: 'Alerta no leído', color: 'bg-warning/10 text-[var(--rx-amber)]' },
  'knowledge.article_created': { label: 'Artículo creado', color: 'bg-primary/10 text-[var(--rx-brand)]' },
  'user.role_changed': { label: 'Rol cambiado', color: 'bg-destructive/10 text-[var(--rx-rose)]' },
};

const AuditLogPage = () => {
  const [search, setSearch] = useState('');

  const filtered = mockAuditEvents.filter(e =>
    !search || e.actor.toLowerCase().includes(search.toLowerCase()) || e.eventType.includes(search.toLowerCase())
  );

  return (
    <div className="rx-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Shield size={20} className="text-[var(--rx-brand)]" /> Log de Auditoría
          </h1>
          <p className="text-sm text-[var(--rx-t2)] mt-1">Registro completo de acciones por usuario y sistema</p>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <div className="flex-1 flex items-center gap-2 bg-card border border-[var(--rx-b1)] rounded-lg px-3 py-2">
          <Search size={16} className="text-[var(--rx-t2)]" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por actor o tipo de evento..." className="flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--rx-t2)]" />
        </div>
      </div>

      {/* Desktop table */}
      <div className="hidden md:block bg-card border border-[var(--rx-b1)] rounded-xl overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--rx-b1)] bg-[var(--rx-s2)]/30">
              <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--rx-t2)] uppercase">Fecha</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--rx-t2)] uppercase">Actor</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--rx-t2)] uppercase">Evento</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--rx-t2)] uppercase">Recurso</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--rx-t2)] uppercase">Detalles</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(event => {
              const cfg = eventTypeLabels[event.eventType] || { label: event.eventType, color: 'bg-[var(--rx-s2)] text-[var(--rx-t2)]' };
              return (
                <tr key={event.id} className="border-b border-[var(--rx-b1)] last:border-b-0 hover:bg-[var(--rx-s2)]/30">
                  <td className="px-4 py-3 text-[var(--rx-t2)] text-xs whitespace-nowrap">{format(event.createdAt, "d MMM HH:mm:ss", { locale: es })}</td>
                  <td className="px-4 py-3 font-medium text-foreground">{event.actor}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cfg.color}`}>{cfg.label}</span>
                  </td>
                  <td className="px-4 py-3 text-[var(--rx-t2)] font-mono text-xs">{event.resourceType}/{event.resourceId}</td>
                  <td className="px-4 py-3 text-xs text-[var(--rx-t2)] max-w-[200px] truncate">{JSON.stringify(event.payload)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {filtered.map(event => {
          const cfg = eventTypeLabels[event.eventType] || { label: event.eventType, color: 'bg-[var(--rx-s2)] text-[var(--rx-t2)]' };
          return (
            <div key={event.id} className="rx-panel">
              <div className="flex items-center justify-between">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cfg.color}`}>{cfg.label}</span>
                <span className="text-[10px] text-[var(--rx-t2)]">{format(event.createdAt, "d MMM HH:mm", { locale: es })}</span>
              </div>
              <p className="text-sm font-medium text-foreground">{event.actor}</p>
              <p className="text-xs text-[var(--rx-t2)] font-mono">{event.resourceType}/{event.resourceId}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default AuditLogPage;
