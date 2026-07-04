import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, Eye, EyeOff } from 'lucide-react';
import { useBranding } from '@/hooks/useBranding';
import { useRybixTheme } from '@/hooks/useRybixTheme';

const checkEmailExists = async (email: string): Promise<boolean> => {
  try {
    const { data, error } = await supabase.functions.invoke('check-email-exists', {
      body: { email: email.toLowerCase().trim() },
    });
    if (error) return false;
    return data?.exists === true;
  } catch { return false; }
};

const validateEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
  </svg>
);

export default function AuthPage() {
  const branding = useBranding();
  const { isDay, toggle } = useRybixTheme();
  const [mode, setMode]           = useState<'login' | 'register' | 'forgot'>('login');
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [name, setName]           = useState('');
  const [showPass, setShowPass]   = useState(false);
  const [loading, setLoading]     = useState(false);
  const [oauthLoading, setOAuth]  = useState<string | null>(null);
  const [forgotSent, setForgotSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateEmail(email)) { toast.error('Email inválido'); return; }
    setLoading(true);
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      } else if (mode === 'register') {
        if (!name.trim()) { toast.error('El nombre es obligatorio'); setLoading(false); return; }
        const exists = await checkEmailExists(email.trim());
        if (exists) { toast.error('Este email ya está registrado'); setLoading(false); return; }
        const { error } = await supabase.auth.signUp({
          email: email.trim(), password,
          options: { data: { name: name.trim() } },
        });
        if (error) throw error;
        toast.success('¡Revisa tu email para confirmar tu cuenta!');
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
        setForgotSent(true);
        toast.success('Instrucciones enviadas a tu email');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error de autenticación';
      // Map Supabase error codes to friendly Spanish messages
      const friendly = getFriendlyAuthError(message);
      toast.error(friendly);
    } finally {
      setLoading(false);
    }
  };

  const handleOAuth = async (provider: 'google' | 'apple') => {
    setOAuth(provider);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: `${window.location.origin}/` },
      });
      if (error) throw error;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error OAuth';
      toast.error(message);
      setOAuth(null);
    }
  };

  const titles: Record<typeof mode, string> = {
    login: 'Bienvenido de vuelta',
    register: 'Crea tu cuenta',
    forgot: 'Recuperar acceso',
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--rx-bg)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px 16px',
      position: 'relative',
    }}>
      {/* Background orbs */}
      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 0,
      }}>
        <div style={{
          position: 'absolute', width: 480, height: 480, borderRadius: '50%',
          background: 'radial-gradient(circle, var(--rx-brand-soft), transparent 65%)',
          filter: 'blur(90px)', top: '-15%', left: '-8%',
        }} />
        <div style={{
          position: 'absolute', width: 360, height: 360, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(163,116,255,.10), transparent 65%)',
          filter: 'blur(90px)', bottom: '-8%', right: '-8%',
        }} />
      </div>

      {/* Theme toggle */}
      <button
        onClick={toggle}
        className="rx-btn rx-btn-ghost rx-btn-sm"
        style={{
          position: 'fixed', top: 20, right: 20, zIndex: 10,
          borderRadius: 99,
        }}
      >
        {isDay ? '🌙 Noche' : '☀️ Día'}
      </button>

      {/* Auth card */}
      <div style={{
        width: '100%', maxWidth: 420, position: 'relative', zIndex: 1,
        animation: 'rxFadeUp .5s cubic-bezier(.16,1,.3,1) both',
      }}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 16, margin: '0 auto 16px',
            background: 'linear-gradient(135deg, var(--rx-brand), var(--rx-brand2))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: 'var(--rx-shadow-glow)',
          }}>
            <svg width="24" height="24" viewBox="0 0 16 16" fill="none">
              <path d="M3 8L7 12L13 4" stroke="var(--primary-foreground)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div style={{
            fontFamily: 'var(--rx-font-display)',
            fontSize: 24, fontWeight: 800, color: 'var(--rx-t1)',
            letterSpacing: '-.03em', marginBottom: 6, lineHeight: 1.1,
          }}>
            {branding.orgName || 'RYBIX'}
          </div>
          <div style={{ fontSize: 13.5, color: 'var(--rx-t2)', fontWeight: 500 }}>
            {titles[mode]}
          </div>
        </div>

        {/* Card */}
        <div style={{
          background: 'var(--rx-s1)',
          border: '1px solid var(--rx-b1)',
          borderRadius: 'var(--rx-r-2xl)',
          padding: 32,
          boxShadow: 'var(--rx-shadow-lg)',
        }}>

          {/* OAuth */}
          {mode !== 'forgot' && (
            <>
              <button
                onClick={() => handleOAuth('google')}
                disabled={!!loading || !!oauthLoading}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                  background: 'var(--rx-s2)', border: '1px solid var(--rx-b1)', borderRadius: 12,
                  padding: '12px 16px', fontSize: 13.5, fontWeight: 600, color: 'var(--rx-t1)',
                  cursor: 'pointer', marginBottom: 12,
                  transition: 'border-color .15s, background .15s',
                  opacity: loading || oauthLoading ? 0.6 : 1,
                }}
              >
                {oauthLoading === 'google' ? <Loader2 size={16} className="animate-spin" /> : <GoogleIcon />}
                Continuar con Google
              </button>

              <div style={{
                display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0',
              }}>
                <div style={{ flex: 1, height: 1, background: 'var(--rx-b1)' }} />
                <span style={{ fontSize: 11, color: 'var(--rx-t3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.08em' }}>O con email</span>
                <div style={{ flex: 1, height: 1, background: 'var(--rx-b1)' }} />
              </div>
            </>
          )}

          {/* Form */}
          {forgotSent && mode === 'forgot' ? (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📬</div>
              <div style={{ fontFamily: 'var(--rx-font-display)', fontSize: 15, fontWeight: 700, color: 'var(--rx-t1)', marginBottom: 6 }}>
                Email enviado
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--rx-t2)', marginBottom: 20 }}>
                Revisa tu bandeja de entrada para restablecer tu contraseña.
              </div>
              <button onClick={() => { setMode('login'); setForgotSent(false); }} className="rx-btn rx-btn-ghost" style={{ width: '100%', justifyContent: 'center' }}>
                Volver al login
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {mode === 'register' && (
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--rx-t2)', display: 'block', marginBottom: 6 }}>
                    Nombre completo
                  </label>
                  <input
                    type="text" value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Tu nombre"
                    className="rx-input"
                    required
                  />
                </div>
              )}

              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--rx-t2)', display: 'block', marginBottom: 6 }}>
                  Email
                </label>
                <input
                  type="email" value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="tu@email.com"
                  className="rx-input"
                  required
                />
              </div>

              {mode !== 'forgot' && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--rx-t2)' }}>
                      Contraseña
                    </label>
                    {mode === 'login' && (
                      <button type="button" onClick={() => setMode('forgot')} style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        fontSize: 11.5, color: 'var(--rx-brand)', fontWeight: 600, padding: 0,
                      }}>
                        ¿Olvidaste tu contraseña?
                      </button>
                    )}
                  </div>
                  <div style={{ position: 'relative' }}>
                    <input
                      type={showPass ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="rx-input"
                      style={{ paddingRight: 44 }}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass(!showPass)}
                      aria-label={showPass ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                      style={{
                        position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: 'var(--rx-t3)', display: 'flex', alignItems: 'center',
                        padding: 6, borderRadius: 8,
                      }}
                    >
                      {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="rx-btn rx-btn-primary"
                style={{ width: '100%', justifyContent: 'center', padding: '12px', marginTop: 8, fontSize: 14 }}
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : null}
                {mode === 'login' ? 'Iniciar sesión'
                  : mode === 'register' ? 'Crear cuenta'
                  : 'Enviar instrucciones'}
              </button>
            </form>
          )}

          {/* Mode switcher */}
          {!forgotSent && (
            <div style={{ textAlign: 'center', marginTop: 18, fontSize: 12.5, color: 'var(--rx-t2)' }}>
              {mode === 'login' ? (
                <>¿No tienes cuenta?{' '}
                  <button onClick={() => setMode('register')} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--rx-brand)', fontWeight:700 }}>
                    Regístrate
                  </button>
                </>
              ) : mode === 'register' ? (
                <>¿Ya tienes cuenta?{' '}
                  <button onClick={() => setMode('login')} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--rx-brand)', fontWeight:700 }}>
                    Inicia sesión
                  </button>
                </>
              ) : (
                <button onClick={() => setMode('login')} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--rx-brand)', fontWeight:700 }}>
                  ← Volver al login
                </button>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ textAlign: 'center', marginTop: 20, fontSize: 11, color: 'var(--rx-t3)' }}>
          Plataforma de gestión empresarial inteligente
        </div>
      </div>
    </div>
  );
}

/**
 * Map Supabase error messages to friendly Spanish equivalents.
 */
function getFriendlyAuthError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('invalid login credentials') || lower.includes('invalid email or password')) {
    return 'Email o contraseña incorrectos';
  }
  if (lower.includes('email not confirmed')) {
    return 'Por favor confirma tu email antes de iniciar sesión';
  }
  if (lower.includes('user already registered')) {
    return 'Este email ya está registrado';
  }
  if (lower.includes('password should be at least')) {
    return 'La contraseña debe tener al menos 6 caracteres';
  }
  if (lower.includes('rate limit') || lower.includes('too many requests')) {
    return 'Demasiados intentos. Espera un momento e intenta de nuevo';
  }
  if (lower.includes('network') || lower.includes('fetch')) {
    return 'Error de conexión. Verifica tu internet e intenta de nuevo';
  }
  return message || 'Error de autenticación';
}
