import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Plus, Eye, EyeOff, Copy, Trash2, Edit2, KeyRound, Globe, Search } from 'lucide-react';

interface Credential {
  id: string;
  platform_name: string;
  username: string;
  password_encrypted: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

const CredentialsPage = () => {
  const { user } = useAuth();
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ platform_name: '', username: '', password: '', notes: '' });

  const fetchCredentials = async () => {
    if (!user) return;
    const { data: profile } = await supabase
      .from('profiles')
      .select('tenant_id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (!profile) return;

    const { data, error } = await supabase
      .from('shared_credentials' as any)
      .select('*')
      .eq('tenant_id', profile.tenant_id)
      .order('created_at', { ascending: false });

    if (!error && data) setCredentials(data as any);
    setLoading(false);
  };

  useEffect(() => { fetchCredentials(); }, [user]);

  const handleSave = async () => {
    if (!form.platform_name || !form.username || !form.password) {
      toast.error('Plataforma, usuario y contraseña son requeridos');
      return;
    }

    try {
      const { data: result, error } = await supabase.functions.invoke('credential-vault', {
        body: {
          action: 'encrypt_save',
          id: editingId || undefined,
          platform_name: form.platform_name,
          username: form.username,
          password: form.password,
          notes: form.notes || null,
        },
      });
      if (error) throw error;
      if (result?.error) throw new Error(result.error);
      toast.success(editingId ? 'Credencial actualizada' : 'Credencial guardada');
    } catch (err: any) {
      toast.error(err.message || 'Error al guardar credencial');
      return;
    }

    setDialogOpen(false);
    setEditingId(null);
    setForm({ platform_name: '', username: '', password: '', notes: '' });
    fetchCredentials();
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('shared_credentials' as any).delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success('Credencial eliminada');
    fetchCredentials();
  };

  const handleEdit = (cred: Credential) => {
    setEditingId(cred.id);
    setForm({
      platform_name: cred.platform_name,
      username: cred.username,
      password: cred.password_encrypted,
      notes: cred.notes || '',
    });
    setDialogOpen(true);
  };

  const toggleReveal = async (id: string) => {
    if (revealedIds.has(id)) {
      setRevealedIds(prev => { const next = new Set(prev); next.delete(id); return next; });
      // Remove decrypted password from local state
      setCredentials(prev => prev.map(c => c.id === id ? { ...c, _decrypted: undefined } as any : c));
      return;
    }
    try {
      const { data: result, error } = await supabase.functions.invoke('credential-vault', {
        body: { action: 'decrypt', id },
      });
      if (error) throw error;
      if (result?.error) throw new Error(result.error);
      setCredentials(prev => prev.map(c => c.id === id ? { ...c, _decrypted: result.password } as any : c));
      setRevealedIds(prev => { const next = new Set(prev); next.add(id); return next; });
    } catch (err: any) {
      toast.error(err.message || 'Error al desencriptar');
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copiado al portapapeles`);
  };

  const filtered = credentials.filter(c =>
    c.platform_name.toLowerCase().includes(search.toLowerCase()) ||
    c.username.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <KeyRound className="text-[var(--rx-brand)]" size={24} />
            Credenciales Compartidas
          </h1>
          <p className="text-sm text-[var(--rx-t2)] mt-1">
            Credenciales de acceso a plataformas compartidas con todo el equipo
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) { setEditingId(null); setForm({ platform_name: '', username: '', password: '', notes: '' }); }
        }}>
          <DialogTrigger asChild>
            <Button className="gap-2"><Plus size={16} /> Agregar</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingId ? 'Editar Credencial' : 'Nueva Credencial'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-2">
              <div>
                <Label>Plataforma / Servicio</Label>
                <Input placeholder="Ej: Gmail, Hosting, CPanel..." value={form.platform_name} onChange={e => setForm({ ...form, platform_name: e.target.value })} />
              </div>
              <div>
                <Label>Usuario / Email</Label>
                <Input placeholder="usuario@ejemplo.com" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} />
              </div>
              <div>
                <Label>Contraseña</Label>
                <Input type="password" placeholder="••••••••" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
              </div>
              <div>
                <Label>Notas (opcional)</Label>
                <Input placeholder="URL de acceso, instrucciones..." value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
              </div>
              <Button onClick={handleSave} className="w-full">{editingId ? 'Actualizar' : 'Guardar'}</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Search */}
      <div className="relative w-full sm:max-w-sm">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--rx-t2)]" />
        <Input placeholder="Buscar plataforma..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {/* Credentials list */}
      {loading ? (
        <p className="text-[var(--rx-t2)] text-sm">Cargando...</p>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-[var(--rx-t2)]">
            <KeyRound size={48} className="mb-4 opacity-30" />
            <p className="text-lg font-medium">No hay credenciales guardadas</p>
            <p className="text-sm">Agrega una desde aquí o envíalas por WhatsApp al bot</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(cred => {
            const revealed = revealedIds.has(cred.id);
            return (
              <Card key={cred.id} className="group hover:border-primary/30 transition-colors">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <Globe size={16} className="text-[var(--rx-brand)] shrink-0" />
                      <CardTitle className="text-sm font-semibold">{cred.platform_name}</CardTitle>
                    </div>
                    <div className="flex gap-1 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                      <button onClick={() => handleEdit(cred)} className="p-1 rounded hover:bg-[var(--rx-s2)] text-[var(--rx-t2)] hover:text-foreground">
                        <Edit2 size={14} />
                      </button>
                      <button onClick={() => handleDelete(cred.id)} className="p-1 rounded hover:bg-destructive/10 text-[var(--rx-t2)] hover:text-[var(--rx-rose)]">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[var(--rx-t2)]">Usuario</span>
                    <div className="flex items-center gap-1">
                      <span className="text-sm font-mono">{cred.username}</span>
                      <button onClick={() => copyToClipboard(cred.username, 'Usuario')} className="p-0.5 text-[var(--rx-t2)] hover:text-foreground">
                        <Copy size={12} />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[var(--rx-t2)]">Contraseña</span>
                    <div className="flex items-center gap-1">
                      <span className="text-sm font-mono">
                        {revealed ? ((cred as any)._decrypted || cred.password_encrypted) : '••••••••'}
                      </span>
                      <button onClick={() => toggleReveal(cred.id)} className="p-0.5 text-[var(--rx-t2)] hover:text-foreground">
                        {revealed ? <EyeOff size={12} /> : <Eye size={12} />}
                      </button>
                      <button onClick={() => copyToClipboard(revealed ? ((cred as any)._decrypted || cred.password_encrypted) : cred.password_encrypted, 'Contraseña')} className="p-0.5 text-[var(--rx-t2)] hover:text-foreground">
                        <Copy size={12} />
                      </button>
                    </div>
                  </div>
                  {cred.notes && (
                    <p className="text-xs text-[var(--rx-t2)] border-t border-[var(--rx-b1)] pt-2 mt-2">{cred.notes}</p>
                  )}
                  <p className="text-[10px] text-[var(--rx-t2)]/60">{new Date(cred.created_at).toLocaleDateString('es-MX')}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default CredentialsPage;
