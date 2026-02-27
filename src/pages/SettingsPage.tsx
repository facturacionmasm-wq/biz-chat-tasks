import { useState } from 'react';
import { Building2, Users, Shield, CreditCard, Bell, Database, Brain, Globe, ChevronRight } from 'lucide-react';
import { teamMembers } from '@/data/mockData';

const settingsSections = [
  { id: 'general', label: 'General', icon: Building2 },
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
  const [activeSection, setActiveSection] = useState('general');

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
        {activeSection === 'general' && (
          <div className="max-w-2xl">
            <h3 className="text-lg font-bold text-foreground mb-4">Configuración General</h3>
            <div className="space-y-4">
              <div className="bg-card border border-border rounded-xl p-4">
                <label className="text-sm font-medium text-foreground block mb-1">Nombre de la organización</label>
                <input className="w-full bg-secondary rounded-lg px-3 py-2 text-sm outline-none border border-border focus:border-primary" defaultValue="Mi Empresa" />
              </div>
              <div className="bg-card border border-border rounded-xl p-4">
                <label className="text-sm font-medium text-foreground block mb-1">Dominio</label>
                <input className="w-full bg-secondary rounded-lg px-3 py-2 text-sm outline-none border border-border focus:border-primary" defaultValue="miempresa.officehub.app" />
              </div>
              <div className="bg-card border border-border rounded-xl p-4">
                <label className="text-sm font-medium text-foreground block mb-1">Zona horaria</label>
                <select className="w-full bg-secondary rounded-lg px-3 py-2 text-sm outline-none border border-border">
                  <option>América/México_City (UTC-6)</option>
                  <option>América/Bogotá (UTC-5)</option>
                  <option>América/Buenos_Aires (UTC-3)</option>
                  <option>Europa/Madrid (UTC+1)</option>
                </select>
              </div>
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
