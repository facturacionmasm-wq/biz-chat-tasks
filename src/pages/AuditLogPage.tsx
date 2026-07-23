import { Shield, Search, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { useState } from 'react';
import { useAuditEvents, useAuditFilterOptions } from '@/hooks/useAuditEvents';

const eventTypeLabels: Record<string, { label: string; color: string }> = {
  'call.inbound_received': { label: 'Llamada entrante', color: 'bg-primary/10 text-[var(--rx-brand)]' },
  'call.webhook_received': { label: 'Webhook llamada', color: 'bg-primary/10 text-[var(--rx-brand)]' },
  'call.reconciliation_gave_up': { label: 'Reconciliación fallida', color: 'bg-destructive/10 text-[var(--rx-rose)]' },
  'call.reconciled_backfill': { label: 'Reconciliada', color: 'bg-[rgba(0,232,122,.1)] text-[var(--rx-emerald)]' },
  'call.elevenlabs_post_call': { label: 'Post-call OK', color: 'bg-[rgba(0,232,122,.1)] text-[var(--rx-emerald)]' },
  'call.elevenlabs_post_call_unauthorized': { label: 'Post-call 401', color: 'bg-destructive/10 text-[var(--rx-rose)]' },
  'call.agent_action.check_availability': { label: 'Agente: disponibilidad', color: 'bg-accent text-accent-foreground' },
  'call.agent_action.book_appointment': { label: 'Agente: agendó', color: 'bg-[rgba(0,232,122,.1)] text-[var(--rx-emerald)]' },
  'call.agent_action.cancel_appointment': { label: 'Agente: canceló', color: 'bg-warning/10 text-[var(--rx-amber)]' },
  'call.agent_action.reschedule_appointment': { label: 'Agente: reagendó', color: 'bg-warning/10 text-[var(--rx-amber)]' },
  'voice.outbound_call.initiated': { label: 'Llamada saliente', color: 'bg-primary/10 text-[var(--rx-brand)]' },
  'call_job.failed': { label: 'Job llamada fallido', color: 'bg-destructive/10 text-[var(--rx-rose)]' },
  'whatsapp.message_received': { label: 'WhatsApp recibido', color: 'bg-[rgba(0,232,122,.1)] text-[var(--rx-emerald)]' },
  'whatsapp.message_sent': { label: 'WhatsApp enviado', color: 'bg-[rgba(0,232,122,.1)] text-[var(--rx-emerald)]' },
  'calendar_event_created': { label: 'Evento creado', color: 'bg-accent text-accent-foreground' },
  'calendar_event_mirrored': { label: 'Evento espejado', color: 'bg-accent text-accent-foreground' },
  'google_calendar_connected': { label: 'Google Calendar conectado', color: 'bg-primary/10 text-[var(--rx-brand)]' },
  'appointment.auto_created': { label: 'Cita auto-creada', color: 'bg-[rgba(0,232,122,.1)] text-[var(--rx-emerald)]' },
  'elevenlabs_staff_sync': { label: 'Sync staff', color: 'bg-accent text-accent-foreground' },
  'elevenlabs.twilio_native_setup': { label: 'Setup Twilio nativo', color: 'bg-accent text-accent-foreground' },
  'user_role_insert': { label: 'Rol asignado', color: 'bg-primary/10 text-[var(--rx-brand)]' },
  'user_role_update': { label: 'Rol modificado', color: 'bg-warning/10 text-[var(--rx-amber)]' },
  'user_role_delete': { label: 'Rol eliminado', color: 'bg-destructive/10 text-[var(--rx-rose)]' },
  'billing.setup_session_created': { label: 'Setup Stripe', color: 'bg-primary/10 text-[var(--rx-brand)]' },
  'billing.subscription_checkout_created': { label: 'Checkout Stripe', color: 'bg-primary/10 text-[var(--rx-brand)]' },
  'cfo_ai_query': { label: 'CFO AI consulta', color: 'bg-accent text-accent-foreground' },
  'pricing.evaluation_run': { label: 'Pricing run', color: 'bg-accent text-accent-foreground' },
  'churn.model_run': { label: 'Churn run', color: 'bg-accent text-accent-foreground' },
  'tenant_deleted': { label: 'Tenant eliminado', color: 'bg-destructive/10 text-[var(--rx-rose)]' },
  'bot_self_reprogram': { label: 'Bot auto-reprograma', color: 'bg-accent text-accent-foreground' },
  'support.email_ticket_created': { label: 'Ticket soporte', color: 'bg-primary/10 text-[var(--rx-brand)]' },
  'finance_connection_connect': { label: 'Banco conectado', color: 'bg-[rgba(0,232,122,.1)] text-[var(--rx-emerald)]' },
  'finance_connection_disconnect': { label: 'Banco desconectado', color: 'bg-warning/10 text-[var(--rx-amber)]' },
  'budget_upserted': { label: 'Presupuesto guardado', color: 'bg-primary/10 text-[var(--rx-brand)]' },
  'budget_deleted': { label: 'Presupuesto eliminado', color: 'bg-destructive/10 text-[var(--rx-rose)]' },
  'expense_approve': { label: 'Gasto aprobado', color: 'bg-[rgba(0,232,122,.1)] text-[var(--rx-emerald)]' },
  'expense_reject': { label: 'Gasto rechazado', color: 'bg-destructive/10 text-[var(--rx-rose)]' },
  'expense_created': { label: 'Gasto creado', color: 'bg-primary/10 text-[var(--rx-brand)]' },
  'expense_updated': { label: 'Gasto editado', color: 'bg-accent text-accent-foreground' },
  'expense_deleted': { label: 'Gasto eliminado', color: 'bg-destructive/10 text-[var(--rx-rose)]' },
  'financial_account_linked': { label: 'Cuenta vinculada', color: 'bg-[rgba(0,232,122,.1)] text-[var(--rx-emerald)]' },
  'financial_account_unlinked': { label: 'Cuenta desvinculada', color: 'bg-warning/10 text-[var(--rx-amber)]' },
  'pin_reset_by_admin': { label: 'PIN reseteado', color: 'bg-warning/10 text-[var(--rx-amber)]' },
  'admin_subscription_action': { label: 'Acción suscripción', color: 'bg-warning/10 text-[var(--rx-amber)]' },
};

function labelFor(t: string) {
  return eventTypeLabels[t] || { label: t, color: 'bg-[var(--rx-s2)] text-[var(--rx-t2)]' };
}

const AuditLogPage = () => {
  const [search, setSearch] = useState('');
  const [actorId, setActorId] = useState<string>('');
  const [eventType, setEventType] = useState<string>('');
  const [resourceType, setResourceType] = useState<string>('');
  const [from, setFrom] = useState<string>('');
  const [to, setTo] = useState<string>('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { eventTypes, resourceTypes, actors } = useAuditFilterOptions();
  const { rows, loading, error, hasMore, loadMore, refresh } = useAuditEvents({
    actorId: actorId || null,
    eventType: eventType || null,
    resourceType: resourceType || null,
    from: from ? new Date(from).toISOString() : null,
    to: to ? new Date(to).toISOString() : null,
    search: search || null,
  });

  const toggle = (id: string) => {
    setExpanded(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  return (
    <div className="rx-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Shield size={20} className="text-[var(--rx-brand)]" /> Log de Auditoría
          </h1>
          <p className="text-sm text-[var(--rx-t2)] mt-1">Registro completo de acciones por usuario y sistema</p>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--rx-b1)] bg-card hover:bg-[var(--rx-s2)]/40 text-sm text-foreground disabled:opacity-60"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Actualizar
        </button>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 md:grid-cols-6 gap-2 mb-4">
        <div className="md:col-span-2 flex items-center gap-2 bg-card border border-[var(--rx-b1)] rounded-lg px-3 py-2">
          <Search size={16} className="text-[var(--rx-t2)]" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar evento o recurso..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--rx-t2)]"
          />
        </div>
        <select value={actorId} onChange={e => setActorId(e.target.value)} className="bg-card border border-[var(--rx-b1)] rounded-lg px-2 py-2 text-sm text-foreground">
          <option value="">Todos los actores</option>
          <option value="__system__">Sistema</option>
          {actors.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select value={eventType} onChange={e => setEventType(e.target.value)} className="bg-card border border-[var(--rx-b1)] rounded-lg px-2 py-2 text-sm text-foreground">
          <option value="">Todos los eventos</option>
          {eventTypes.map(t => <option key={t} value={t}>{labelFor(t).label}</option>)}
        </select>
        <select value={resourceType} onChange={e => setResourceType(e.target.value)} className="bg-card border border-[var(--rx-b1)] rounded-lg px-2 py-2 text-sm text-foreground">
          <option value="">Todos los módulos</option>
          {resourceTypes.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <div className="flex gap-1">
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="w-full bg-card border border-[var(--rx-b1)] rounded-lg px-2 py-2 text-xs text-foreground" />
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="w-full bg-card border border-[var(--rx-b1)] rounded-lg px-2 py-2 text-xs text-foreground" />
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-sm text-[var(--rx-rose)]">
          {error === 'permission denied' || error?.includes('permission') ? 'No tienes permiso para ver el log de auditoría (requiere admin, owner o super_admin).' : error}
        </div>
      )}

      {/* Desktop table */}
      <div className="hidden md:block bg-card border border-[var(--rx-b1)] rounded-xl overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--rx-b1)] bg-[var(--rx-s2)]/30">
              <th className="w-8"></th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--rx-t2)] uppercase">Fecha</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--rx-t2)] uppercase">Actor</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--rx-t2)] uppercase">Evento</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--rx-t2)] uppercase">Recurso</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--rx-t2)] uppercase">Detalles</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-[var(--rx-t2)]">Sin eventos para los filtros seleccionados.</td></tr>
            )}
            {rows.map(event => {
              const cfg = labelFor(event.event_type);
              const isOpen = expanded.has(event.id);
              return (
                <>
                  <tr key={event.id} className="border-b border-[var(--rx-b1)] last:border-b-0 hover:bg-[var(--rx-s2)]/30 cursor-pointer" onClick={() => toggle(event.id)}>
                    <td className="px-2">{isOpen ? <ChevronDown size={14} className="text-[var(--rx-t2)]" /> : <ChevronRight size={14} className="text-[var(--rx-t2)]" />}</td>
                    <td className="px-4 py-3 text-[var(--rx-t2)] text-xs whitespace-nowrap">{format(new Date(event.created_at), "d MMM HH:mm:ss", { locale: es })}</td>
                    <td className="px-4 py-3 font-medium text-foreground">{event.actor_name ?? 'Sistema'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cfg.color}`}>{cfg.label}</span>
                    </td>
                    <td className="px-4 py-3 text-[var(--rx-t2)] font-mono text-xs">{event.resource_type ?? '-'}{event.resource_id ? `/${event.resource_id.slice(0, 12)}` : ''}</td>
                    <td className="px-4 py-3 text-xs text-[var(--rx-t2)] max-w-[240px] truncate">{event.payload ? JSON.stringify(event.payload) : '-'}</td>
                  </tr>
                  {isOpen && (
                    <tr key={event.id + '-x'} className="bg-[var(--rx-s2)]/20 border-b border-[var(--rx-b1)]">
                      <td colSpan={6} className="px-8 py-3">
                        <pre className="text-[11px] text-[var(--rx-t2)] whitespace-pre-wrap break-all font-mono">{JSON.stringify(event.payload ?? {}, null, 2)}</pre>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {rows.length === 0 && !loading && (
          <div className="rx-panel text-center text-sm text-[var(--rx-t2)]">Sin eventos para los filtros seleccionados.</div>
        )}
        {rows.map(event => {
          const cfg = labelFor(event.event_type);
          const isOpen = expanded.has(event.id);
          const preview = event.payload ? JSON.stringify(event.payload) : '';
          return (
            <div key={event.id} className="rx-panel cursor-pointer" onClick={() => toggle(event.id)}>
              <div className="flex items-center justify-between gap-2">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cfg.color}`}>{cfg.label}</span>
                <span className="text-[10px] text-[var(--rx-t2)] shrink-0">{format(new Date(event.created_at), "d MMM HH:mm", { locale: es })}</span>
              </div>
              <p className="text-sm font-medium text-foreground mt-2">{event.actor_name ?? 'Sistema'}</p>
              <p className="text-xs text-[var(--rx-t2)] font-mono truncate">{event.resource_type ?? '-'}{event.resource_id ? `/${event.resource_id.slice(0, 12)}` : ''}</p>
              {preview && !isOpen && (
                <p className="text-[11px] text-[var(--rx-t2)] mt-1 truncate">{preview}</p>
              )}
              {isOpen && (
                <pre className="mt-2 text-[10px] text-[var(--rx-t2)] whitespace-pre-wrap break-all font-mono">{JSON.stringify(event.payload ?? {}, null, 2)}</pre>
              )}
              <div className="flex items-center gap-1 mt-2 text-[10px] text-[var(--rx-t2)]">
                {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                {isOpen ? 'Ocultar detalles' : 'Ver detalles'}
              </div>
            </div>
          );
        })}
      </div>


      <div className="mt-4 flex justify-center">
        {hasMore ? (
          <button onClick={loadMore} disabled={loading} className="px-4 py-2 rounded-lg border border-[var(--rx-b1)] bg-card hover:bg-[var(--rx-s2)]/40 text-sm text-foreground disabled:opacity-60">
            {loading ? 'Cargando...' : 'Cargar más'}
          </button>
        ) : rows.length > 0 && (
          <span className="text-xs text-[var(--rx-t2)]">— Fin de resultados —</span>
        )}
      </div>
    </div>
  );
};

export default AuditLogPage;
