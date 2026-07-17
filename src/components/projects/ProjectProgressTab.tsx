import { useState } from 'react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Upload, Paperclip, Send, Trash2, MessageSquare, User as UserIcon, Calendar, Download } from 'lucide-react';
import { useProjectProgress } from '@/hooks/useProjectProgress';
import { useAuth } from '@/contexts/AuthContext';

interface Props { projectId: string; }

const ProjectProgressTab = ({ projectId }: Props) => {
  const { user } = useAuth();
  const { entries, loading, isSupervisor, createEntry, addObservation, deleteEntry, downloadAttachment } = useProjectProgress(projectId);
  const [comment, setComment] = useState('');
  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10));
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [obsDraft, setObsDraft] = useState<Record<string, string>>({});

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!comment.trim()) return;
    setSubmitting(true);
    const res = await createEntry(comment.trim(), entryDate, file);
    setSubmitting(false);
    if (res) {
      setComment('');
      setFile(null);
      setEntryDate(new Date().toISOString().slice(0, 10));
    }
  };

  const handleObservation = async (entryId: string) => {
    const text = (obsDraft[entryId] || '').trim();
    if (!text) return;
    await addObservation(entryId, text);
    setObsDraft((prev) => ({ ...prev, [entryId]: '' }));
  };

  return (
    <div className="space-y-4">
      {/* New entry form */}
      <form onSubmit={handleSubmit} className="bg-card rounded-2xl p-4 shadow-soft space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Nueva entrada de avance</h3>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Calendar size={12} />
            <input
              type="date"
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
              className="bg-transparent border border-border rounded-lg px-2 py-1 text-xs"
            />
          </div>
        </div>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={3}
          placeholder="Describe el avance del día, materiales usados, retos, etc."
          className="w-full bg-muted/40 border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer hover:text-foreground">
            <Paperclip size={14} />
            {file ? file.name : 'Adjuntar foto / PDF (opcional)'}
            <input type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </label>
          <button
            type="submit"
            disabled={submitting || !comment.trim()}
            className="inline-flex items-center gap-1.5 bg-primary text-primary-foreground text-xs font-semibold px-4 py-2 rounded-xl hover:opacity-90 disabled:opacity-40"
          >
            <Upload size={13} /> {submitting ? 'Enviando...' : 'Registrar avance'}
          </button>
        </div>
      </form>

      {/* Timeline */}
      {loading ? (
        <div className="text-center text-sm text-muted-foreground py-8">Cargando bitácora...</div>
      ) : entries.length === 0 ? (
        <div className="text-center text-sm text-muted-foreground py-12">
          Aún no hay entradas de avance. Sé el primero en registrar uno.
        </div>
      ) : (
        <ol className="relative border-l border-border ml-3 space-y-4">
          {entries.map((entry) => (
            <li key={entry.id} className="ml-4">
              <span className="absolute -left-1.5 mt-1.5 w-3 h-3 rounded-full bg-primary border-2 border-background" />
              <div className="bg-card rounded-2xl p-4 shadow-soft">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <UserIcon size={12} />
                      <span className="font-medium text-foreground">{entry.author_name || 'Empleado'}</span>
                      <span>·</span>
                      <span>{format(new Date(entry.entry_date), "d 'de' MMMM yyyy", { locale: es })}</span>
                      <span>·</span>
                      <span>{format(new Date(entry.created_at), 'HH:mm', { locale: es })}</span>
                    </div>
                    <p className="text-sm text-foreground mt-2 whitespace-pre-wrap">{entry.comment}</p>
                    {entry.attachment_path && (
                      <button
                        onClick={() => downloadAttachment(entry.attachment_path!)}
                        className="mt-2 inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                      >
                        <Download size={12} /> {entry.attachment_name || 'Adjunto'}
                      </button>
                    )}
                  </div>
                  {(entry.author_user_id === user?.id || isSupervisor) && (
                    <button
                      onClick={() => deleteEntry(entry.id)}
                      className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      title="Eliminar"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>

                {/* Observations */}
                {entry.observations.length > 0 && (
                  <div className="mt-3 space-y-2 border-t border-border pt-3">
                    {entry.observations.map((obs) => (
                      <div key={obs.id} className="bg-primary/5 border border-primary/10 rounded-xl px-3 py-2">
                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground mb-1">
                          <MessageSquare size={11} className="text-primary" />
                          <span className="font-medium text-primary">{obs.supervisor_name || 'Supervisor'}</span>
                          <span>·</span>
                          <span>{format(new Date(obs.created_at), "d MMM · HH:mm", { locale: es })}</span>
                        </div>
                        <p className="text-xs text-foreground whitespace-pre-wrap">{obs.observation}</p>
                      </div>
                    ))}
                  </div>
                )}

                {isSupervisor && (
                  <div className="mt-3 flex items-center gap-2">
                    <input
                      value={obsDraft[entry.id] || ''}
                      onChange={(e) => setObsDraft((p) => ({ ...p, [entry.id]: e.target.value }))}
                      placeholder="Agregar observación como supervisor..."
                      className="flex-1 bg-muted/40 border border-border rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
                      onKeyDown={(e) => { if (e.key === 'Enter') handleObservation(entry.id); }}
                    />
                    <button
                      onClick={() => handleObservation(entry.id)}
                      disabled={!(obsDraft[entry.id] || '').trim()}
                      className="p-1.5 rounded-lg bg-primary text-primary-foreground disabled:opacity-40"
                    >
                      <Send size={13} />
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
};

export default ProjectProgressTab;
