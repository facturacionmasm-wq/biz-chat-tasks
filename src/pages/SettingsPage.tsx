import { useState, useEffect } from 'react';
import { Building2, Users, CreditCard, Bell, Database, Brain, Globe, ChevronRight, User, KeyRound, Loader2, Palette, Save, Upload, Image, X, Mail, Phone as PhoneIcon, MessageSquare, Trash2, Settings2, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { teamMembers } from '@/data/mockData';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';

const MODULE_PERMISSIONS = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'calls', label: 'Llamadas' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'appointments', label: 'Agenda' },
  { key: 'chat', label: 'Chat Interno' },
  { key: 'calendar', label: 'Calendario' },
  { key: 'projects', label: 'Proyectos' },
  { key: 'knowledge', label: 'Knowledge Hub' },
  { key: 'okrs', label: 'OKRs' },
  { key: 'ai_training', label: 'Entrenamiento IA' },
  { key: 'expenses', label: 'Gastos' },
  { key: 'integrations', label: 'Integraciones' },
  { key: 'audit', label: 'Auditoría' },
  { key: 'settings', label: 'Configuración' },
];

const settingsSections = [
  { id: 'profile', label: 'Mi Perfil', icon: User },
  { id: 'general', label: 'General', icon: Building2 },
  { id: 'branding', label: 'Branding', icon: Palette },
  { id: 'team', label: 'Equipo', icon: Users },
  { id: 'billing', label: 'Suscripción', icon: CreditCard },
  { id: 'notifications', label: 'Notificaciones', icon: Bell },
  { id: 'data', label: 'Datos y privacidad', icon: Database },
  { id: 'ai', label: 'IA y automatización', icon: Brain },
];

const plans = [
  { name: 'Basic', price: '$29/mes', features: ['5 usuarios', '3 proyectos', 'IA limitada', '1 integración'], current: false },
  { name: 'Pro', price: '$79/mes', features: ['25 usuarios', 'Proyectos ilimitados', 'IA completa', 'WhatsApp', 'Calendario'], current: true },
  { name: 'Enterprise', price: 'Contactar', features: ['Ilimitado', 'SSO/SAML', 'Auditoría avanzada', 'SLA dedicado'], current: false },
];

const SettingsPage = () => {
  const { user } = useAuth();
  const [activeSection, setActiveSection] = useState('profile');
  const [pin, setPin] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [savingPin, setSavingPin] = useState(false);

  // Profile state
  const [profileName, setProfileName] = useState('');
  const [profileEmail, setProfileEmail] = useState('');
  const [profilePhone, setProfilePhone] = useState('');
  const [profileWhatsapp, setProfileWhatsapp] = useState('');
  const [profileAvatarUrl, setProfileAvatarUrl] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileLoaded, setProfileLoaded] = useState(false);

  // General settings state
  const [orgName, setOrgName] = useState('');
  const [timezone, setTimezone] = useState('America/Mexico_City');
  const [savingGeneral, setSavingGeneral] = useState(false);

  // Branding state
  const [primaryColor, setPrimaryColor] = useState('#6366f1');
  const [secondaryColor, setSecondaryColor] = useState('#8b5cf6');
  const [companySlogan, setCompanySlogan] = useState('');
  const [companyWebsite, setCompanyWebsite] = useState('');
  const [companyPhone, setCompanyPhone] = useState('');
  const [companyAddress, setCompanyAddress] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [faviconUrl, setFaviconUrl] = useState('');
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingFavicon, setUploadingFavicon] = useState(false);
  const [savingBranding, setSavingBranding] = useState(false);

  // Team state
  const [teamData, setTeamData] = useState<Array<{ user_id: string; name: string; email: string; role: string; status: string; permissions: Record<string, boolean>; confirmed: boolean }>>([]);
  const [teamLoading, setTeamLoading] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitePassword, setInvitePassword] = useState('');
  const [inviting, setInviting] = useState(false);

  // Load tenant data
  useEffect(() => {
    if (!user) return;
    const load = async () => {
      // Load profile data
      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id, name, email, phone, whatsapp_number, avatar_url')
        .eq('user_id', user.id)
        .maybeSingle();
      if (!profile) return;

      setProfileName(profile.name || '');
      setProfileEmail(profile.email || user.email || '');
      setProfilePhone(profile.phone || '');
      setProfileWhatsapp(profile.whatsapp_number || '');
      setProfileAvatarUrl(profile.avatar_url || '');
      setProfileLoaded(true);

      const { data: tenant } = await supabase
        .from('tenants')
        .select('name, timezone, settings_json')
        .eq('id', profile.tenant_id)
        .maybeSingle();
      if (tenant) {
        setOrgName(tenant.name || '');
        setTimezone(tenant.timezone || 'America/Mexico_City');
        const settings = (tenant.settings_json || {}) as Record<string, any>;
        setPrimaryColor(settings.primary_color || '#6366f1');
        setSecondaryColor(settings.secondary_color || '#8b5cf6');
        setCompanySlogan(settings.slogan || '');
        setCompanyWebsite(settings.website || '');
        setCompanyPhone(settings.phone || '');
        setCompanyAddress(settings.address || '');
        setLogoUrl(settings.logo_url || '');
        setFaviconUrl(settings.favicon_url || '');
      }
    };
    load();
  }, [user]);

  // Load team members from DB
  useEffect(() => {
    if (!user || activeSection !== 'team') return;
    const loadTeam = async () => {
      setTeamLoading(true);
      try {
        const { data: myProfile } = await supabase.from('profiles').select('tenant_id').eq('user_id', user.id).maybeSingle();
        if (!myProfile) return;
        const tenantId = myProfile.tenant_id;
        const { data: myRole } = await supabase.from('user_roles').select('role').eq('user_id', user.id).eq('tenant_id', tenantId).maybeSingle();
        setIsSuperAdmin(myRole?.role === 'super_admin' || myRole?.role === 'owner');
        const { data: profiles } = await supabase.from('profiles').select('user_id, name, email, status').eq('tenant_id', tenantId);
        const { data: roles } = await supabase.from('user_roles').select('user_id, role, permissions_json').eq('tenant_id', tenantId);
        const roleMap = new Map((roles || []).map(r => [r.user_id, { role: r.role, permissions: r.permissions_json }]));

        // Get confirmation statuses
        let confirmMap: Record<string, boolean> = {};
        try {
          const { data: statusData } = await supabase.functions.invoke('team-management', {
            body: { action: 'list_status' },
          });
          if (statusData?.statuses) {
            for (const [uid, info] of Object.entries(statusData.statuses)) {
              confirmMap[uid] = (info as any).confirmed;
            }
          }
        } catch {}

        setTeamData((profiles || []).map(p => {
          const roleData = roleMap.get(p.user_id);
          const perms = (roleData?.permissions as Record<string, boolean>) || {};
          return {
            user_id: p.user_id,
            name: p.name || '',
            email: p.email || '',
            role: roleData?.role || 'staff',
            status: p.status || 'active',
            permissions: perms,
            confirmed: confirmMap[p.user_id] ?? true,
          };
        }));
      } finally {
        setTeamLoading(false);
      }
    };
    loadTeam();
  }, [user, activeSection]);

  const handleTogglePermission = async (targetUserId: string, moduleKey: string, currentValue: boolean) => {
    try {
      const tenantId = await getTenantId();
      const member = teamData.find(m => m.user_id === targetUserId);
      if (!member) return;
      const newPerms = { ...member.permissions, [moduleKey]: !currentValue };
      const { error } = await supabase
        .from('user_roles')
        .update({ permissions_json: newPerms } as any)
        .eq('user_id', targetUserId)
        .eq('tenant_id', tenantId);
      if (error) throw error;
      setTeamData(prev => prev.map(m => m.user_id === targetUserId ? { ...m, permissions: newPerms } : m));
    } catch (err: any) {
      toast.error(err.message || 'Error al cambiar permiso');
    }
  };

  const handleDeleteMember = async (targetUserId: string) => {
    if (!user || targetUserId === user.id) return;
    if (!confirm('¿Estás seguro de eliminar este miembro del equipo?')) return;
    setDeletingUserId(targetUserId);
    try {
      const { data: myProfile } = await supabase.from('profiles').select('tenant_id').eq('user_id', user.id).maybeSingle();
      if (!myProfile) throw new Error('Perfil no encontrado');
      await supabase.from('user_roles').delete().eq('user_id', targetUserId).eq('tenant_id', myProfile.tenant_id);
      await supabase.from('profiles').delete().eq('user_id', targetUserId);
      setTeamData(prev => prev.filter(m => m.user_id !== targetUserId));
      toast.success('Miembro eliminado');
    } catch (err: any) {
      toast.error(err.message || 'Error al eliminar miembro');
    } finally {
      setDeletingUserId(null);
    }
  };

  const handleInviteMember = async () => {
    if (!inviteName.trim() || !inviteEmail.trim()) {
      toast.error('Nombre y email son requeridos');
      return;
    }
    if (invitePassword && invitePassword.length > 0 && invitePassword.length < 6) {
      toast.error('La contraseña debe tener al menos 6 caracteres');
      return;
    }
    setInviting(true);
    try {
      const body: any = { email: inviteEmail.trim(), name: inviteName.trim() };
      if (invitePassword.length >= 6) body.password = invitePassword;
      const { data, error } = await supabase.functions.invoke('invite-member', {
        body,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(data?.message || 'Miembro invitado exitosamente');
      setShowInviteModal(false);
      setInviteName('');
      setInviteEmail('');
      setInvitePassword('');
      // Reload team
      const { data: myProfile } = await supabase.from('profiles').select('tenant_id').eq('user_id', user!.id).maybeSingle();
      if (myProfile) {
        const tenantId = myProfile.tenant_id;
        const { data: profiles } = await supabase.from('profiles').select('user_id, name, email, status').eq('tenant_id', tenantId);
        const { data: roles } = await supabase.from('user_roles').select('user_id, role, permissions_json').eq('tenant_id', tenantId);
        const roleMap = new Map((roles || []).map(r => [r.user_id, { role: r.role, permissions: r.permissions_json }]));
        setTeamData((profiles || []).map(p => {
          const roleData = roleMap.get(p.user_id);
          const perms = (roleData?.permissions as Record<string, boolean>) || {};
          return { user_id: p.user_id, name: p.name || '', email: p.email || '', role: roleData?.role || 'staff', status: p.status || 'active', permissions: perms, confirmed: false };
        }));
      }
    } catch (err: any) {
      toast.error(err.message || 'Error al invitar miembro');
    } finally {
      setInviting(false);
    }
  };

  const [resendingUserId, setResendingUserId] = useState<string | null>(null);

  const handleResendInvite = async (targetUserId: string, targetEmail: string) => {
    setResendingUserId(targetUserId);
    try {
      const { data, error } = await supabase.functions.invoke('team-management', {
        body: { action: 'resend_invite', user_id: targetUserId, email: targetEmail },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success('Invitación reenviada');
    } catch (err: any) {
      toast.error(err.message || 'Error al reenviar invitación');
    } finally {
      setResendingUserId(null);
    }
  };

  const handleSaveProfile = async () => {
    if (!profileName.trim()) { toast.error('El nombre es obligatorio'); return; }
    setSavingProfile(true);
    try {
      if (!user) throw new Error('No autenticado');
      const { error } = await supabase
        .from('profiles')
        .update({
          name: profileName.trim(),
          email: profileEmail.trim(),
          phone: profilePhone.trim(),
          whatsapp_number: profileWhatsapp.trim(),
        } as any)
        .eq('user_id', user.id);
      if (error) throw error;
      toast.success('Perfil actualizado correctamente');
    } catch (err: any) {
      toast.error(err.message || 'Error al guardar perfil');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleUploadFile = async (file: File, type: 'logo' | 'favicon') => {
    const setUploading = type === 'logo' ? setUploadingLogo : setUploadingFavicon;
    setUploading(true);
    try {
      const tenantId = await getTenantId();
      const ext = file.name.split('.').pop();
      const path = `${tenantId}/${type}.${ext}`;

      // Remove old file first
      await supabase.storage.from('branding').remove([path]);

      const { error } = await supabase.storage.from('branding').upload(path, file, { upsert: true });
      if (error) throw error;

      const { data: urlData } = supabase.storage.from('branding').getPublicUrl(path);
      const publicUrl = urlData.publicUrl + '?t=' + Date.now();

      if (type === 'logo') setLogoUrl(publicUrl);
      else setFaviconUrl(publicUrl);

      // Save URL to settings_json
      const { data: tenant } = await supabase.from('tenants').select('settings_json').eq('id', tenantId).maybeSingle();
      const current = ((tenant?.settings_json || {}) as Record<string, any>);
      const updated = { ...current, [`${type}_url`]: publicUrl };
      await supabase.from('tenants').update({ settings_json: updated } as any).eq('id', tenantId);

      toast.success(`${type === 'logo' ? 'Logo' : 'Favicon'} subido correctamente`);
    } catch (err: any) {
      toast.error(err.message || `Error al subir ${type}`);
    } finally {
      setUploading(false);
    }
  };

  const getTenantId = async () => {
    if (!user) throw new Error('No autenticado');
    const { data } = await supabase.from('profiles').select('tenant_id').eq('user_id', user.id).maybeSingle();
    if (!data) throw new Error('Perfil no encontrado');
    return data.tenant_id;
  };

  const handleSaveGeneral = async () => {
    setSavingGeneral(true);
    try {
      const tenantId = await getTenantId();
      const { error } = await supabase
        .from('tenants')
        .update({ name: orgName, timezone } as any)
        .eq('id', tenantId);
      if (error) throw error;
      toast.success('Configuración general guardada');
    } catch (err: any) {
      toast.error(err.message || 'Error al guardar');
    } finally {
      setSavingGeneral(false);
    }
  };

  const handleSaveBranding = async () => {
    setSavingBranding(true);
    try {
      const tenantId = await getTenantId();
      const { data: tenant } = await supabase.from('tenants').select('settings_json').eq('id', tenantId).maybeSingle();
      const current = ((tenant?.settings_json || {}) as Record<string, any>);
      const updated = {
        ...current,
        primary_color: primaryColor,
        secondary_color: secondaryColor,
        slogan: companySlogan,
        website: companyWebsite,
        phone: companyPhone,
        address: companyAddress,
        logo_url: logoUrl,
        favicon_url: faviconUrl,
      };
      const { error } = await supabase
        .from('tenants')
        .update({ settings_json: updated } as any)
        .eq('id', tenantId);
      if (error) throw error;
      toast.success('Branding guardado correctamente');
    } catch (err: any) {
      toast.error(err.message || 'Error al guardar branding');
    } finally {
      setSavingBranding(false);
    }
  };

  const inputClass = "w-full bg-secondary rounded-lg px-3 py-2 text-sm outline-none border border-border focus:border-primary text-foreground placeholder:text-muted-foreground";

  return (
    <div className="flex h-full">
      {/* Settings sidebar */}
      <div className="w-56 shrink-0 border-r border-border bg-card p-3">
        <h2 className="text-sm font-semibold text-foreground px-3 mb-3">Configuración</h2>
        <div className="space-y-0.5">
          {settingsSections.map(s => (
            <button
              key={s.id}
              onClick={() => setActiveSection(s.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors ${
                activeSection === s.id ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
              }`}
            >
              <s.icon size={16} />
              <span>{s.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 p-6 overflow-auto">
        {activeSection === 'profile' && (
          <div className="max-w-2xl">
            <h3 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
              <User size={20} className="text-primary" /> Mi Perfil
            </h3>
            <div className="space-y-4">
              {/* Personal data */}
              <div className="bg-card border border-border rounded-xl p-5">
                <h4 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-4">
                  <User size={16} className="text-primary" /> Datos personales
                </h4>
                {!profileLoaded ? (
                  <div className="flex items-center justify-center py-6"><Loader2 size={20} className="animate-spin text-muted-foreground" /></div>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1 block">Nombre completo</label>
                      <input className={inputClass} value={profileName} onChange={e => setProfileName(e.target.value)} placeholder="Tu nombre" maxLength={100} />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1 block">Email</label>
                      <div className="flex items-center gap-2">
                        <Mail size={14} className="text-muted-foreground shrink-0" />
                        <input className={inputClass} value={profileEmail} onChange={e => setProfileEmail(e.target.value)} placeholder="tu@email.com" type="email" maxLength={255} />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1 block">Teléfono</label>
                      <div className="flex items-center gap-2">
                        <PhoneIcon size={14} className="text-muted-foreground shrink-0" />
                        <input className={inputClass} value={profilePhone} onChange={e => setProfilePhone(e.target.value)} placeholder="+52 55 1234 5678" maxLength={20} />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1 block">Número de WhatsApp</label>
                      <div className="flex items-center gap-2">
                        <MessageSquare size={14} className="text-muted-foreground shrink-0" />
                        <input className={inputClass} value={profileWhatsapp} onChange={e => setProfileWhatsapp(e.target.value)} placeholder="+52 55 1234 5678" maxLength={20} />
                      </div>
                    </div>
                    <button
                      disabled={savingProfile || !profileName.trim()}
                      onClick={handleSaveProfile}
                      className="bg-primary text-primary-foreground text-sm px-5 py-2.5 rounded-lg hover:opacity-90 disabled:opacity-40 flex items-center gap-2 font-medium mt-1"
                    >
                      {savingProfile ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                      Guardar datos
                    </button>
                  </div>
                )}
              </div>

              <div className="bg-card border border-border rounded-xl p-5">
                <h4 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-3">
                  <KeyRound size={16} className="text-warning" /> PIN de autenticación WhatsApp
                </h4>
                <p className="text-xs text-muted-foreground mb-4">
                  Este PIN te permite autenticarte como empleado a través del asistente de WhatsApp.
                  Debe ser un número de 4 a 6 dígitos que recuerdes fácilmente.
                </p>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">Nuevo PIN</label>
                    <input type="password" value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="Ej: 1234" maxLength={6} className={inputClass} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">Confirmar PIN</label>
                    <input type="password" value={pinConfirm} onChange={e => setPinConfirm(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="Repite tu PIN" maxLength={6} className={inputClass} />
                  </div>
                  <button
                    disabled={savingPin || pin.length < 4 || pin !== pinConfirm}
                    onClick={async () => {
                      if (pin !== pinConfirm) { toast.error('Los PINs no coinciden'); return; }
                      if (pin.length < 4) { toast.error('El PIN debe tener al menos 4 dígitos'); return; }
                      setSavingPin(true);
                      try {
                        const encoder = new TextEncoder();
                        const data = encoder.encode(pin);
                        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
                        const hashArray = Array.from(new Uint8Array(hashBuffer));
                        const pinHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
                        if (!user) throw new Error('No autenticado');
                        const { error } = await supabase.from('profiles').update({ pin_hash: pinHash } as any).eq('user_id', user.id);
                        if (error) throw error;
                        toast.success('PIN guardado correctamente');
                        setPin(''); setPinConfirm('');
                      } catch (err: any) {
                        toast.error(err.message || 'Error al guardar PIN');
                      } finally { setSavingPin(false); }
                    }}
                    className="bg-primary text-primary-foreground text-sm px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-40 flex items-center gap-2"
                  >
                    {savingPin && <Loader2 size={14} className="animate-spin" />}
                    <Save size={14} /> Guardar PIN
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeSection === 'general' && (
          <div className="max-w-2xl">
            <h3 className="text-lg font-bold text-foreground mb-4">Configuración General</h3>
            <div className="space-y-4">
              <div className="bg-card border border-border rounded-xl p-4">
                <label className="text-sm font-medium text-foreground block mb-1">Nombre de la organización</label>
                <input className={inputClass} value={orgName} onChange={e => setOrgName(e.target.value)} placeholder="Mi Empresa" />
              </div>
              <div className="bg-card border border-border rounded-xl p-4">
                <label className="text-sm font-medium text-foreground block mb-1">Zona horaria</label>
                <select className={inputClass} value={timezone} onChange={e => setTimezone(e.target.value)}>
                  <option value="America/Mexico_City">América/México_City (UTC-6)</option>
                  <option value="America/Bogota">América/Bogotá (UTC-5)</option>
                  <option value="America/Argentina/Buenos_Aires">América/Buenos_Aires (UTC-3)</option>
                  <option value="Europe/Madrid">Europa/Madrid (UTC+1)</option>
                </select>
              </div>
              <button
                disabled={savingGeneral}
                onClick={handleSaveGeneral}
                className="bg-primary text-primary-foreground text-sm px-5 py-2.5 rounded-lg hover:opacity-90 disabled:opacity-40 flex items-center gap-2 font-medium"
              >
                {savingGeneral ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Guardar cambios
              </button>
            </div>
          </div>
        )}

        {activeSection === 'branding' && (
          <div className="max-w-2xl">
            <h3 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
              <Palette size={20} className="text-primary" /> Branding de la empresa
            </h3>
            <div className="space-y-4">
              {/* Logo & Favicon */}
              <div className="bg-card border border-border rounded-xl p-5">
                <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2"><Image size={16} /> Logo y Favicon</h4>
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-2 block">Logo de la empresa</label>
                    <div className="border-2 border-dashed border-border rounded-xl p-4 flex flex-col items-center justify-center gap-2 min-h-[120px] relative">
                      {logoUrl ? (
                        <>
                          <img src={logoUrl} alt="Logo" className="max-h-20 max-w-full object-contain rounded" />
                          <button onClick={() => { setLogoUrl(''); }} className="absolute top-2 right-2 p-1 rounded-full bg-destructive/10 text-destructive hover:bg-destructive/20"><X size={12} /></button>
                        </>
                      ) : (
                        <>
                          <Upload size={24} className="text-muted-foreground" />
                          <p className="text-xs text-muted-foreground">PNG, JPG o SVG</p>
                        </>
                      )}
                      <label className="text-xs text-primary cursor-pointer hover:underline font-medium">
                        {uploadingLogo ? <Loader2 size={14} className="animate-spin inline" /> : (logoUrl ? 'Cambiar' : 'Subir logo')}
                        <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleUploadFile(f, 'logo'); }} />
                      </label>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-2 block">Favicon</label>
                    <div className="border-2 border-dashed border-border rounded-xl p-4 flex flex-col items-center justify-center gap-2 min-h-[120px] relative">
                      {faviconUrl ? (
                        <>
                          <img src={faviconUrl} alt="Favicon" className="max-h-16 max-w-full object-contain rounded" />
                          <button onClick={() => { setFaviconUrl(''); }} className="absolute top-2 right-2 p-1 rounded-full bg-destructive/10 text-destructive hover:bg-destructive/20"><X size={12} /></button>
                        </>
                      ) : (
                        <>
                          <Upload size={24} className="text-muted-foreground" />
                          <p className="text-xs text-muted-foreground">ICO, PNG (32x32)</p>
                        </>
                      )}
                      <label className="text-xs text-primary cursor-pointer hover:underline font-medium">
                        {uploadingFavicon ? <Loader2 size={14} className="animate-spin inline" /> : (faviconUrl ? 'Cambiar' : 'Subir favicon')}
                        <input type="file" accept="image/*,.ico" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleUploadFile(f, 'favicon'); }} />
                      </label>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-card border border-border rounded-xl p-5">
                <h4 className="text-sm font-semibold text-foreground mb-3">Colores corporativos</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">Color primario</label>
                    <div className="flex items-center gap-2">
                      <input type="color" value={primaryColor} onChange={e => setPrimaryColor(e.target.value)} className="w-10 h-10 rounded-lg border border-border cursor-pointer" />
                      <input className={inputClass} value={primaryColor} onChange={e => setPrimaryColor(e.target.value)} />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">Color secundario</label>
                    <div className="flex items-center gap-2">
                      <input type="color" value={secondaryColor} onChange={e => setSecondaryColor(e.target.value)} className="w-10 h-10 rounded-lg border border-border cursor-pointer" />
                      <input className={inputClass} value={secondaryColor} onChange={e => setSecondaryColor(e.target.value)} />
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-card border border-border rounded-xl p-5">
                <h4 className="text-sm font-semibold text-foreground mb-3">Información de la empresa</h4>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">Slogan</label>
                    <input className={inputClass} value={companySlogan} onChange={e => setCompanySlogan(e.target.value)} placeholder="Tu slogan corporativo" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">Sitio web</label>
                    <input className={inputClass} value={companyWebsite} onChange={e => setCompanyWebsite(e.target.value)} placeholder="https://tuempresa.com" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">Teléfono</label>
                    <input className={inputClass} value={companyPhone} onChange={e => setCompanyPhone(e.target.value)} placeholder="+52 55 1234 5678" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">Dirección</label>
                    <input className={inputClass} value={companyAddress} onChange={e => setCompanyAddress(e.target.value)} placeholder="Calle, Ciudad, País" />
                  </div>
                </div>
              </div>

              <div className="bg-card border border-border rounded-xl p-5">
                <h4 className="text-sm font-semibold text-foreground mb-3">Vista previa</h4>
                <div className="flex items-center gap-4 p-4 rounded-lg border border-border" style={{ background: `linear-gradient(135deg, ${primaryColor}15, ${secondaryColor}15)` }}>
                  {logoUrl ? (
                    <img src={logoUrl} alt="Logo" className="w-12 h-12 rounded-xl object-contain" />
                  ) : (
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold text-lg" style={{ backgroundColor: primaryColor }}>
                      {orgName ? orgName.charAt(0).toUpperCase() : 'E'}
                    </div>
                  )}
                  <div className="flex-1">
                    <p className="font-bold text-foreground">{orgName || 'Mi Empresa'}</p>
                    <p className="text-xs text-muted-foreground">{companySlogan || 'Tu slogan aquí'}</p>
                  </div>
                  {faviconUrl && (
                    <div className="flex flex-col items-center gap-1">
                      <img src={faviconUrl} alt="Favicon" className="w-6 h-6 object-contain" />
                      <span className="text-[10px] text-muted-foreground">Favicon</span>
                    </div>
                  )}
                </div>
              </div>

              <button
                disabled={savingBranding}
                onClick={handleSaveBranding}
                className="bg-primary text-primary-foreground text-sm px-5 py-2.5 rounded-lg hover:opacity-90 disabled:opacity-40 flex items-center gap-2 font-medium"
              >
                {savingBranding ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Guardar branding
              </button>
            </div>
          </div>
        )}

        {activeSection === 'team' && (
          <div className="max-w-3xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-foreground">Equipo</h3>
              {isSuperAdmin && (
                <button onClick={() => setShowInviteModal(true)} className="bg-primary text-primary-foreground text-sm px-4 py-2 rounded-lg hover:opacity-90">+ Invitar</button>
              )}
            </div>
            {teamLoading ? (
              <div className="flex items-center justify-center py-12"><Loader2 size={24} className="animate-spin text-muted-foreground" /></div>
            ) : (
              <div className="space-y-3">
                {teamData.map(m => {
                  const isExpanded = expandedUserId === m.user_id;
                  const isSelf = m.user_id === user?.id;
                  return (
                    <div key={m.user_id} className="bg-card border border-border rounded-xl overflow-hidden">
                      {/* Member row */}
                      <div className="flex items-center gap-3 px-4 py-3">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                          {m.name ? m.name.split(' ').map(n => n[0]).join('').slice(0, 2) : '?'}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground truncate">{m.name || 'Sin nombre'}</p>
                          <p className="text-xs text-muted-foreground truncate">{m.email}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          {isSuperAdmin && !isSelf ? (
                            <select
                              value={m.role}
                              onChange={async (e) => {
                                const newRole = e.target.value;
                                try {
                                  const tenantId = await getTenantId();
                                  const { error } = await supabase
                                    .from('user_roles')
                                    .update({ role: newRole } as any)
                                    .eq('user_id', m.user_id)
                                    .eq('tenant_id', tenantId);
                                  if (error) throw error;
                                  setTeamData(prev => prev.map(t => t.user_id === m.user_id ? { ...t, role: newRole } : t));
                                  toast.success('Rol actualizado');
                                } catch (err: any) {
                                  toast.error(err.message || 'Error al cambiar rol');
                                }
                              }}
                              className="text-xs bg-secondary px-2 py-1 rounded-full border border-border outline-none cursor-pointer"
                            >
                              <option value="staff">staff</option>
                              <option value="admin">admin</option>
                              <option value="owner">owner</option>
                              <option value="partner">partner</option>
                              <option value="guest">guest</option>
                            </select>
                          ) : (
                            <span className="text-xs bg-secondary px-2 py-0.5 rounded-full">{m.role}</span>
                          )}
                          <span className={`inline-block w-2 h-2 rounded-full ${m.status === 'active' ? 'bg-green-500' : 'bg-muted-foreground/40'}`} />
                          {isSuperAdmin && !isSelf && !m.confirmed && (
                            <button
                              onClick={() => handleResendInvite(m.user_id, m.email)}
                              disabled={resendingUserId === m.user_id}
                              className="text-xs bg-amber-500/10 text-amber-600 px-2 py-1 rounded-full hover:bg-amber-500/20 transition-colors flex items-center gap-1 disabled:opacity-40"
                              title="Reenviar invitación"
                            >
                              {resendingUserId === m.user_id ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                              Reenviar
                            </button>
                          )}
                          {!m.confirmed && !isSelf && (
                            <span className="text-[10px] text-amber-600 bg-amber-500/10 px-2 py-0.5 rounded-full">Pendiente</span>
                          )}
                          {isSuperAdmin && !isSelf && (
                            <>
                              <button
                                onClick={() => setExpandedUserId(isExpanded ? null : m.user_id)}
                                className="p-1.5 rounded hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
                                title="Permisos"
                              >
                                {isExpanded ? <ChevronUp size={14} /> : <Settings2 size={14} />}
                              </button>
                              <button
                                onClick={() => handleDeleteMember(m.user_id)}
                                disabled={deletingUserId === m.user_id}
                                className="text-destructive hover:text-destructive/80 disabled:opacity-40 p-1.5 rounded hover:bg-destructive/10 transition-colors"
                                title="Eliminar miembro"
                              >
                                {deletingUserId === m.user_id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                              </button>
                            </>
                          )}
                          {isSelf && <span className="text-[10px] text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">Tú</span>}
                        </div>
                      </div>

                      {/* Permissions panel */}
                      {isExpanded && isSuperAdmin && !isSelf && (
                        <div className="border-t border-border bg-secondary/30 px-4 py-3">
                          <p className="text-xs font-semibold text-muted-foreground uppercase mb-3">Permisos de acceso a módulos</p>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                            {MODULE_PERMISSIONS.map(mod => {
                              const enabled = m.permissions[mod.key] !== false;
                              return (
                                <label key={mod.key} className="flex items-center gap-2 cursor-pointer group">
                                  <button
                                    onClick={() => handleTogglePermission(m.user_id, mod.key, enabled)}
                                    className={`w-8 h-5 rounded-full flex items-center transition-colors shrink-0 ${enabled ? 'bg-primary justify-end' : 'bg-muted justify-start'}`}
                                  >
                                    <div className="w-3.5 h-3.5 bg-card rounded-full mx-0.5 shadow-sm" />
                                  </button>
                                  <span className={`text-xs ${enabled ? 'text-foreground' : 'text-muted-foreground'}`}>{mod.label}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                {teamData.length === 0 && (
                  <div className="bg-card border border-border rounded-xl p-6 text-center text-muted-foreground text-sm">No hay miembros en el equipo</div>
                )}
              </div>
            )}

            {/* Invite Modal */}
            {showInviteModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowInviteModal(false)}>
                <div className="bg-card border border-border rounded-xl p-6 w-full max-w-md shadow-xl" onClick={e => e.stopPropagation()}>
                  <h4 className="text-lg font-bold text-foreground mb-4">Invitar nuevo miembro</h4>
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1 block">Nombre completo</label>
                      <input className={inputClass} value={inviteName} onChange={e => setInviteName(e.target.value)} placeholder="Nombre del miembro" />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1 block">Email</label>
                      <input className={inputClass} type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="email@ejemplo.com" />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1 block">Contraseña temporal <span className="text-muted-foreground font-normal">(opcional)</span></label>
                      <input className={inputClass} type="password" value={invitePassword} onChange={e => setInvitePassword(e.target.value)} placeholder="Dejar vacío para enviar invitación por email" />
                    </div>
                    <p className="text-xs text-muted-foreground bg-secondary/50 rounded-lg px-3 py-2">
                      {invitePassword.length >= 6
                        ? '🔑 Se creará con contraseña temporal. Compártela manualmente al miembro.'
                        : '📧 Se enviará un email de invitación para que el miembro configure su contraseña.'}
                    </p>
                    <div className="flex gap-2 pt-2">
                      <button
                        onClick={() => setShowInviteModal(false)}
                        className="flex-1 bg-secondary text-secondary-foreground text-sm px-4 py-2.5 rounded-lg hover:opacity-90"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={handleInviteMember}
                        disabled={inviting || !inviteName.trim() || !inviteEmail.trim()}
                        className="flex-1 bg-primary text-primary-foreground text-sm px-4 py-2.5 rounded-lg hover:opacity-90 disabled:opacity-40 flex items-center justify-center gap-2"
                      >
                        {inviting && <Loader2 size={14} className="animate-spin" />}
                        {invitePassword.length >= 6 ? 'Crear miembro' : 'Enviar invitación'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {activeSection === 'billing' && (
          <div className="max-w-4xl">
            <h3 className="text-lg font-bold text-foreground mb-4">Suscripción y planes</h3>
            <div className="grid grid-cols-3 gap-4">
              {plans.map(plan => (
                <div key={plan.name} className={`bg-card border rounded-xl p-5 ${plan.current ? 'border-primary ring-2 ring-primary/20' : 'border-border'}`}>
                  {plan.current && <span className="text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded-full font-medium mb-3 inline-block">Plan actual</span>}
                  <h4 className="text-lg font-bold text-foreground">{plan.name}</h4>
                  <p className="text-2xl font-bold text-foreground mt-1">{plan.price}</p>
                  <ul className="mt-4 space-y-2">
                    {plan.features.map(f => (
                      <li key={f} className="text-sm text-muted-foreground flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-primary" /> {f}
                      </li>
                    ))}
                  </ul>
                  <button className={`w-full mt-4 text-sm font-medium px-4 py-2 rounded-lg ${plan.current ? 'bg-secondary text-secondary-foreground' : 'bg-primary text-primary-foreground hover:opacity-90'}`}>
                    {plan.current ? 'Gestionar' : 'Cambiar plan'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeSection === 'ai' && (
          <div className="max-w-2xl">
            <h3 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2"><Brain size={20} className="text-primary" /> IA y Automatización</h3>
            <div className="space-y-4">
              {[
                { module: 'Resúmenes de chat', desc: 'Generar resúmenes diarios/semanales de canales', enabled: true },
                { module: 'Extracción de acciones', desc: 'Detectar tareas y compromisos en conversaciones', enabled: true },
                { module: 'Búsqueda semántica', desc: 'Buscar por significado en mensajes y documentos', enabled: true },
                { module: 'Insights operativos', desc: 'Alertas de tareas sin dueño, bloqueos, etc.', enabled: false },
                { module: 'Knowledge Base IA', desc: 'Sugerir artículos cuando se detecta info repetida', enabled: false },
              ].map(item => (
                <div key={item.module} className="bg-card border border-border rounded-xl p-4 flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-semibold text-foreground">{item.module}</h4>
                    <p className="text-xs text-muted-foreground mt-0.5">{item.desc}</p>
                  </div>
                  <div className={`w-10 h-6 rounded-full flex items-center cursor-pointer transition-colors ${item.enabled ? 'bg-primary justify-end' : 'bg-muted justify-start'}`}>
                    <div className="w-4 h-4 bg-card rounded-full mx-1 shadow-sm" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {(activeSection === 'notifications' || activeSection === 'data') && (
          <div className="max-w-2xl">
            <h3 className="text-lg font-bold text-foreground mb-4">
              {activeSection === 'notifications' ? 'Notificaciones' : 'Datos y Privacidad'}
            </h3>
            <div className="bg-card border border-border rounded-xl p-6 text-center">
              <Globe size={40} className="mx-auto text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">
                {activeSection === 'notifications'
                  ? 'Configura qué notificaciones recibir por email, push y dentro de la app.'
                  : 'Gestiona exportación de datos, políticas de retención y configuración de privacidad.'}
              </p>
              <p className="text-xs text-muted-foreground mt-2">Próximamente con Lovable Cloud</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SettingsPage;
