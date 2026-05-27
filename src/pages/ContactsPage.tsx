import { useState, useEffect, useCallback } from 'react';
import {
  Users, Plus, Search, Phone, MessageSquare, Calendar,
  Mail, Tag, Loader2, X, Edit3, Trash2, ChevronRight,
  Building2, Star, StarOff, Filter, Clock, CheckCircle2,
  ArrowUpRight, SlidersHorizontal,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { format, formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

interface Contact {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  company: string | null;
  notes: string | null;
  source: string | null;
  tags: string[] | null;
  starred: boolean | null;
  created_at: string;
  tenant_id: string;
  // computed
  appointmentCount?: number;
  lastInteraction?: string | null;
}

const SOURCE_COLORS: Record<string, string> = {
  whatsapp: 'bg-green-100 text-green-700',
  call: 'bg-blue-100 text-blue-700',
  manual: 'bg-slate-100 text-slate-600',
  'whatsapp-bot': 'bg-emerald-100 text-emerald-700',
  web: 'bg-violet-100 text-violet-700',
};

const SOURCE_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp',
  call: 'Llamada',
  manual: 'Manual',
  'whatsapp-bot': 'Bot WA',
  web: 'Web',
};

const emptyForm = {
  name: '',
  phone: '',
  email: '',
  company: '',
  notes: '',
  tags: '',
  starred: false,
};

export default function ContactsPage() {
  const { user } = useAuth();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStarred, setFilterStarred] = useState(false);
  const [filterSource, setFilterSource] = useState<string | null>(null);
  const [selected, setSelected] = useState<Contact | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const fetchContacts = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data: tid } = await supabase.rpc('get_user_tenant_id', { _user_id: user.id });
      if (!tid) return;
      setTenantId(tid);

      const { data, error } = await supabase
        .from('contacts')
        .select('*')
        .eq('tenant_id', tid)
        .order('starred', { ascending: false })
        .order('name', { ascending: true });

      if (error) throw error;
      setContacts((data || []) as Contact[]);
    } catch (err: any) {
      console.error('[Contacts] fetch error:', err);
      toast.error('Error al cargar contactos');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { fetchContacts(); }, [fetchContacts]);

  const filtered = contacts.filter(c => {
    const q = search.toLowerCase();
    const matchSearch = !q ||
      c.name?.toLowerCase().includes(q) ||
      c.phone?.includes(q) ||
      c.email?.toLowerCase().includes(q) ||
      c.company?.toLowerCase().includes(q) ||
      c.tags?.some(t => t.toLowerCase().includes(q));
    const matchStarred = !filterStarred || c.starred;
    const matchSource = !filterSource || c.source === filterSource;
    return matchSearch && matchStarred && matchSource;
  });

  const sources = [...new Set(contacts.map(c => c.source).filter(Boolean))];

  const handleSave = async () => {
    if (!form.name.trim() || !form.phone.trim()) {
      toast.error('Nombre y teléfono son obligatorios');
      return;
    }
    if (!tenantId) return;
    setSaving(true);
    try {
      const tagsArr = form.tags.split(',').map(t => t.trim()).filter(Boolean);
      const payload = {
        name: form.name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim() || null,
        company: form.company.trim() || null,
        notes: form.notes.trim() || null,
        tags: tagsArr.length ? tagsArr : null,
        starred: form.starred,
        source: 'manual',
      };

      if (editingId) {
        const { error } = await supabase
          .from('contacts')
          .update(payload)
          .eq('id', editingId)
          .eq('tenant_id', tenantId);
        if (error) throw error;
        toast.success('Contacto actualizado');
      } else {
        const { error } = await supabase
          .from('contacts')
          .insert({ ...payload, tenant_id: tenantId })
          ;
        if (error) throw error;
        toast.success('Contacto creado');
      }

      setShowForm(false);
      setEditingId(null);
      setForm(emptyForm);
      setSelected(null);
      fetchContacts();
    } catch (err: any) {
      toast.error(err.message || 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`¿Eliminar a "${name}"?`)) return;
    try {
      const { error } = await supabase
        .from('contacts')
        .delete()
        .eq('id', id)
        .eq('tenant_id', tenantId);
      if (error) throw error;
      toast.success('Contacto eliminado');
      setSelected(null);
      setContacts(prev => prev.filter(c => c.id !== id));
    } catch (err: any) {
      toast.error(err.message || 'Error al eliminar');
    }
  };

  const toggleStar = async (contact: Contact) => {
    try {
      const { error } = await supabase
        .from('contacts')
        .update({ starred: !contact.starred })
        .eq('id', contact.id);
      if (error) throw error;
      setContacts(prev => prev.map(c =>
        c.id === contact.id ? { ...c, starred: !c.starred } : c
      ));
      if (selected?.id === contact.id) {
        setSelected(prev => prev ? { ...prev, starred: !prev.starred } : null);
      }
    } catch (err: any) {
      toast.error('Error al actualizar');
    }
  };

  const openEdit = (contact: Contact) => {
    setForm({
      name: contact.name,
      phone: contact.phone,
      email: contact.email || '',
      company: contact.company || '',
      notes: contact.notes || '',
      tags: (contact.tags || []).join(', '),
      starred: contact.starred || false,
    });
    setEditingId(contact.id);
    setShowForm(true);
    setSelected(null);
  };

  const initials = (name: string) =>
    name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();

  const avatarColor = (name: string) => {
    const colors = [
      'bg-teal-500', 'bg-blue-500', 'bg-violet-500',
      'bg-rose-500', 'bg-amber-500', 'bg-cyan-500',
    ];
    return colors[name.charCodeAt(0) % colors.length];
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full py-24">
        <Loader2 size={28} className="animate-spin text-[var(--rx-brand)]" />
      </div>
    );
  }

  // ── Detail Panel ──
  if (selected) {
    return (
      <div className="flex h-full">
        {/* List panel */}
        <div className="w-full sm:w-80 shrink-0 border-r border-[var(--rx-b1)] flex flex-col hidden sm:flex">
          <div className="p-3 border-b border-[var(--rx-b1)]">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--rx-t2)]" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar..."
                className="w-full pl-9 pr-3 py-2 bg-[var(--rx-s2)]/50 rounded-xl text-sm border border-[var(--rx-b1)] focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {filtered.map(c => (
              <button
                key={c.id}
                onClick={() => setSelected(c)}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[var(--rx-s2)]/50 border-b border-[var(--rx-b1)] transition-colors ${selected?.id === c.id ? 'bg-primary/5 border-l-2 border-l-primary' : ''}`}
              >
                <div className={`w-9 h-9 rounded-full ${avatarColor(c.name)} flex items-center justify-center text-white text-xs font-bold shrink-0`}>
                  {initials(c.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{c.name}</p>
                  <p className="text-xs text-[var(--rx-t2)] truncate">{c.phone}</p>
                </div>
                {c.starred && <Star size={12} className="text-amber-400 fill-amber-400 shrink-0" />}
              </button>
            ))}
          </div>
        </div>

        {/* Detail */}
        <div className="flex-1 overflow-y-auto">
          <div className="rx-page">
            <div className="flex items-center gap-3 mb-6">
              <button
                onClick={() => setSelected(null)}
                className="sm:hidden flex items-center gap-1 text-sm text-[var(--rx-t2)] hover:text-foreground"
              >
                <X size={16} /> Volver
              </button>
            </div>

            {/* Header */}
            <div className="flex items-start gap-4 mb-6">
              <div className={`w-16 h-16 rounded-2xl ${avatarColor(selected.name)} flex items-center justify-center text-white text-xl font-bold shrink-0`}>
                {initials(selected.name)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="rx-page-title">{selected.name}</h1>
                  <button onClick={() => toggleStar(selected)}>
                    {selected.starred
                      ? <Star size={16} className="text-amber-400 fill-amber-400" />
                      : <StarOff size={16} className="text-[var(--rx-t2)]" />
                    }
                  </button>
                </div>
                {selected.company && (
                  <p className="text-sm text-[var(--rx-t2)] flex items-center gap-1 mt-0.5">
                    <Building2 size={12} /> {selected.company}
                  </p>
                )}
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  {selected.source && (
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${SOURCE_COLORS[selected.source] || 'bg-[var(--rx-s2)] text-[var(--rx-t2)]'}`}>
                      {SOURCE_LABELS[selected.source] || selected.source}
                    </span>
                  )}
                  <span className="text-[10px] text-[var(--rx-t2)]">
                    Añadido {formatDistanceToNow(new Date(selected.created_at), { locale: es, addSuffix: true })}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => openEdit(selected)}
                  className="p-2 rounded-xl hover:bg-[var(--rx-s2)] transition-colors"
                >
                  <Edit3 size={15} className="text-[var(--rx-t2)]" />
                </button>
                <button
                  onClick={() => handleDelete(selected.id, selected.name)}
                  className="p-2 rounded-xl hover:bg-destructive/10 transition-colors"
                >
                  <Trash2 size={15} className="text-[var(--rx-rose)]" />
                </button>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="grid grid-cols-3 gap-3 mb-6">
              {[
                { icon: Phone, label: 'Llamar', href: `tel:${selected.phone}`, color: 'text-blue-600 bg-blue-50' },
                { icon: MessageSquare, label: 'WhatsApp', href: `https://wa.me/${selected.phone.replace(/\D/g, '')}`, color: 'text-green-600 bg-green-50' },
                { icon: Mail, label: 'Email', href: `mailto:${selected.email}`, color: 'text-violet-600 bg-violet-50', disabled: !selected.email },
              ].map(action => (
                <a
                  key={action.label}
                  href={action.disabled ? undefined : action.href}
                  target={action.label !== 'Llamar' ? '_blank' : undefined}
                  rel="noreferrer"
                  className={`flex flex-col items-center gap-2 p-4 rounded-2xl border border-[var(--rx-b1)] transition-all ${action.disabled ? 'opacity-40 cursor-not-allowed' : 'hover:shadow-soft cursor-pointer'}`}
                >
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${action.color}`}>
                    <action.icon size={18} />
                  </div>
                  <span className="text-xs font-medium text-foreground">{action.label}</span>
                </a>
              ))}
            </div>

            {/* Info */}
            <div className="rx-panel">
              {[
                { label: 'Teléfono', value: selected.phone, icon: Phone },
                { label: 'Email', value: selected.email || '—', icon: Mail },
                { label: 'Empresa', value: selected.company || '—', icon: Building2 },
              ].map(row => (
                <div key={row.label} className="flex items-center gap-3 px-4 py-3">
                  <row.icon size={14} className="text-[var(--rx-t2)] shrink-0" />
                  <span className="text-xs text-[var(--rx-t2)] w-16 shrink-0">{row.label}</span>
                  <span className="text-sm text-foreground">{row.value}</span>
                </div>
              ))}
            </div>

            {/* Tags */}
            {selected.tags && selected.tags.length > 0 && (
              <div className="mb-4">
                <p className="text-xs font-semibold text-[var(--rx-t2)] uppercase tracking-wide mb-2">Etiquetas</p>
                <div className="flex flex-wrap gap-2">
                  {selected.tags.map(tag => (
                    <span key={tag} className="flex items-center gap-1 text-xs bg-[var(--rx-s2)] text-secondary-foreground px-2.5 py-1 rounded-full">
                      <Tag size={10} /> {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Notes */}
            {selected.notes && (
              <div className="rx-panel">
                <p className="text-xs font-semibold text-[var(--rx-t2)] uppercase tracking-wide mb-2">Notas</p>
                <p className="text-sm text-foreground whitespace-pre-wrap">{selected.notes}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Form ──
  if (showForm) {
    return (
      <div className="p-4 sm:p-6 max-w-lg mx-auto animate-fade-in">
        <div className="flex items-center justify-between mb-5">
          <h2 className="rx-page-title">
            {editingId ? 'Editar contacto' : 'Nuevo contacto'}
          </h2>
          <button onClick={() => { setShowForm(false); setEditingId(null); setForm(emptyForm); }}>
            <X size={18} className="text-[var(--rx-t2)]" />
          </button>
        </div>

        <div className="rx-panel">
          {[
            { key: 'name', label: 'Nombre *', placeholder: 'Juan García', type: 'text' },
            { key: 'phone', label: 'Teléfono *', placeholder: '+525512345678', type: 'tel' },
            { key: 'email', label: 'Email', placeholder: 'juan@empresa.com', type: 'email' },
            { key: 'company', label: 'Empresa', placeholder: 'Empresa S.A.', type: 'text' },
          ].map(field => (
            <div key={field.key}>
              <label className="text-xs font-semibold text-[var(--rx-t2)] uppercase tracking-wide">{field.label}</label>
              <input
                type={field.type}
                value={(form as any)[field.key]}
                onChange={e => setForm(p => ({ ...p, [field.key]: e.target.value }))}
                placeholder={field.placeholder}
                className="w-full mt-1 px-3 py-2 bg-[var(--rx-s2)]/50 rounded-xl text-sm border border-[var(--rx-b1)] focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          ))}

          <div>
            <label className="text-xs font-semibold text-[var(--rx-t2)] uppercase tracking-wide">Tags (separados por coma)</label>
            <input
              type="text"
              value={form.tags}
              onChange={e => setForm(p => ({ ...p, tags: e.target.value }))}
              placeholder="lead, cliente, vip"
              className="w-full mt-1 px-3 py-2 bg-[var(--rx-s2)]/50 rounded-xl text-sm border border-[var(--rx-b1)] focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-[var(--rx-t2)] uppercase tracking-wide">Notas</label>
            <textarea
              value={form.notes}
              onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
              rows={3}
              placeholder="Información adicional..."
              className="w-full mt-1 px-3 py-2 bg-[var(--rx-s2)]/50 rounded-xl text-sm border border-[var(--rx-b1)] focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.starred}
              onChange={e => setForm(p => ({ ...p, starred: e.target.checked }))}
              className="rounded"
            />
            <Star size={14} className="text-amber-400" />
            <span className="text-sm text-foreground">Marcar como favorito</span>
          </label>

          <div className="flex gap-3 pt-1">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 bg-[var(--rx-brand)] text-[var(--rx-brand)]-foreground text-sm font-semibold px-5 py-2.5 rounded-xl hover:opacity-90 disabled:opacity-50"
            >
              {saving && <Loader2 size={13} className="animate-spin" />}
              {saving ? 'Guardando...' : editingId ? 'Actualizar' : 'Crear contacto'}
            </button>
            <button
              onClick={() => { setShowForm(false); setEditingId(null); setForm(emptyForm); }}
              className="text-sm text-[var(--rx-t2)] hover:text-foreground"
            >
              Cancelar
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── List View ──
  return (
    <div className="rx-page">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Users size={20} className="text-[var(--rx-brand)]" /> Contactos
          </h1>
          <p className="text-sm text-[var(--rx-t2)] mt-0.5">
            {contacts.length} contacto{contacts.length !== 1 ? 's' : ''} · {filtered.length} mostrando
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-1.5 border text-sm px-3 py-2 rounded-xl transition-colors ${showFilters ? 'border-primary text-[var(--rx-brand)] bg-primary/5' : 'border-[var(--rx-b1)] hover:bg-[var(--rx-s2)]'}`}
          >
            <SlidersHorizontal size={14} /> Filtros
          </button>
          <button
            onClick={() => { setForm(emptyForm); setEditingId(null); setShowForm(true); }}
            className="flex items-center gap-1.5 bg-[var(--rx-brand)] text-[var(--rx-brand)]-foreground text-sm font-semibold px-4 py-2 rounded-xl hover:opacity-90"
          >
            <Plus size={14} /> Nuevo
          </button>
        </div>
      </div>

      {/* Search + Filters */}
      <div className="space-y-3 mb-5">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--rx-t2)]" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nombre, teléfono, empresa, tag..."
            className="w-full pl-9 pr-3 py-2.5 bg-[var(--rx-s2)]/50 rounded-xl text-sm border border-[var(--rx-b1)] focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>

        {showFilters && (
          <div className="flex flex-wrap items-center gap-2 p-3 bg-card border border-[var(--rx-b1)] rounded-xl">
            <button
              onClick={() => setFilterStarred(!filterStarred)}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-colors ${filterStarred ? 'bg-amber-50 border-amber-300 text-amber-700' : 'border-[var(--rx-b1)] text-[var(--rx-t2)] hover:border-amber-300'}`}
            >
              <Star size={11} /> Favoritos
            </button>
            {sources.map(source => (
              <button
                key={source}
                onClick={() => setFilterSource(filterSource === source ? null : source!)}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${filterSource === source ? 'bg-primary/10 border-primary text-[var(--rx-brand)]' : 'border-[var(--rx-b1)] text-[var(--rx-t2)] hover:border-primary'}`}
              >
                {SOURCE_LABELS[source!] || source}
              </button>
            ))}
            {(filterStarred || filterSource) && (
              <button
                onClick={() => { setFilterStarred(false); setFilterSource(null); }}
                className="text-xs text-[var(--rx-t2)] hover:text-foreground"
              >
                Limpiar
              </button>
            )}
          </div>
        )}
      </div>

      {/* Stats bar */}
      {contacts.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 mb-5">
          {[
            { label: 'Total', value: contacts.length, icon: Users },
            { label: 'Favoritos', value: contacts.filter(c => c.starred).length, icon: Star },
            { label: 'WhatsApp', value: contacts.filter(c => c.source === 'whatsapp' || c.source === 'whatsapp-bot').length, icon: MessageSquare },
            { label: 'Este mes', value: contacts.filter(c => new Date(c.created_at) > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)).length, icon: Clock },
          ].map(stat => (
            <div key={stat.label} className="rx-panel">
              <stat.icon size={14} className="text-[var(--rx-brand)] shrink-0" />
              <div>
                <div className="text-base font-bold text-foreground">{stat.value}</div>
                <div className="text-[10px] text-[var(--rx-t2)]">{stat.label}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Contact list */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Users size={40} className="text-[var(--rx-t2)]/20 mb-3" />
          <p className="text-sm font-medium text-[var(--rx-t2)] mb-1">
            {search || filterStarred || filterSource ? 'Sin resultados' : 'No hay contactos aún'}
          </p>
          {!search && !filterStarred && !filterSource && (
            <button
              onClick={() => { setForm(emptyForm); setShowForm(true); }}
              className="mt-3 flex items-center gap-1.5 bg-[var(--rx-brand)] text-[var(--rx-brand)]-foreground text-sm px-4 py-2 rounded-xl hover:opacity-90"
            >
              <Plus size={14} /> Agregar primer contacto
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(contact => (
            <div
              key={contact.id}
              onClick={() => setSelected(contact)}
              className="rx-panel"
            >
              <div className={`w-11 h-11 rounded-xl ${avatarColor(contact.name)} flex items-center justify-center text-white text-sm font-bold shrink-0`}>
                {initials(contact.name)}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-foreground truncate">{contact.name}</span>
                  {contact.starred && <Star size={11} className="text-amber-400 fill-amber-400 shrink-0" />}
                  {contact.source && (
                    <span className={`hidden sm:inline text-[10px] font-medium px-1.5 py-0.5 rounded-full ${SOURCE_COLORS[contact.source] || 'bg-[var(--rx-s2)] text-[var(--rx-t2)]'}`}>
                      {SOURCE_LABELS[contact.source] || contact.source}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="text-xs text-[var(--rx-t2)]">{contact.phone}</span>
                  {contact.company && (
                    <span className="hidden sm:flex items-center gap-1 text-xs text-[var(--rx-t2)]">
                      <Building2 size={10} /> {contact.company}
                    </span>
                  )}
                </div>
                {contact.tags && contact.tags.length > 0 && (
                  <div className="flex gap-1 mt-1.5 flex-wrap">
                    {contact.tags.slice(0, 3).map(tag => (
                      <span key={tag} className="text-[10px] bg-[var(--rx-s2)] text-secondary-foreground px-1.5 py-0.5 rounded-full">
                        {tag}
                      </span>
                    ))}
                    {contact.tags.length > 3 && (
                      <span className="text-[10px] text-[var(--rx-t2)]">+{contact.tags.length - 3}</span>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <a
                  href={`https://wa.me/${contact.phone.replace(/\D/g, '')}`}
                  target="_blank"
                  rel="noreferrer"
                  onClick={e => e.stopPropagation()}
                  className="p-2 rounded-lg hover:bg-green-50 text-[var(--rx-t2)] hover:text-green-600 transition-colors"
                >
                  <MessageSquare size={15} />
                </a>
                <a
                  href={`tel:${contact.phone}`}
                  onClick={e => e.stopPropagation()}
                  className="p-2 rounded-lg hover:bg-blue-50 text-[var(--rx-t2)] hover:text-blue-600 transition-colors"
                >
                  <Phone size={15} />
                </a>
                <ChevronRight size={15} className="text-[var(--rx-t2)]/40 group-hover:text-[var(--rx-t2)] transition-colors" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
