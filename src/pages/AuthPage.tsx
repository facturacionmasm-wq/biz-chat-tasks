import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { lovable } from '@/integrations/lovable';
import { toast } from 'sonner';
import { Loader2, Building2, Eye, EyeOff } from 'lucide-react';
import { useBranding } from '@/hooks/useBranding';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

const checkEmailExists = async (email: string): Promise<boolean> => {
  try {
    const { data, error } = await supabase.functions.invoke('check-email-exists', {
      body: { email: email.toLowerCase().trim() },
    });
    if (error) return false;
    return data?.exists === true;
  } catch {
    return false;
  }
};

const validateEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const AuthPage = () => {
  const [activeTab, setActiveTab] = useState<string>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<string | null>(null);
  const [forgotMode, setForgotMode] = useState(false);
  const branding = useBranding();

  // ─── LOGIN ───
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateEmail(email)) {
      toast.error('Formato de email inválido');
      return;
    }
    setLoading(true);
    try {
      const exists = await checkEmailExists(email);
      if (!exists) {
        toast.error('Esta cuenta no existe. Regístrate para continuar.');
        setActiveTab('signup');
        setLoading(false);
        return;
      }

      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        if (error.message.includes('Invalid login credentials')) {
          toast.error('Contraseña incorrecta. Intenta nuevamente.');
        } else {
          toast.error(error.message);
        }
      } else {
        toast.success('Sesión iniciada');
      }
    } catch (err: any) {
      toast.error(err.message || 'Error de autenticación');
    } finally {
      setLoading(false);
    }
  };

  // ─── SIGN UP ───
  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateEmail(email)) {
      toast.error('Formato de email inválido');
      return;
    }
    if (password.length < 6) {
      toast.error('La contraseña debe tener al menos 6 caracteres');
      return;
    }
    if (password !== confirmPassword) {
      toast.error('Las contraseñas no coinciden');
      return;
    }

    setLoading(true);
    try {
      const exists = await checkEmailExists(email);
      if (exists) {
        toast.error('Esta cuenta ya está registrada. Inicia sesión.');
        setActiveTab('login');
        setLoading(false);
        return;
      }

      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { name: name || undefined },
          emailRedirectTo: window.location.origin,
        },
      });
      if (error) throw error;
      toast.success('Cuenta creada correctamente');
    } catch (err: any) {
      toast.error(err.message || 'Error al crear cuenta');
    } finally {
      setLoading(false);
    }
  };

  // ─── FORGOT PASSWORD ───
  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateEmail(email)) {
      toast.error('Ingresa un email válido');
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      toast.success('Te enviamos un enlace de recuperación a tu email');
      setForgotMode(false);
    } catch (err: any) {
      toast.error(err.message || 'Error al enviar enlace');
    } finally {
      setLoading(false);
    }
  };

  // ─── OAUTH ───
  const handleOAuth = async (provider: 'google' | 'apple') => {
    setOauthLoading(provider);
    try {
      const result = await lovable.auth.signInWithOAuth(provider, {
        redirect_uri: window.location.origin,
      });
      if (result.error) {
        toast.error(result.error.message || `Error al iniciar con ${provider}`);
      }
    } catch (err: any) {
      toast.error(err.message || `Error al iniciar con ${provider}`);
    } finally {
      setOauthLoading(null);
    }
  };

  // ─── OAUTH BUTTONS ───
  const OAuthButtons = () => (
    <div className="space-y-2">
      <button
        onClick={() => handleOAuth('google')}
        disabled={!!oauthLoading || loading}
        className="w-full flex items-center justify-center gap-3 bg-card border border-border rounded-xl px-4 py-2.5 text-sm font-medium text-foreground hover:bg-secondary transition-colors disabled:opacity-50"
      >
        {oauthLoading === 'google' ? (
          <Loader2 size={18} className="animate-spin" />
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
        )}
        Continuar con Google
      </button>
      <button
        onClick={() => handleOAuth('apple')}
        disabled={!!oauthLoading || loading}
        className="w-full flex items-center justify-center gap-3 bg-card border border-border rounded-xl px-4 py-2.5 text-sm font-medium text-foreground hover:bg-secondary transition-colors disabled:opacity-50"
      >
        {oauthLoading === 'apple' ? (
          <Loader2 size={18} className="animate-spin" />
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
          </svg>
        )}
        Continuar con Apple
      </button>
    </div>
  );

  const Divider = () => (
    <div className="flex items-center gap-3 my-4">
      <div className="h-px flex-1 bg-border" />
      <span className="text-xs text-muted-foreground">o con email</span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );

  const PasswordInput = ({ value, onChange, placeholder = "••••••••", label }: {
    value: string; onChange: (v: string) => void; placeholder?: string; label: string;
  }) => (
    <div>
      <label className="text-sm font-medium text-foreground block mb-1">{label}</label>
      <div className="relative">
        <input
          type={showPassword ? 'text' : 'password'}
          value={value}
          onChange={e => onChange(e.target.value)}
          required
          minLength={6}
          placeholder={placeholder}
          className="w-full bg-secondary rounded-lg px-3 py-2.5 text-sm outline-none border border-border focus:border-primary text-foreground placeholder:text-muted-foreground pr-10"
        />
        <button
          type="button"
          onClick={() => setShowPassword(!showPassword)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          tabIndex={-1}
        >
          {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </div>
  );

  // ─── FORGOT PASSWORD VIEW ───
  if (forgotMode) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            {branding.logoUrl ? (
              <img src={branding.logoUrl} alt={branding.orgName} className="h-16 mx-auto mb-4 object-contain" />
            ) : (
              <div className="w-14 h-14 bg-primary rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Building2 size={28} className="text-primary-foreground" />
              </div>
            )}
            <h1 className="text-2xl font-bold text-foreground">Recuperar contraseña</h1>
            <p className="text-sm text-muted-foreground mt-1">Te enviaremos un enlace a tu email</p>
          </div>
          <form onSubmit={handleForgotPassword} className="bg-card border border-border rounded-xl p-6 space-y-4">
            <div>
              <label className="text-sm font-medium text-foreground block mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                placeholder="tu@email.com"
                className="w-full bg-secondary rounded-lg px-3 py-2.5 text-sm outline-none border border-border focus:border-primary text-foreground placeholder:text-muted-foreground"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary text-primary-foreground font-medium text-sm px-4 py-2.5 rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading && <Loader2 size={16} className="animate-spin" />}
              Enviar enlace
            </button>
          </form>
          <p className="text-center text-sm text-muted-foreground mt-4">
            <button onClick={() => setForgotMode(false)} className="text-primary hover:underline font-medium">
              Volver al login
            </button>
          </p>
        </div>
      </div>
    );
  }

  // ─── MAIN AUTH VIEW ───
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          {branding.logoUrl ? (
            <img src={branding.logoUrl} alt={branding.orgName} className="h-16 mx-auto mb-4 object-contain" />
          ) : (
            <div className="w-14 h-14 bg-primary rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Building2 size={28} className="text-primary-foreground" />
            </div>
          )}
          <h1 className="text-2xl font-bold text-foreground">{branding.orgName}</h1>
          {branding.slogan && <p className="text-xs text-muted-foreground mt-0.5">{branding.slogan}</p>}
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-4">
            <TabsTrigger value="login">Login</TabsTrigger>
            <TabsTrigger value="signup">Sign Up</TabsTrigger>
          </TabsList>

          {/* ─── LOGIN TAB ─── */}
          <TabsContent value="login">
            <OAuthButtons />
            <Divider />
            <form onSubmit={handleLogin} className="bg-card border border-border rounded-xl p-6 space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground block mb-1">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  placeholder="tu@email.com"
                  className="w-full bg-secondary rounded-lg px-3 py-2.5 text-sm outline-none border border-border focus:border-primary text-foreground placeholder:text-muted-foreground"
                />
              </div>
              <PasswordInput value={password} onChange={setPassword} label="Contraseña" />
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-primary text-primary-foreground font-medium text-sm px-4 py-2.5 rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading && <Loader2 size={16} className="animate-spin" />}
                Iniciar sesión
              </button>
              <div className="text-center">
                <button
                  type="button"
                  onClick={() => setForgotMode(true)}
                  className="text-xs text-primary hover:underline font-medium"
                >
                  ¿Olvidaste tu contraseña?
                </button>
              </div>
            </form>
          </TabsContent>

          {/* ─── SIGN UP TAB ─── */}
          <TabsContent value="signup">
            <OAuthButtons />
            <Divider />
            <form onSubmit={handleSignUp} className="bg-card border border-border rounded-xl p-6 space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground block mb-1">Nombre</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Tu nombre (opcional)"
                  className="w-full bg-secondary rounded-lg px-3 py-2.5 text-sm outline-none border border-border focus:border-primary text-foreground placeholder:text-muted-foreground"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground block mb-1">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  placeholder="tu@email.com"
                  className="w-full bg-secondary rounded-lg px-3 py-2.5 text-sm outline-none border border-border focus:border-primary text-foreground placeholder:text-muted-foreground"
                />
              </div>
              <PasswordInput value={password} onChange={setPassword} label="Contraseña" />
              <PasswordInput value={confirmPassword} onChange={setConfirmPassword} label="Confirmar contraseña" />
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-primary text-primary-foreground font-medium text-sm px-4 py-2.5 rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading && <Loader2 size={16} className="animate-spin" />}
                Crear cuenta
              </button>
            </form>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default AuthPage;
