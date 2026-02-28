import { useState, useCallback, useEffect } from 'react';
import { Phone, PhoneIncoming, PhoneMissed, PhoneOff, Clock, User, Tag, Play, CalendarPlus, MessageSquare, ChevronRight, Search, Filter, ArrowLeft, CheckCircle2, Edit3, Save, RefreshCw } from 'lucide-react';
import { type CallRecord } from '@/data/mockCallsData';
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
  in_progress: { icon: Phone, label: 'En curso', className: 'text-primary bg-primary/10' },
  missed: { icon: PhoneMissed, label: 'Perdida', className: 'text-destructive bg-destructive/10' },
  busy: { icon: PhoneOff, label: 'Ocupado', className: 'text-warning bg-warning/10' },
  failed: { icon: PhoneOff, label: 'Fallida', className: 'text-destructive bg-destructive/10' },
  voicemail: { icon: Phone, label: 'Buzón', className: 'text-muted-foreground bg-muted' },
  pending: { icon: Clock, label: 'Pendiente', className: 'text-muted-foreground bg-muted' },
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

  // Subscribe to realtime updates on call_records
  useEffect(() => {
    const channel = supabase
      .channel('call_records_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'call_records' },
        () => {
          loadDbCalls();
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [loadDbCalls]);

  const handleCallEnd = useCallback(async (callRecordId: string) => {
    // Just reload - the VoiceAgent already saved everything
    await loadDbCalls();
    toast.success('Llamada finalizada y guardada');
  }, [loadDbCalls]);

  const allCalls = dbCalls;

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

  const handleSaveSummary = async () => {
    if (!selectedCall) return;
    const { error } = await supabase
      .from('call_records')
      .update({ summary_human: humanSummary })
      .eq('id', selectedCall.id);
    if (error) {
      toast.error('Error al guardar resumen');
    } else {
      toast.success('Resumen guardado');
      setSelectedCall({ ...selectedCall, summaryHuman: humanSummary });
      setEditingSummary(false);
      loadDbCalls();
    }
  };

  if (selectedCall) {
    const sc = statusConfig[selectedCall.status] || statusConfig.pending;
    return (
      <div className="flex flex-col h-full">
        <div className="shrink-0 border-b border-border p-5 bg-card">
          <button onClick={() => { setSelectedCall(null); setEditingSummary(false); }} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3">
            <ArrowLeft size={14} /> Volver a llamadas
          </button>
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <h2 className="text-xl font-bold text-foreground">{selectedCall.extractedData.contactName || selectedCall.fromNumber || 'Llamada'}</h2>
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
                      onClick={handleSaveSummary}
                      className="mt-2 flex items-center gap-1 bg-primary text-primary-foreground text-sm px-3 py-1.5 rounded-lg"
                    >
                      <Save size={12} /> Aprobar resumen
                    </button>
                  </div>
                ) : (
                  <div className="prose prose-sm text-foreground whitespace-pre-line text-sm leading-relaxed">
                    {selectedCall.summaryHuman || selectedCall.summarySystem || 'Sin resumen disponible'}
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
                      const isAgent = line.startsWith('Agente:');
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
                  {Object.keys(selectedCall.extractedData).length === 0 && (
                    <p className="text-muted-foreground text-xs">Sin datos extraídos</p>
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
          <input
            type="text"
            placeholder="Buscar llamadas..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="bg-transparent text-sm outline-none flex-1 text-foreground placeholder:text-muted-foreground"
          />
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setStatusFilter(null)}
            className={`text-xs px-3 py-1.5 rounded-full transition-colors ${!statusFilter ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
          >
            Todas
          </button>
          {Object.entries(statusConfig).filter(([k]) => ['completed', 'in_progress', 'missed'].includes(k)).map(([key, cfg]) => (
            <button
              key={key}
              onClick={() => setStatusFilter(statusFilter === key ? null : key)}
              className={`text-xs px-3 py-1.5 rounded-full transition-colors ${statusFilter === key ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
            >
              {cfg.label}
            </button>
          ))}
        </div>
        <button onClick={loadDbCalls} className="p-2 rounded-lg bg-muted hover:bg-muted/80 text-muted-foreground">
          <RefreshCw size={16} />
        </button>
      </div>

      {/* Call list */}
      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            <Phone size={32} className="mx-auto mb-2 opacity-50" />
            <p className="text-sm">No hay llamadas registradas</p>
            <p className="text-xs mt-1">Inicia una llamada con el Voice Agent para comenzar</p>
          </div>
        ) : (
          filtered.map(call => {
            const cfg = statusConfig[call.status] || statusConfig.pending;
            const StatusIcon = cfg.icon;
            return (
              <button
                key={call.id}
                onClick={() => setSelectedCall(call)}
                className="w-full flex items-center gap-4 px-5 py-4 hover:bg-muted/50 transition-colors border-b border-border last:border-b-0 text-left"
              >
                <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${cfg.className}`}>
                  <StatusIcon size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-foreground truncate">
                      {call.extractedData.contactName || call.fromNumber || 'Voice Agent'}
                    </span>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${cfg.className}`}>{cfg.label}</span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {call.summarySystem ? call.summarySystem.slice(0, 80) + '...' : call.transcript ? call.transcript.slice(0, 80) + '...' : 'Sin transcripción'}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs text-muted-foreground">{format(call.startedAt, "d MMM HH:mm", { locale: es })}</p>
                  <p className="text-xs text-muted-foreground">{formatDuration(call.duration)}</p>
                </div>
                <ChevronRight size={16} className="text-muted-foreground shrink-0" />
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};

export default CallsPage;
