import { useState, useEffect } from 'react';
import { Building2, Users, Shield, CreditCard, Bell, Database, Brain, Globe, ChevronRight, User, KeyRound, Loader2, Palette, Save, Upload } from 'lucide-react';
import { teamMembers } from '@/data/mockData';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';

const settingsSections = [
  { id: 'profile', label: 'Mi Perfil', icon: User },
  { id: 'general', label: 'General', icon: Building2 },
  { id: 'branding', label: 'Branding', icon: Palette },
  { id: 'team', label: 'Equipo', icon: Users },
  { id: 'roles', label: 'Roles y permisos', icon: Shield },
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
  const [savingBranding, setSavingBranding] = useState(false);

  // Load tenant data
  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (!profile) return;

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
      }
    };
    load();
  }, [user]);

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
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold text-lg" style={{ backgroundColor: primaryColor }}>
                    {orgName ? orgName.charAt(0).toUpperCase() : 'E'}
                  </div>
                  <div>
                    <p className="font-bold text-foreground">{orgName || 'Mi Empresa'}</p>
                    <p className="text-xs text-muted-foreground">{companySlogan || 'Tu slogan aquí'}</p>
                  </div>
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
              <button className="bg-primary text-primary-foreground text-sm px-4 py-2 rounded-lg hover:opacity-90">+ Invitar</button>
            </div>
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Nombre</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Email</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Rol</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {teamMembers.map(m => (
                    <tr key={m.id} className="border-b border-border last:border-b-0 hover:bg-secondary/30">
                      <td className="px-4 py-3 flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                          {m.name.split(' ').map(n => n[0]).join('')}
                        </div>
                        {m.name}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{m.email}</td>
                      <td className="px-4 py-3"><span className="text-xs bg-secondary px-2 py-0.5 rounded-full">{m.role}</span></td>
                      <td className="px-4 py-3">
                        <span className={`inline-block w-2 h-2 rounded-full ${m.status === 'online' ? 'bg-success' : m.status === 'away' ? 'bg-warning' : 'bg-muted-foreground/40'}`} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeSection === 'roles' && (
          <div className="max-w-3xl">
            <h3 className="text-lg font-bold text-foreground mb-4">Roles y Permisos</h3>
            <div className="space-y-3">
              {[
                { role: 'Owner', desc: 'Acceso total. Configuración, facturación, permisos.', permissions: 'Todos los módulos' },
                { role: 'Admin', desc: 'Gestión operativa. Equipos, proyectos, integraciones.', permissions: 'Chat, Proyectos, OKRs, Calendario, Integraciones' },
                { role: 'Member', desc: 'Participante estándar. Chat, tareas, notas.', permissions: 'Chat, Proyectos (asignados), Calendario (lectura)' },
                { role: 'Guest', desc: 'Acceso limitado a un proyecto específico.', permissions: 'Proyecto asignado (solo lectura)' },
              ].map(r => (
                <div key={r.role} className="bg-card border border-border rounded-xl p-4 flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-semibold text-foreground">{r.role}</h4>
                    <p className="text-xs text-muted-foreground mt-0.5">{r.desc}</p>
                    <p className="text-xs text-primary mt-1">{r.permissions}</p>
                  </div>
                  <ChevronRight size={16} className="text-muted-foreground" />
                </div>
              ))}
            </div>
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
