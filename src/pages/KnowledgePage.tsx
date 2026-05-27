import { useState, useEffect, useCallback } from 'react';
import {
  BookOpen, Search, Plus, Tag, Calendar, Lock, Globe,
  FileText, X, Upload, Loader2, Trash2, Edit3, Link as LinkIcon,
  RefreshCw, AlertCircle,
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

interface KnowledgeItem {
  id: string;
  title: string;
  content: string;
  category: string;
  tags: string[];
  visibility: 'internal' | 'external';
  active: boolean;
  author_id: string | null;
  created_at: string;
  updated_at: string;
  syncedToElevenLabs?: boolean;
  elevenlabs_doc_id?: string | null;
}

const CATEGORIES = ['General', 'Procesos', 'Ventas', 'Desarrollo', 'Seguridad', 'Entrenamiento IA', 'FAQ'];

const categoryColors: Record<string, string> = {
  'Procesos': 'bg-primary/10 text-[var(--rx-brand)]',
  'Desarrollo': 'bg-accent text-accent-foreground',
  'Ventas': 'bg-warning/10 text-[var(--rx-amber)]',
  'Seguridad': 'bg-destructive/10 text-[var(--rx-rose)]',
  'General': 'bg-[var(--rx-s2)] text-[var(--rx-t2)]',
  'FAQ': 'bg-[rgba(0,232,122,.1)] text-[var(--rx-emerald)]',
  'Entrenamiento IA': 'bg-purple-100 text-purple-700',
};

const emptyForm = {
  title: '',
  content: '',
  category: 'General',
  tags: '',
  visibility: 'internal' as 'internal' | 'external',
  syncToElevenLabs: true,
};

const KnowledgePage = () => {
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importUrl, setImportUrl] = useState('');
  const [showImportOptions, setShowImportOptions] = useState(false);
  const [articles, setArticles] = useState<KnowledgeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);

  // ── Fetch from Supabase ──
  const fetchArticles = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data: tenantId } = await supabase.rpc('get_user_tenant_id', { _user_id: user.id });
      if (!tenantId) { toast.error('No se pudo identificar tu empresa'); return; }

      const { data, error } = await supabase
        .from('knowledge_items')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('active', true)
        .is('deleted_at', null)
        .order('updated_at', { ascending: false });

      if (error) throw error;
      setArticles((data || []) as KnowledgeItem[]);
    } catch (err: any) {
      console.error('[Knowledge] fetch error:', err);
      toast.error('Error al cargar el Knowledge Hub');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { fetchArticles(); }, [fetchArticles]);

  const categories = Array.from(new Set(articles.map(a => a.category)));
  const filtered = articles.filter(a =>
    (!selectedCategory || a.category === selectedCategory) &&
    (!search || a.title.toLowerCase().includes(search.toLowerCase()) ||
      a.content?.toLowerCase().includes(search.toLowerCase()) ||
      a.tags?.some(t => t.toLowerCase().includes(search.toLowerCase())))
  );

  const selectedArticle = articles.find(a => a.id === selectedArticleId);

  // ── Save (create or update) ──
  const handleSave = async () => {
    if (!form.title.trim() || !form.content.trim()) {
      toast.error('El título y el contenido son obligatorios');
      return;
    }
    if (!user) return;
    setSaving(true);

    try {
      const { data: tenantId } = await supabase.rpc('get_user_tenant_id', { _user_id: user.id });
      if (!tenantId) throw new Error('No se pudo identificar tu empresa');

      const tagsArray = form.tags
        .split(',')
        .map(t => t.trim())
        .filter(Boolean);

      const payload = {
        title: form.title.trim(),
        content: form.content.trim(),
        category: form.category,
        tags: tagsArray,
        visibility: form.visibility,
        active: true,
      };

      if (editingId) {
        const { error } = await supabase
          .from('knowledge_items')
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq('id', editingId)
          .eq('tenant_id', tenantId);
        if (error) throw error;
        toast.success('Artículo actualizado');
      } else {
        const { data: newItem, error } = await supabase
          .from('knowledge_items')
          .insert({ ...payload, tenant_id: tenantId, author_id: user.id })
          .select('id')
          .single();
        if (error) throw error;

        // Sync to ElevenLabs if requested
        if (form.syncToElevenLabs && newItem?.id) {
          supabase.functions.invoke('elevenlabs-kb-sync', {
            body: { action: 'sync_item', item_id: newItem.id, tenant_id: tenantId },
          }).catch(e => console.error('[KB] ElevenLabs sync error:', e));
        }
        toast.success('Artículo creado');
      }

      setShowEditor(false);
      setEditingId(null);
      setForm(emptyForm);
      fetchArticles();
    } catch (err: any) {
      console.error('[Knowledge] save error:', err);
      toast.error(err.message || 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (article: KnowledgeItem) => {
    setForm({
      title: article.title,
      content: article.content,
      category: article.category,
      tags: (article.tags || []).join(', '),
      visibility: article.visibility,
      syncToElevenLabs: false,
    });
    setEditingId(article.id);
    setShowEditor(true);
    setSelectedArticleId(null);
  };

  const handleDelete = async (id: string, title: string) => {
    if (!confirm(`¿Eliminar "${title}"? Esta acción no se puede deshacer.`)) return;
    if (!user) return;

    try {
      const { data: tenantId } = await supabase.rpc('get_user_tenant_id', { _user_id: user.id });
      const { error } = await supabase
        .from('knowledge_items')
        .update({ active: false, deleted_at: new Date().toISOString() })
        .eq('id', id)
        .eq('tenant_id', tenantId);
      if (error) throw error;
      toast.success('Artículo eliminado');
      setSelectedArticleId(null);
      setArticles(prev => prev.filter(a => a.id !== id));
    } catch (err: any) {
      toast.error(err.message || 'Error al eliminar');
    }
  };

  const handleSyncAll = async () => {
    if (!user) return;
    setIsSyncing(true);
    try {
      const { data: tenantId } = await supabase.rpc('get_user_tenant_id', { _user_id: user.id });
      const { data, error } = await supabase.functions.invoke('elevenlabs-kb-sync', {
        body: { action: 'sync_all', tenant_id: tenantId },
      });
      if (error) throw error;
      toast.success(data?.message || 'Sincronización iniciada con ElevenLabs');
      fetchArticles();
    } catch (err: any) {
      toast.error(err.message || 'Error al sincronizar');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleImportUrl = async () => {
    if (!importUrl.trim()) return;
    setIsImporting(true);
    try {
      const { data, error } = await supabase.functions.invoke('firecrawl-scrape', {
        body: { url: importUrl.trim() },
      });
      if (error || !data?.content) throw new Error(error?.message || 'No se pudo obtener contenido');
      setForm(prev => ({
        ...prev,
        title: data.title || importUrl,
        content: data.content,
      }));
      setShowImportOptions(false);
      setImportUrl('');
      setShowEditor(true);
      toast.success('Contenido importado. Revísalo antes de guardar.');
    } catch (err: any) {
      toast.error(err.message || 'Error al importar URL');
    } finally {
      setIsImporting(false);
    }
  };

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsImporting(true);
    try {
      const text = await file.text();
      setForm(prev => ({
        ...prev,
        title: file.name.replace(/\.[^/.]+$/, ''),
        content: text,
      }));
      setShowImportOptions(false);
      setShowEditor(true);
      toast.success('Archivo cargado. Revísalo antes de guardar.');
    } catch {
      toast.error('Error al leer el archivo');
    } finally {
      setIsImporting(false);
      e.target.value = '';
    }
  };

  const openNewEditor = () => {
    setForm(emptyForm);
    setEditingId(null);
    setShowEditor(true);
    setSelectedArticleId(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full py-24">
        <Loader2 size={28} className="animate-spin text-[var(--rx-brand)]" />
      </div>
    );
  }

  // ── Article Detail View ──
  if (selectedArticle) {
    return (
      <div className="p-4 sm:p-6 max-w-4xl mx-auto animate-fade-in">
        <button
          onClick={() => setSelectedArticleId(null)}
          className="flex items-center gap-1.5 text-sm text-[var(--rx-t2)] hover:text-foreground mb-4 transition-colors"
        >
          <X size={14} /> Volver al listado
        </button>
        <div className="rx-panel">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div className="flex-1">
              <h1 className="rx-page-title">{selectedArticle.title}</h1>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${categoryColors[selectedArticle.category] || 'bg-[var(--rx-s2)] text-[var(--rx-t2)]'}`}>
                  {selectedArticle.category}
                </span>
                {selectedArticle.visibility === 'internal'
                  ? <Lock size={12} className="text-[var(--rx-t2)]" />
                  : <Globe size={12} className="text-[var(--rx-t2)]" />
                }
                <span className="text-xs text-[var(--rx-t2)]">
                  {format(new Date(selectedArticle.updated_at), "d MMM yyyy", { locale: es })}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => handleEdit(selectedArticle)}
                className="p-2 rounded-lg hover:bg-[var(--rx-s2)] transition-colors"
                title="Editar"
              >
                <Edit3 size={15} className="text-[var(--rx-t2)]" />
              </button>
              <button
                onClick={() => handleDelete(selectedArticle.id, selectedArticle.title)}
                className="p-2 rounded-lg hover:bg-destructive/10 transition-colors"
                title="Eliminar"
              >
                <Trash2 size={15} className="text-[var(--rx-rose)]" />
              </button>
            </div>
          </div>

          <div className="prose prose-sm max-w-none text-foreground whitespace-pre-wrap leading-relaxed">
            {selectedArticle.content}
          </div>

          {selectedArticle.tags?.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-4 pt-4 border-t border-[var(--rx-b1)]">
              {selectedArticle.tags.map(tag => (
                <span key={tag} className="flex items-center gap-1 text-xs bg-[var(--rx-s2)] text-secondary-foreground px-2 py-0.5 rounded-full">
                  <Tag size={10} /> {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Editor Modal ──
  if (showEditor) {
    return (
      <div className="p-4 sm:p-6 max-w-3xl mx-auto animate-fade-in">
        <div className="flex items-center justify-between mb-4">
          <h2 className="rx-page-title">
            {editingId ? 'Editar artículo' : 'Nuevo artículo'}
          </h2>
          <button
            onClick={() => { setShowEditor(false); setEditingId(null); setForm(emptyForm); }}
            className="p-1.5 rounded-lg hover:bg-[var(--rx-s2)] transition-colors"
          >
            <X size={18} className="text-[var(--rx-t2)]" />
          </button>
        </div>

        <div className="rx-panel">
          <div>
            <label className="text-xs font-semibold text-[var(--rx-t2)] uppercase tracking-wide">Título *</label>
            <input
              type="text"
              value={form.title}
              onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
              placeholder="Nombre del artículo"
              className="w-full mt-1 px-3 py-2 bg-[var(--rx-s2)]/50 rounded-xl text-sm border border-[var(--rx-b1)] focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-[var(--rx-t2)] uppercase tracking-wide">Categoría</label>
            <select
              value={form.category}
              onChange={e => setForm(p => ({ ...p, category: e.target.value }))}
              className="w-full mt-1 px-3 py-2 bg-[var(--rx-s2)]/50 rounded-xl text-sm border border-[var(--rx-b1)] focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold text-[var(--rx-t2)] uppercase tracking-wide">Contenido *</label>
            <textarea
              value={form.content}
              onChange={e => setForm(p => ({ ...p, content: e.target.value }))}
              placeholder="Escribe el contenido del artículo..."
              rows={10}
              className="w-full mt-1 px-3 py-2 bg-[var(--rx-s2)]/50 rounded-xl text-sm border border-[var(--rx-b1)] focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-[var(--rx-t2)] uppercase tracking-wide">
              Tags (separados por coma)
            </label>
            <input
              type="text"
              value={form.tags}
              onChange={e => setForm(p => ({ ...p, tags: e.target.value }))}
              placeholder="ventas, proceso, cliente"
              className="w-full mt-1 px-3 py-2 bg-[var(--rx-s2)]/50 rounded-xl text-sm border border-[var(--rx-b1)] focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer text-sm text-foreground">
              <input
                type="checkbox"
                checked={form.visibility === 'internal'}
                onChange={e => setForm(p => ({ ...p, visibility: e.target.checked ? 'internal' : 'external' }))}
                className="rounded"
              />
              <Lock size={14} /> Solo interno
            </label>

            {!editingId && (
              <label className="flex items-center gap-2 cursor-pointer text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={form.syncToElevenLabs}
                  onChange={e => setForm(p => ({ ...p, syncToElevenLabs: e.target.checked }))}
                  className="rounded"
                />
                Sincronizar con ElevenLabs
              </label>
            )}
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 bg-[var(--rx-brand)] text-[var(--rx-brand)]-foreground text-sm font-semibold px-5 py-2.5 rounded-xl hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : null}
              {saving ? 'Guardando...' : editingId ? 'Actualizar' : 'Crear artículo'}
            </button>
            <button
              onClick={() => { setShowEditor(false); setEditingId(null); setForm(emptyForm); }}
              className="text-sm text-[var(--rx-t2)] hover:text-foreground transition-colors"
            >
              Cancelar
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Main List View ──
  return (
    <div className="rx-page">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <BookOpen size={20} className="text-[var(--rx-brand)]" />
            Knowledge Hub
          </h1>
          <p className="text-sm text-[var(--rx-t2)] mt-0.5">
            {articles.length} artículo{articles.length !== 1 ? 's' : ''} · Base de conocimientos de la empresa
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowImportOptions(!showImportOptions)}
            className="flex items-center gap-1.5 border border-[var(--rx-b1)] text-sm px-3 py-2 rounded-xl hover:bg-[var(--rx-s2)] transition-colors"
          >
            <Upload size={14} /> Importar
          </button>
          <button
            onClick={handleSyncAll}
            disabled={isSyncing}
            className="flex items-center gap-1.5 border border-[var(--rx-b1)] text-sm px-3 py-2 rounded-xl hover:bg-[var(--rx-s2)] transition-colors disabled:opacity-50"
            title="Sincronizar todo con ElevenLabs"
          >
            <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={openNewEditor}
            className="flex items-center gap-1.5 bg-[var(--rx-brand)] text-[var(--rx-brand)]-foreground text-sm font-semibold px-4 py-2 rounded-xl hover:opacity-90"
          >
            <Plus size={14} /> Nuevo
          </button>
        </div>
      </div>

      {/* Import Options */}
      {showImportOptions && (
        <div className="rx-panel">
          <p className="text-sm font-semibold text-foreground">Importar contenido</p>
          <div className="flex gap-2">
            <input
              type="url"
              value={importUrl}
              onChange={e => setImportUrl(e.target.value)}
              placeholder="https://..."
              className="flex-1 px-3 py-2 bg-[var(--rx-s2)]/50 rounded-lg text-sm border border-[var(--rx-b1)] focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <button
              onClick={handleImportUrl}
              disabled={isImporting || !importUrl.trim()}
              className="flex items-center gap-1.5 bg-[var(--rx-brand)] text-[var(--rx-brand)]-foreground text-sm px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50"
            >
              {isImporting ? <Loader2 size={14} className="animate-spin" /> : <LinkIcon size={14} />}
              Importar URL
            </button>
          </div>
          <label className="flex items-center gap-2 cursor-pointer w-fit border border-dashed border-[var(--rx-b1)] rounded-lg px-4 py-2 hover:bg-[var(--rx-s2)] transition-colors text-sm text-[var(--rx-t2)]">
            <Upload size={14} /> Subir archivo de texto
            <input type="file" accept=".txt,.md,.csv" className="hidden" onChange={handleFileImport} />
          </label>
        </div>
      )}

      {/* Search + Filter */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--rx-t2)]" />
          <input
            type="text"
            placeholder="Buscar artículos..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-[var(--rx-s2)]/50 rounded-xl text-sm border border-[var(--rx-b1)] focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <button
            onClick={() => setSelectedCategory(null)}
            className={`shrink-0 text-xs px-3 py-1.5 rounded-full border transition-colors ${!selectedCategory ? 'bg-[var(--rx-brand)] text-[var(--rx-brand)]-foreground border-primary' : 'border-[var(--rx-b1)] text-[var(--rx-t2)] hover:border-primary'}`}
          >
            Todos
          </button>
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat === selectedCategory ? null : cat)}
              className={`shrink-0 text-xs px-3 py-1.5 rounded-full border transition-colors ${selectedCategory === cat ? 'bg-[var(--rx-brand)] text-[var(--rx-brand)]-foreground border-primary' : 'border-[var(--rx-b1)] text-[var(--rx-t2)] hover:border-primary'}`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Articles Grid */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          {search || selectedCategory ? (
            <>
              <Search size={36} className="text-[var(--rx-t2)]/30 mb-3" />
              <p className="text-sm text-[var(--rx-t2)]">No se encontraron artículos</p>
              <button onClick={() => { setSearch(''); setSelectedCategory(null); }} className="text-xs text-[var(--rx-brand)] mt-2 hover:underline">
                Limpiar filtros
              </button>
            </>
          ) : (
            <>
              <AlertCircle size={36} className="text-[var(--rx-t2)]/30 mb-3" />
              <p className="text-sm font-medium text-[var(--rx-t2)] mb-1">Knowledge Hub vacío</p>
              <p className="text-xs text-[var(--rx-t2)] mb-4">Agrega artículos para que tus agentes de IA tengan contexto</p>
              <button
                onClick={openNewEditor}
                className="flex items-center gap-1.5 bg-[var(--rx-brand)] text-[var(--rx-brand)]-foreground text-sm px-4 py-2 rounded-xl hover:opacity-90"
              >
                <Plus size={14} /> Crear primer artículo
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(article => (
            <div
              key={article.id}
              onClick={() => setSelectedArticleId(article.id)}
              className="rx-panel"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${categoryColors[article.category] || 'bg-[var(--rx-s2)] text-[var(--rx-t2)]'}`}>
                  {article.category}
                </span>
                <div className="flex items-center gap-1">
                  {article.visibility === 'internal'
                    ? <Lock size={11} className="text-[var(--rx-t2)]" />
                    : <Globe size={11} className="text-[var(--rx-t2)]" />
                  }
                </div>
              </div>
              <h3 className="text-sm font-semibold text-foreground mb-1 line-clamp-2">{article.title}</h3>
              <p className="text-xs text-[var(--rx-t2)] line-clamp-2 mb-3">
                {article.content?.substring(0, 120)}...
              </p>
              <div className="flex items-center justify-between">
                <div className="flex flex-wrap gap-1">
                  {(article.tags || []).slice(0, 2).map(tag => (
                    <span key={tag} className="text-[10px] bg-[var(--rx-s2)] text-secondary-foreground px-1.5 py-0.5 rounded-full">
                      {tag}
                    </span>
                  ))}
                </div>
                <span className="text-[10px] text-[var(--rx-t2)] flex items-center gap-1">
                  <Calendar size={9} />
                  {format(new Date(article.updated_at), "d MMM", { locale: es })}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default KnowledgePage;
