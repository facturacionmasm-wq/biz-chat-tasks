import { useState, useCallback } from 'react';
import { BookOpen, Search, Plus, Tag, User, Calendar, Lock, Globe, FileText, X, Upload, Loader2, Trash2, Edit3, Link, FileUp } from 'lucide-react';
import { knowledgeArticles as mockArticles } from '@/data/mockData';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface LocalArticle {
  id: string;
  title: string;
  content: string;
  category: string;
  tags: string[];
  isPublic: boolean;
  author: string;
  updatedAt: Date;
  syncedToElevenLabs?: boolean;
  elevenlabsDocId?: string;
}

const categoryColors: Record<string, string> = {
  'Procesos': 'bg-primary/10 text-primary',
  'Desarrollo': 'bg-accent text-accent-foreground',
  'Ventas': 'bg-warning/10 text-warning',
  'Seguridad': 'bg-destructive/10 text-destructive',
  'General': 'bg-muted text-muted-foreground',
};

const KnowledgePage = () => {
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedArticle, setSelectedArticle] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  // Form state
  const [formTitle, setFormTitle] = useState('');
  const [formContent, setFormContent] = useState('');
  const [formCategory, setFormCategory] = useState('General');
  const [formTags, setFormTags] = useState('');
  const [formVisibility, setFormVisibility] = useState<'internal' | 'external'>('internal');
  const [syncToElevenLabs, setSyncToElevenLabs] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [importUrl, setImportUrl] = useState('');
  const [showImportOptions, setShowImportOptions] = useState(false);

  // Use mock data as initial articles
  const [articles, setArticles] = useState<LocalArticle[]>(
    mockArticles.map(a => ({ ...a, syncedToElevenLabs: false }))
  );

  const categories = Array.from(new Set(articles.map(a => a.category)));
  const filtered = articles.filter(a =>
    (!selectedCategory || a.category === selectedCategory) &&
    (!search || a.title.toLowerCase().includes(search.toLowerCase()) || a.tags.some(t => t.includes(search.toLowerCase())))
  );

  const article = articles.find(a => a.id === selectedArticle);

  const openNewArticle = () => {
    setEditingId(null);
    setFormTitle('');
    setFormContent('');
    setFormCategory('General');
    setFormTags('');
    setFormVisibility('internal');
    setSyncToElevenLabs(true);
    setShowEditor(true);
  };

  const openEditArticle = (a: LocalArticle) => {
    setEditingId(a.id);
    setFormTitle(a.title);
    setFormContent(a.content);
    setFormCategory(a.category);
    setFormTags(a.tags.join(', '));
    setFormVisibility(a.isPublic ? 'external' : 'internal');
    setSyncToElevenLabs(true);
    setShowEditor(true);
  };

  const handleImportUrl = useCallback(async () => {
    if (!importUrl.trim()) return;
    setIsImporting(true);
    try {
      const { data, error } = await supabase.functions.invoke('firecrawl-scrape', {
        body: { url: importUrl },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Error al extraer contenido');

      if (data.title && !formTitle.trim()) setFormTitle(data.title);
      setFormContent(prev => prev ? `${prev}\n\n---\n\n${data.markdown}` : data.markdown);
      setImportUrl('');
      setShowImportOptions(false);
      toast.success('Contenido extraído de la URL');
    } catch (err: any) {
      console.error('URL import error:', err);
      toast.error('Error al importar URL: ' + (err.message || ''));
    } finally {
      setIsImporting(false);
    }
  }, [importUrl, formTitle]);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    try {
      const isPdf = file.name.toLowerCase().endsWith('.pdf');

      if (isPdf) {
        // Send PDF to edge function for parsing
        const formData = new FormData();
        formData.append('file', file);

        const res = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-pdf`,
          {
            method: 'POST',
            headers: {
              apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
              Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
            },
            body: formData,
          }
        );

        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Error al procesar PDF');
        }

        if (!formTitle.trim()) setFormTitle(data.title || file.name.replace(/\.pdf$/i, ''));
        setFormContent(prev => prev ? `${prev}\n\n---\n\n${data.content}` : data.content);
        toast.success(`PDF "${file.name}" importado y procesado con IA`);
      } else {
        // Text-based files
        const text = await file.text();
        if (!formTitle.trim()) {
          setFormTitle(file.name.replace(/\.[^/.]+$/, ''));
        }
        setFormContent(prev => prev ? `${prev}\n\n---\n\n${text}` : text);
        toast.success(`Archivo "${file.name}" importado`);
      }

      setShowImportOptions(false);
    } catch (err: any) {
      console.error('File import error:', err);
      toast.error('Error al importar: ' + (err.message || ''));
    } finally {
      setIsImporting(false);
      e.target.value = '';
    }
  }, [formTitle]);

  const saveArticle = useCallback(async () => {
    if (!formTitle.trim() || !formContent.trim()) {
      toast.error('Título y contenido son requeridos');
      return;
    }

    const tags = formTags.split(',').map(t => t.trim()).filter(Boolean);
    const now = new Date();

    const newArticle: LocalArticle = {
      id: editingId || crypto.randomUUID(),
      title: formTitle,
      content: formContent,
      category: formCategory,
      tags,
      isPublic: formVisibility === 'external',
      author: 'Tú',
      updatedAt: now,
      syncedToElevenLabs: false,
    };

    // Update local state
    if (editingId) {
      setArticles(prev => prev.map(a => a.id === editingId ? newArticle : a));
    } else {
      setArticles(prev => [newArticle, ...prev]);
    }

    toast.success(editingId ? 'Artículo actualizado' : 'Artículo creado');

    // Sync to ElevenLabs if enabled
    if (syncToElevenLabs) {
      setIsSyncing(true);
      try {
        const { data, error } = await supabase.functions.invoke('elevenlabs-kb-sync', {
          body: {
            action: 'add',
            data: {
              title: formTitle,
              content: `# ${formTitle}\n\nCategoría: ${formCategory}\nEtiquetas: ${tags.join(', ')}\n\n${formContent}`,
              knowledge_item_id: newArticle.id,
              tenant_id: null, // Would come from auth context
            },
          },
        });

        if (error) throw error;

        setArticles(prev => prev.map(a =>
          a.id === newArticle.id
            ? { ...a, syncedToElevenLabs: true, elevenlabsDocId: data?.elevenlabs_doc_id }
            : a
        ));

        toast.success('✅ Sincronizado con ElevenLabs Voice Agent');
      } catch (err: any) {
        console.error('Sync error:', err);
        toast.error('Error al sincronizar con ElevenLabs: ' + (err.message || ''));
      } finally {
        setIsSyncing(false);
      }
    }

    setShowEditor(false);
  }, [formTitle, formContent, formCategory, formTags, formVisibility, syncToElevenLabs, editingId]);

  // Article detail view
  if (article) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <button onClick={() => setSelectedArticle(null)} className="text-sm text-muted-foreground hover:text-foreground mb-4 inline-block">← Volver</button>
        <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${categoryColors[article.category] || 'bg-muted text-muted-foreground'}`}>{article.category}</span>
              {article.isPublic ? <Globe size={12} className="text-muted-foreground" /> : <Lock size={12} className="text-muted-foreground" />}
              {article.syncedToElevenLabs && (
                <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">🔗 ElevenLabs</span>
              )}
            </div>
            <button onClick={() => openEditArticle(article)} className="flex items-center gap-1 text-xs text-primary hover:underline">
              <Edit3 size={12} /> Editar
            </button>
          </div>
          <h1 className="text-xl font-bold text-foreground mb-2">{article.title}</h1>
          <div className="flex items-center gap-4 text-xs text-muted-foreground mb-4">
            <span className="flex items-center gap-1"><User size={12} /> {article.author}</span>
            <span className="flex items-center gap-1"><Calendar size={12} /> Actualizado {format(article.updatedAt, 'd MMM yyyy', { locale: es })}</span>
          </div>
          <div className="flex gap-1.5 mb-6">
            {article.tags.map(tag => (
              <span key={tag} className="text-xs bg-secondary text-secondary-foreground px-2 py-0.5 rounded-full flex items-center gap-1">
                <Tag size={10} /> {tag}
              </span>
            ))}
          </div>
          <div className="prose prose-sm text-foreground whitespace-pre-line">
            {article.content}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2"><BookOpen size={20} className="text-primary" /> Base de Conocimiento</h1>
          <p className="text-sm text-muted-foreground mt-1">{articles.length} artículos · Sincronizados con ElevenLabs Voice Agent</p>
        </div>
        <button onClick={openNewArticle} className="flex items-center gap-1.5 bg-primary text-primary-foreground text-sm font-medium px-4 py-2 rounded-lg hover:opacity-90">
          <Plus size={16} /> Nuevo Artículo
        </button>
      </div>

      {/* Search & filters */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-6">
        <div className="flex-1 flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-2">
          <Search size={16} className="text-muted-foreground" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar artículos, etiquetas..." className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
        </div>
        <div className="flex items-center gap-1 overflow-x-auto">
          <button onClick={() => setSelectedCategory(null)} className={`text-xs px-3 py-1.5 rounded-md ${!selectedCategory ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'}`}>Todos</button>
          {categories.map(cat => (
            <button key={cat} onClick={() => setSelectedCategory(cat)} className={`text-xs px-3 py-1.5 rounded-md ${selectedCategory === cat ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'}`}>{cat}</button>
          ))}
        </div>
      </div>

      {/* Syncing indicator */}
      {isSyncing && (
        <div className="flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-lg px-4 py-3 mb-4">
          <Loader2 size={16} className="text-primary animate-spin" />
          <p className="text-sm text-primary font-medium">Sincronizando con ElevenLabs Voice Agent...</p>
        </div>
      )}

      {/* Articles grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {filtered.map(a => (
          <button key={a.id} onClick={() => setSelectedArticle(a.id)} className="bg-card border border-border rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow text-left">
            <div className="flex items-center gap-2 mb-2">
              <FileText size={14} className="text-primary" />
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${categoryColors[a.category] || 'bg-muted text-muted-foreground'}`}>{a.category}</span>
              {!a.isPublic && <Lock size={10} className="text-muted-foreground" />}
              {a.syncedToElevenLabs && <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">🔗 EL</span>}
            </div>
            <h3 className="text-sm font-semibold text-foreground mb-1">{a.title}</h3>
            <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{a.content}</p>
            <div className="flex items-center justify-between">
              <div className="flex gap-1">
                {a.tags.slice(0, 3).map(tag => (
                  <span key={tag} className="text-[10px] bg-secondary text-secondary-foreground px-1.5 py-0.5 rounded-full">{tag}</span>
                ))}
              </div>
              <span className="text-[10px] text-muted-foreground">{format(a.updatedAt, 'd MMM', { locale: es })}</span>
            </div>
          </button>
        ))}
      </div>

      {/* Editor Modal */}
      {showEditor && (
        <div className="fixed inset-0 bg-foreground/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl shadow-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h2 className="text-lg font-bold text-foreground">{editingId ? 'Editar Artículo' : 'Nuevo Artículo'}</h2>
              <button onClick={() => setShowEditor(false)} className="text-muted-foreground hover:text-foreground">
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* Import section */}
              <div className="border border-dashed border-border rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium text-muted-foreground">Importar contenido</p>
                  <button
                    type="button"
                    onClick={() => setShowImportOptions(!showImportOptions)}
                    className="text-xs text-primary hover:underline"
                  >
                    {showImportOptions ? 'Ocultar' : 'Mostrar opciones'}
                  </button>
                </div>

                {!showImportOptions ? (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setShowImportOptions(true)}
                      className="flex-1 flex items-center justify-center gap-2 bg-secondary hover:bg-secondary/80 text-secondary-foreground text-sm py-2.5 rounded-lg transition-colors"
                    >
                      <Link size={14} /> Importar desde URL
                    </button>
                    <label className="flex-1 flex items-center justify-center gap-2 bg-secondary hover:bg-secondary/80 text-secondary-foreground text-sm py-2.5 rounded-lg transition-colors cursor-pointer">
                      <FileUp size={14} /> Subir archivo
                      <input type="file" accept=".txt,.md,.csv,.json,.xml,.html,.pdf" onChange={handleFileUpload} className="hidden" />
                    </label>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* URL import */}
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">URL de página web</label>
                      <div className="flex gap-2">
                        <div className="flex-1 flex items-center gap-2 bg-secondary rounded-lg px-3 py-2 border border-border focus-within:border-primary">
                          <Link size={14} className="text-muted-foreground shrink-0" />
                          <input
                            value={importUrl}
                            onChange={e => setImportUrl(e.target.value)}
                            placeholder="https://ejemplo.com/articulo"
                            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={handleImportUrl}
                          disabled={!importUrl.trim() || isImporting}
                          className="flex items-center gap-1.5 bg-primary text-primary-foreground text-sm px-3 py-2 rounded-lg hover:opacity-90 disabled:opacity-50"
                        >
                          {isImporting ? <Loader2 size={14} className="animate-spin" /> : <Globe size={14} />}
                          Extraer
                        </button>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1">Extrae automáticamente el contenido principal de la página</p>
                    </div>

                    {/* File upload */}
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">Archivo de texto</label>
                      <label className="flex items-center justify-center gap-2 bg-secondary hover:bg-secondary/80 text-secondary-foreground text-sm py-3 rounded-lg border border-dashed border-border cursor-pointer transition-colors">
                        <FileUp size={14} />
                        {isImporting ? 'Procesando...' : 'Arrastra o haz clic para subir (.txt, .md, .csv, .json, .html, .pdf)'}
                        <input type="file" accept=".txt,.md,.csv,.json,.xml,.html,.pdf" onChange={handleFileUpload} className="hidden" disabled={isImporting} />
                      </label>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Título</label>
                <input
                  value={formTitle}
                  onChange={e => setFormTitle(e.target.value)}
                  placeholder="Título del artículo..."
                  className="w-full bg-secondary rounded-lg px-3 py-2 text-sm outline-none border border-border focus:border-primary"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Contenido</label>
                <textarea
                  value={formContent}
                  onChange={e => setFormContent(e.target.value)}
                  placeholder="Escribe el contenido del artículo... El agente de voz usará esta información para responder preguntas."
                  rows={10}
                  className="w-full bg-secondary rounded-lg px-3 py-2 text-sm outline-none border border-border focus:border-primary resize-y"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Categoría</label>
                  <select
                    value={formCategory}
                    onChange={e => setFormCategory(e.target.value)}
                    className="w-full bg-secondary rounded-lg px-3 py-2 text-sm outline-none border border-border focus:border-primary"
                  >
                    <option>General</option>
                    <option>Procesos</option>
                    <option>Desarrollo</option>
                    <option>Ventas</option>
                    <option>Seguridad</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Visibilidad</label>
                  <select
                    value={formVisibility}
                    onChange={e => setFormVisibility(e.target.value as any)}
                    className="w-full bg-secondary rounded-lg px-3 py-2 text-sm outline-none border border-border focus:border-primary"
                  >
                    <option value="internal">🔒 Interno (equipo)</option>
                    <option value="external">🌐 Externo (clientes)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Etiquetas (separadas por coma)</label>
                <input
                  value={formTags}
                  onChange={e => setFormTags(e.target.value)}
                  placeholder="faq, precios, horarios..."
                  className="w-full bg-secondary rounded-lg px-3 py-2 text-sm outline-none border border-border focus:border-primary"
                />
              </div>

              {/* ElevenLabs sync toggle */}
              <div className="flex items-center gap-3 bg-primary/5 border border-primary/20 rounded-lg px-4 py-3">
                <input
                  type="checkbox"
                  id="sync-el"
                  checked={syncToElevenLabs}
                  onChange={e => setSyncToElevenLabs(e.target.checked)}
                  className="accent-primary"
                />
                <label htmlFor="sync-el" className="text-sm text-foreground cursor-pointer">
                  <span className="font-medium">Sincronizar con ElevenLabs Voice Agent</span>
                  <p className="text-xs text-muted-foreground mt-0.5">El agente de voz podrá usar este contenido para responder llamadas</p>
                </label>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
              <button onClick={() => setShowEditor(false)} className="text-sm text-muted-foreground hover:text-foreground px-4 py-2">
                Cancelar
              </button>
              <button
                onClick={saveArticle}
                disabled={!formTitle.trim() || !formContent.trim()}
                className="flex items-center gap-2 bg-primary text-primary-foreground text-sm font-medium px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50"
              >
                <Upload size={14} />
                {editingId ? 'Guardar cambios' : 'Crear artículo'}
                {syncToElevenLabs && ' + Sincronizar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default KnowledgePage;
