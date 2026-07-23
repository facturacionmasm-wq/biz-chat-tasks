import { useEffect, useState } from 'react';
import { Loader2, Save, ShieldCheck, ShieldAlert, Upload } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

type ProfileRow = {
  tenant_id: string;
  rfc: string | null;
  razon_social: string | null;
  regimen_fiscal_sat: string | null;
  codigo_postal: string | null;
  has_csd: boolean;
  csd_uploaded_at: string | null;
  pac_provider: 'facturama' | 'sw_sapien' | 'finkok' | null;
  pac_mode: 'sandbox' | 'production';
  has_pac_credentials: boolean;
  use_shared_sandbox: boolean;
  facturama_account_mode: 'own' | 'integrator';
  facturama_csd_synced_at: string | null;

  is_active: boolean;
  last_test_at: string | null;
  last_test_status: string | null;
  last_test_error: string | null;
};

async function fileToBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.byteLength; i++) bin += String.fromCharCode(buf[i]);
  return btoa(bin);
}

export default function CFDISettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [row, setRow] = useState<ProfileRow | null>(null);

  // Editable state
  const [rfc, setRfc] = useState('');
  const [razon, setRazon] = useState('');
  const [regimen, setRegimen] = useState('');
  const [cp, setCp] = useState('');
  const [provider, setProvider] = useState<'facturama' | 'sw_sapien' | 'finkok'>('facturama');
  const [mode, setMode] = useState<'sandbox' | 'production'>('sandbox');
  const [pacUser, setPacUser] = useState('');
  const [pacPass, setPacPass] = useState('');
  const [useShared, setUseShared] = useState(false);
  const [facturamaMode, setFacturamaMode] = useState<'own' | 'integrator'>('own');

  const [cerFile, setCerFile] = useState<File | null>(null);
  const [keyFile, setKeyFile] = useState<File | null>(null);
  const [csdPassword, setCsdPassword] = useState('');

  async function load() {
    setLoading(true);
    const { data } = await supabase.from('tenant_fiscal_profiles_public').select('*').maybeSingle();
    if (data) {
      setRow(data as ProfileRow);
      setRfc(data.rfc ?? '');
      setRazon(data.razon_social ?? '');
      setRegimen(data.regimen_fiscal_sat ?? '');
      setCp(data.codigo_postal ?? '');
      setProvider((data.pac_provider ?? 'facturama') as any);
      setMode((data.pac_mode ?? 'sandbox') as any);
      setUseShared(!!data.use_shared_sandbox);
    }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function save(activate?: boolean) {
    setSaving(true);
    const body: Record<string, unknown> = {
      rfc, razon_social: razon, regimen_fiscal_sat: regimen, codigo_postal: cp,
      pac_provider: provider, pac_mode: mode, use_shared_sandbox: useShared,
    };
    if (cerFile && keyFile && csdPassword) {
      body.csd_cer_b64 = await fileToBase64(cerFile);
      body.csd_key_b64 = await fileToBase64(keyFile);
      body.csd_password = csdPassword;
    }
    if (pacUser || pacPass) {
      body.pac_credentials = { user: pacUser, password: pacPass };
    }
    if (activate !== undefined) body.is_active = activate;

    const { data, error } = await supabase.functions.invoke('cfdi-fiscal-profile-save', { body });
    setSaving(false);
    if (error || (data as any)?.error) {
      toast.error((data as any)?.message || (data as any)?.error || error?.message || 'Error al guardar');
      return;
    }
    toast.success(activate ? 'Perfil activado' : 'Perfil guardado');
    setCerFile(null); setKeyFile(null); setCsdPassword('');
    setPacUser(''); setPacPass('');
    await load();
  }

  async function test() {
    setTesting(true);
    const { data } = await supabase.functions.invoke('cfdi-fiscal-profile-test', {});
    setTesting(false);
    if ((data as any)?.ok) toast.success('Conexión con PAC verificada');
    else toast.error((data as any)?.error || 'Falló la prueba');
    await load();
  }

  if (loading) {
    return <div className="p-8 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
      <Loader2 size={14} className="animate-spin" /> Cargando…
    </div>;
  }

  const active = row?.is_active === true;

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h2 className="text-xl font-bold">Perfil fiscal (CFDI)</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Cada empresa timbra bajo su propia identidad legal. Nunca compartimos RFC ni CSD entre tenants.
        </p>
      </div>

      <div className={`rounded-2xl p-3 flex items-center gap-3 border ${active ? 'bg-emerald-500/5 border-emerald-500/30' : 'bg-orange-500/5 border-orange-500/30'}`}>
        {active ? <ShieldCheck size={18} className="text-emerald-500" /> : <ShieldAlert size={18} className="text-orange-500" />}
        <div className="text-sm">
          <div className="font-medium">{active ? 'Perfil activo — puedes timbrar.' : 'Perfil inactivo — no se pueden timbrar CFDI.'}</div>
          {row?.last_test_at && (
            <div className="text-xs text-muted-foreground">
              Último test: {new Date(row.last_test_at).toLocaleString('es-MX')} — {row.last_test_status ?? '—'}
              {row.last_test_error ? ` (${row.last_test_error})` : ''}
            </div>
          )}
        </div>
      </div>

      {/* Identidad fiscal */}
      <section className="bg-card border border-border rounded-2xl p-4 space-y-3">
        <h3 className="font-semibold text-sm">1. Identidad fiscal SAT</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="RFC" value={rfc} onChange={setRfc} placeholder="XAXX010101000" upper />
          <Field label="Código postal" value={cp} onChange={setCp} placeholder="06600" />
          <Field label="Razón social" value={razon} onChange={setRazon} placeholder="Mi Empresa S.A. de C.V." className="md:col-span-2" />
          <Field label="Régimen fiscal (clave SAT)" value={regimen} onChange={setRegimen} placeholder="601" />
        </div>
      </section>

      {/* CSD */}
      <section className="bg-card border border-border rounded-2xl p-4 space-y-3">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          2. Certificado de Sello Digital (CSD)
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-destructive/10 text-destructive font-medium">SENSIBLE</span>
        </h3>
        <div className="text-xs bg-destructive/5 border border-destructive/20 rounded-lg p-3 text-muted-foreground">
          <div className="font-medium text-foreground mb-1">Información fiscal sensible</div>
          Tu <b>.cer</b>, <b>.key</b> y contraseña se cifran con AES-GCM antes de guardarse y nunca se muestran de vuelta.
          Solo dueños y administradores de tu empresa pueden cargarlos o reemplazarlos.
        </div>
        {row?.has_csd ? (
          <div className="text-xs text-muted-foreground">
            CSD cargado el {row.csd_uploaded_at ? new Date(row.csd_uploaded_at).toLocaleDateString('es-MX') : '—'}. Deja los campos vacíos para conservarlo, o sube uno nuevo para reemplazarlo.
          </div>
        ) : (
          <div className="text-xs text-orange-600 dark:text-orange-400">Aún no has cargado tu CSD.</div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <FileField label=".cer" file={cerFile} onFile={setCerFile} accept=".cer" />
          <FileField label=".key" file={keyFile} onFile={setKeyFile} accept=".key" />
          <Field
            label="Contraseña CSD"
            value={csdPassword}
            onChange={setCsdPassword}
            type="password"
            placeholder={row?.has_csd ? '•••••••• (guardada)' : ''}
            autoComplete="new-password"
          />
        </div>
      </section>


      {/* PAC */}
      <section className="bg-card border border-border rounded-2xl p-4 space-y-3">
        <h3 className="font-semibold text-sm">3. Proveedor Autorizado de Certificación (PAC)</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">PAC</label>
            <select value={provider} onChange={(e) => setProvider(e.target.value as any)}
              className="mt-1 w-full bg-secondary rounded-lg px-3 py-2 text-sm border border-border">
              <option value="facturama">Facturama</option>
              <option value="sw_sapien">SW Sapien (próximamente)</option>
              <option value="finkok">Finkok (próximamente)</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Ambiente</label>
            <select value={mode} onChange={(e) => setMode(e.target.value as any)}
              className="mt-1 w-full bg-secondary rounded-lg px-3 py-2 text-sm border border-border">
              <option value="sandbox">Sandbox (pruebas)</option>
              <option value="production">Producción</option>
            </select>
          </div>
        </div>
        <div className="text-xs text-muted-foreground">
          {row?.has_pac_credentials ? 'Credenciales del PAC ya guardadas (cifradas). Vuelve a capturarlas para reemplazar.' : 'Captura las credenciales que te entregó tu PAC.'}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Usuario / API user" value={pacUser} onChange={setPacUser} />
          <Field label="Contraseña / API key" value={pacPass} onChange={setPacPass} type="password" />
        </div>
        {mode === 'sandbox' && (
          <label className="flex items-start gap-2 text-xs text-muted-foreground cursor-pointer">
            <input type="checkbox" checked={useShared} onChange={(e) => setUseShared(e.target.checked)} className="mt-0.5" />
            <span>Usar sandbox compartido de la plataforma (solo pruebas, ignora las credenciales capturadas). No disponible en producción.</span>
          </label>
        )}
      </section>

      {/* Acciones */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => save()}
          disabled={saving}
          className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm flex items-center gap-2 disabled:opacity-50">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Guardar
        </button>
        <button
          onClick={test}
          disabled={testing}
          className="px-4 py-2 rounded-xl bg-secondary text-sm flex items-center gap-2 disabled:opacity-50">
          {testing ? <Loader2 size={14} className="animate-spin" /> : null} Probar conexión PAC
        </button>
        {active ? (
          <button onClick={() => save(false)} disabled={saving}
            className="px-4 py-2 rounded-xl bg-destructive/10 text-destructive text-sm">
            Desactivar timbrado
          </button>
        ) : (
          <button onClick={() => save(true)} disabled={saving}
            className="px-4 py-2 rounded-xl bg-emerald-500 text-white text-sm">
            Activar timbrado
          </button>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type, upper, className, autoComplete }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; upper?: boolean; className?: string; autoComplete?: string;
}) {
  return (
    <div className={className}>
      <label className="text-xs text-muted-foreground">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(upper ? e.target.value.toUpperCase() : e.target.value)}
        placeholder={placeholder}
        type={type ?? 'text'}
        autoComplete={autoComplete}
        className="mt-1 w-full bg-secondary rounded-lg px-3 py-2 text-sm border border-border"
      />
    </div>
  );
}


function FileField({ label, file, onFile, accept }: { label: string; file: File | null; onFile: (f: File | null) => void; accept: string }) {
  return (
    <div>
      <label className="text-xs text-muted-foreground">{label}</label>
      <label className="mt-1 flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary border border-border cursor-pointer text-xs">
        <Upload size={14} />
        <span className="truncate">{file ? file.name : 'Seleccionar…'}</span>
        <input type="file" accept={accept} className="hidden"
          onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
      </label>
    </div>
  );
}
