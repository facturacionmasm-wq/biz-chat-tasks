import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, Building2 } from 'lucide-react';
import { useBranding } from '@/hooks/useBranding';

const AuthPage = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const branding = useBranding();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success('Sesión iniciada');
      } else {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        toast.success('Cuenta creada exitosamente');
      }
    } catch (err: any) {
      toast.error(err.message || 'Error de autenticación');
    } finally {
      setLoading(false);
    }
  };

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
          <h1 className="text-2xl font-bold text-foreground">{branding.orgName}</h1>
          {branding.slogan && <p className="text-xs text-muted-foreground mt-0.5">{branding.slogan}</p>}
          <p className="text-sm text-muted-foreground mt-1">
            {isLogin ? 'Inicia sesión en tu cuenta' : 'Crea tu cuenta'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="bg-card border border-border rounded-xl p-6 space-y-4">
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
          <div>
            <label className="text-sm font-medium text-foreground block mb-1">Contraseña</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              minLength={6}
              placeholder="••••••••"
              className="w-full bg-secondary rounded-lg px-3 py-2.5 text-sm outline-none border border-border focus:border-primary text-foreground placeholder:text-muted-foreground"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary text-primary-foreground font-medium text-sm px-4 py-2.5 rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading && <Loader2 size={16} className="animate-spin" />}
            {isLogin ? 'Iniciar sesión' : 'Crear cuenta'}
          </button>
        </form>

        <p className="text-center text-sm text-muted-foreground mt-4">
          {isLogin ? '¿No tienes cuenta?' : '¿Ya tienes cuenta?'}{' '}
          <button onClick={() => setIsLogin(!isLogin)} className="text-primary hover:underline font-medium">
            {isLogin ? 'Regístrate' : 'Inicia sesión'}
          </button>
        </p>
      </div>
    </div>
  );
};

export default AuthPage;
