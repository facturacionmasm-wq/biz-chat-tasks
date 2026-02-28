import { useState, useCallback, useEffect } from 'react';
import { Phone, PhoneIncoming, PhoneMissed, PhoneOff, Clock, User, Tag, Play, CalendarPlus, MessageSquare, ChevronRight, Search, Filter, ArrowLeft, CheckCircle2, Edit3, Save } from 'lucide-react';
import { mockCallRecords, mockAppointments, type CallRecord } from '@/data/mockCallsData';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import VoiceAgent from '@/components/VoiceAgent';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// Convert a DB row to our CallRecord interface
const dbRowToCallRecord = (row: any): CallRecord => ({
  id: row.id,
  externalCallId: row.external_call_id || '',
  fromNumber: row.from_number || '',
  toNumber: row.to_number || '',
  startedAt: new Date(row.started_at || row.created_at),
  endedAt: new Date(row.ended_at || row.created_at),
  duration: row.duration || 0,
  status: row.status as CallRecord['status'],
  channel: row.channel || 'voice_agent',
  tags: row.tags || [],
  agentName: 'Voice Agent',
  transcript: row.transcript || '',
  summarySystem: row.summary_system || '',
  summaryHuman: row.summary_human || null,
  extractedData: (row.extracted_data as CallRecord['extractedData']) || {},
  audioUrl: row.audio_url || null,
});

const statusConfig: Record<string, { icon: any; label: string; className: string }> = {
  completed: { icon: Phone, label: 'Completada', className: 'text-success bg-success/10' },
  missed: { icon: PhoneMissed, label: 'Perdida', className: 'text-destructive bg-destructive/10' },
  busy: { icon: PhoneOff, label: 'Ocupado', className: 'text-warning bg-warning/10' },
  voicemail: { icon: Phone, label: 'Buzón', className: 'text-muted-foreground bg-muted' },
};

const formatDuration = (seconds: number) => {
  if (seconds === 0) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const CallsPage = () => {
  const [selectedCall, setSelectedCall] = useState<CallRecord | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [editingSummary, setEditingSummary] = useState(false);
  const [humanSummary, setHumanSummary] = useState('');
  const [lastCallSummary, setLastCallSummary] = useState<string | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [dbCalls, setDbCalls] = useState<CallRecord[]>([]);

  // Load calls from database
  const loadDbCalls = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('call_records')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      if (!error && data) {
        setDbCalls(data.map(dbRowToCallRecord));
      }
    } catch (err) {
      console.error('Error loading calls:', err);
    }
  }, []);

  useEffect(() => {
    loadDbCalls();
  }, [loadDbCalls]);

  // Merge DB calls with mock calls (DB first)
  const allCalls = [...dbCalls, ...mockCallRecords];

  const handleCallEnd = useCallback(async (transcript: string) => {
    if (!transcript.trim()) return;
    setIsSummarizing(true);
    toast.info('Guardando llamada y generando resumen con IA...');
    try {
      // 1. Save call record to database
      const now = new Date().toISOString();
      const { data: tenantData } = await supabase.rpc('get_user_tenant_id', {
        _user_id: (await supabase.auth.getUser()).data.user?.id || '',
      });

      const tenantId = tenantData;
      if (!tenantId) {
        // If no tenant, just generate summary without saving
        console.warn('No tenant found, skipping DB save');
      } else {
        const { data: callRow, error: insertError } = await supabase
          .from('call_records')
          .insert({
            tenant_id: tenantId,
            channel: 'voice_agent',
            status: 'completed',
            transcript,
            started_at: now,
            ended_at: now,
            from_number: 'Voice Agent',
            to_number: 'Usuario',
          })
          .select()
          .single();

        if (insertError) {
          console.error('Error saving call:', insertError);
          toast.error('Error al guardar la llamada en la base de datos');
        } else {
          toast.success('Llamada guardada en la base de datos');

          // 2. Generate AI summary and update the record
          const { data: aiData, error: aiError } = await supabase.functions.invoke('ai-copilot', {
            body: { action: 'summarize_call', data: { transcript, extractedData: {} } },
          });

          if (!aiError && aiData?.summary && callRow) {
            await supabase
              .from('call_records')
              .update({ summary_system: aiData.summary })
              .eq('id', callRow.id);
            setLastCallSummary(aiData.summary);
          }

          // Reload calls from DB
          await loadDbCalls();
        }
      }

      // Fallback: generate summary even without DB save
      if (!lastCallSummary) {
        const { data, error } = await supabase.functions.invoke('ai-copilot', {
          body: { action: 'summarize_call', data: { transcript, extractedData: {} } },
        });
        if (!error) setLastCallSummary(data?.summary || 'No se pudo generar resumen');
      }

      toast.success('Resumen generado exitosamente');
    } catch (err) {
      console.error('Summary error:', err);
      toast.error('Error al procesar la llamada');
    } finally {
      setIsSummarizing(false);
    }
  }, [loadDbCalls, lastCallSummary]);

  const filtered = allCalls.filter(c =>
    (!statusFilter || c.status === statusFilter) &&
    (!searchQuery || c.agentName.toLowerCase().includes(searchQuery.toLowerCase()) ||
     c.fromNumber.includes(searchQuery) || c.toNumber.includes(searchQuery) ||
     (c.extractedData.contactName || '').toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const stats = {
    total: allCalls.length,
    completed: allCalls.filter(c => c.status === 'completed').length,
    missed: allCalls.filter(c => c.status === 'missed').length,
    avgDuration: allCalls.filter(c => c.duration > 0).length > 0
      ? Math.round(allCalls.filter(c => c.duration > 0).reduce((s, c) => s + c.duration, 0) / allCalls.filter(c => c.duration > 0).length)
      : 0,
  };

  if (selectedCall) {
    const sc = statusConfig[selectedCall.status];
    return (
      <div className="flex flex-col h-full">
        <div className="shrink-0 border-b border-border p-5 bg-card">
          <button onClick={() => { setSelectedCall(null); setEditingSummary(false); }} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3">
            <ArrowLeft size={14} /> Volver a llamadas
          </button>
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <h2 className="text-xl font-bold text-foreground">{selectedCall.extractedData.contactName || selectedCall.fromNumber}</h2>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${sc.className}`}>{sc.label}</span>
              </div>
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><PhoneIncoming size={12} /> {selectedCall.fromNumber}</span>
                <span className="flex items-center gap-1"><Clock size={12} /> {formatDuration(selectedCall.duration)}</span>
                <span className="flex items-center gap-1"><User size={12} /> {selectedCall.agentName}</span>
                <span>{format(selectedCall.startedAt, "d MMM yyyy 'a las' HH:mm", { locale: es })}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button className="flex items-center gap-1.5 bg-primary text-primary-foreground text-sm px-3 py-2 rounded-lg hover:opacity-90">
                <CalendarPlus size={14} /> Agendar cita
              </button>
              <button className="flex items-center gap-1.5 bg-success text-success-foreground text-sm px-3 py-2 rounded-lg hover:opacity-90">
                <MessageSquare size={14} /> WhatsApp
              </button>
            </div>
          </div>
          {selectedCall.tags.length > 0 && (
            <div className="flex gap-1.5 mt-3">
              {selectedCall.tags.map(tag => (
                <span key={tag} className="text-xs bg-secondary text-secondary-foreground px-2 py-0.5 rounded-full flex items-center gap-1">
                  <Tag size={10} /> {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-auto p-6">
          <div className="grid grid-cols-3 gap-6 max-w-7xl mx-auto">
            {/* Summary */}
            <div className="col-span-2 space-y-6">
              <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-foreground">📝 Resumen de llamada</h3>
                  <div className="flex items-center gap-2">
                    {selectedCall.summaryHuman && (
                      <span className="text-xs bg-success/10 text-success px-2 py-0.5 rounded-full flex items-center gap-1">
                        <CheckCircle2 size={10} /> Editado
                      </span>
                    )}
                    <button
                      onClick={() => {
                        setEditingSummary(!editingSummary);
                        setHumanSummary(selectedCall.summaryHuman || selectedCall.summarySystem);
                      }}
                      className="text-xs text-primary hover:underline flex items-center gap-1"
                    >
                      <Edit3 size={10} /> {editingSummary ? 'Cancelar' : 'Editar'}
                    </button>
                  </div>
                </div>
                {editingSummary ? (
                  <div>
                    <textarea
                      value={humanSummary}
                      onChange={e => setHumanSummary(e.target.value)}
                      className="w-full bg-secondary rounded-lg px-3 py-2 text-sm outline-none border border-border focus:border-primary min-h-[200px] resize-y"
                    />
                    <button
                      onClick={() => setEditingSummary(false)}
                      className="mt-2 flex items-center gap-1 bg-primary text-primary-foreground text-sm px-3 py-1.5 rounded-lg"
                    >
                      <Save size={12} /> Aprobar resumen
                    </button>
                  </div>
                ) : (
                  <div className="prose prose-sm text-foreground whitespace-pre-line text-sm leading-relaxed">
                    {selectedCall.summaryHuman || selectedCall.summarySystem}
                  </div>
                )}
              </div>

              {/* Transcript */}
              {selectedCall.transcript && (
                <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
                  <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                    💬 Transcripción
                    {selectedCall.audioUrl && (
                      <button className="text-xs text-primary hover:underline flex items-center gap-1 ml-auto">
                        <Play size={10} /> Reproducir audio
                      </button>
                    )}
                  </h3>
                  <div className="space-y-2 text-sm max-h-80 overflow-y-auto scrollbar-thin">
                    {selectedCall.transcript.split('\n').map((line, i) => {
                      const isAgent = line.startsWith('Ana:') || line.startsWith('Carlos:') || line.startsWith('Laura:');
                      return (
                        <div key={i} className={`px-3 py-2 rounded-lg ${isAgent ? 'bg-primary/5 border-l-2 border-primary' : 'bg-muted/50'}`}>
                          <p className="text-foreground">{line}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Extracted Data */}
            <div className="space-y-4">
              <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
                <h3 className="font-semibold text-foreground mb-3">📊 Datos extraídos</h3>
                <div className="space-y-3 text-sm">
                  {selectedCall.extractedData.contactName && (
                    <div><p className="text-xs text-muted-foreground">Contacto</p><p className="font-medium text-foreground">{selectedCall.extractedData.contactName}</p></div>
                  )}
                  {selectedCall.extractedData.reason && (
                    <div><p className="text-xs text-muted-foreground">Motivo</p><p className="font-medium text-foreground">{selectedCall.extractedData.reason}</p></div>
                  )}
                  {selectedCall.extractedData.intent && (
                    <div><p className="text-xs text-muted-foreground">Intención</p><p className="font-medium text-foreground capitalize">{selectedCall.extractedData.intent}</p></div>
                  )}
                  {selectedCall.extractedData.budget && (
                    <div><p className="text-xs text-muted-foreground">Presupuesto</p><p className="font-medium text-foreground">{selectedCall.extractedData.budget}</p></div>
                  )}
                  {selectedCall.extractedData.urgency && (
                    <div><p className="text-xs text-muted-foreground">Urgencia</p><p className="font-medium text-foreground capitalize">{selectedCall.extractedData.urgency}</p></div>
                  )}
                  {selectedCall.extractedData.followUp && (
                    <div><p className="text-xs text-muted-foreground">Seguimiento</p><p className="font-medium text-primary">{format(new Date(selectedCall.extractedData.followUp), "d MMM yyyy", { locale: es })}</p></div>
                  )}
                </div>
              </div>

              {selectedCall.extractedData.agreements && selectedCall.extractedData.agreements.length > 0 && (
                <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
                  <h3 className="font-semibold text-foreground mb-3">✅ Acuerdos</h3>
                  <ul className="space-y-2">
                    {selectedCall.extractedData.agreements.map((a, i) => (
                      <li key={i} className="text-sm text-foreground flex items-start gap-2">
                        <CheckCircle2 size={14} className="text-success shrink-0 mt-0.5" />
                        {a}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {selectedCall.extractedData.objections && selectedCall.extractedData.objections.length > 0 && (
                <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
                  <h3 className="font-semibold text-foreground mb-3">⚠️ Objeciones</h3>
                  <ul className="space-y-2">
                    {selectedCall.extractedData.objections.map((o, i) => (
                      <li key={i} className="text-sm text-muted-foreground">{o}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Voice Agent */}
      <VoiceAgent onCallEnd={handleCallEnd} />

      {/* AI Summary from last call */}
      {(isSummarizing || lastCallSummary) && (
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <h3 className="font-semibold text-foreground mb-3">🤖 Resumen automático de última llamada</h3>
          {isSummarizing ? (
            <p className="text-sm text-muted-foreground animate-pulse">Analizando transcripción...</p>
          ) : (
            <div className="prose prose-sm text-foreground whitespace-pre-line text-sm leading-relaxed">
              {lastCallSummary}
            </div>
          )}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
          <p className="text-sm text-muted-foreground">Total llamadas</p>
          <p className="text-2xl font-bold text-foreground">{stats.total}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
          <p className="text-sm text-muted-foreground">Completadas</p>
          <p className="text-2xl font-bold text-success">{stats.completed}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
          <p className="text-sm text-muted-foreground">Perdidas</p>
          <p className="text-2xl font-bold text-destructive">{stats.missed}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
          <p className="text-sm text-muted-foreground">Duración promedio</p>
          <p className="text-2xl font-bold text-foreground">{formatDuration(stats.avgDuration)}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex-1 flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-2">
          <Search size={16} className="text-muted-foreground" />
          <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Buscar por nombre, número, agente..." className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setStatusFilter(null)} className={`text-xs px-3 py-1.5 rounded-md ${!statusFilter ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'}`}>Todas</button>
          {Object.entries(statusConfig).map(([key, val]) => (
            <button key={key} onClick={() => setStatusFilter(key)} className={`text-xs px-3 py-1.5 rounded-md ${statusFilter === key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'}`}>{val.label}</button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Estado</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Contacto</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Número</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Agente</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Duración</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Fecha</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Etiquetas</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(call => {
              const sc = statusConfig[call.status];
              const SIcon = sc.icon;
              return (
                <tr key={call.id} onClick={() => setSelectedCall(call)} className="border-b border-border last:border-b-0 hover:bg-secondary/30 cursor-pointer transition-colors">
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${sc.className}`}>
                      <SIcon size={12} /> {sc.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-medium text-foreground">{call.extractedData.contactName || '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground">{call.fromNumber}</td>
                  <td className="px-4 py-3 text-muted-foreground">{call.agentName}</td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDuration(call.duration)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{format(call.startedAt, 'd MMM HH:mm', { locale: es })}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      {call.tags.slice(0, 2).map(t => (
                        <span key={t} className="text-[10px] bg-secondary text-secondary-foreground px-1.5 py-0.5 rounded-full">{t}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3"><ChevronRight size={14} className="text-muted-foreground" /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Appointments section */}
      <div className="mt-8">
        <h2 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
          📅 Próximas citas
        </h2>
        <div className="grid grid-cols-3 gap-4">
          {mockAppointments.filter(a => a.status !== 'cancelled').map(apt => (
            <div key={apt.id} className="bg-card border border-border rounded-xl p-4 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold text-foreground">{apt.contactName}</h4>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  apt.status === 'confirmed' ? 'bg-success/10 text-success' :
                  apt.status === 'completed' ? 'bg-muted text-muted-foreground' :
                  'bg-primary/10 text-primary'
                }`}>{apt.status === 'scheduled' ? 'Agendada' : apt.status === 'confirmed' ? 'Confirmada' : 'Completada'}</span>
              </div>
              <p className="text-xs text-muted-foreground mb-1">{apt.serviceType}</p>
              <p className="text-xs text-foreground font-medium">
                {format(apt.startAt, "EEE d MMM, HH:mm", { locale: es })} - {format(apt.endAt, 'HH:mm')}
              </p>
              <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><User size={10} /> {apt.agentName}</span>
                <span className="capitalize">{apt.source === 'call' ? '📞' : apt.source === 'whatsapp' ? '💬' : '🖥️'} {apt.source}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default CallsPage;
