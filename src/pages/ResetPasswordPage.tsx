import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, Building2, CheckCircle2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useBranding } from '@/hooks/useBranding';

const ResetPasswordPage = () => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [isRecovery, setIsRecovery] = useState(false);
  const navigate = useNavigate();
  const branding = useBranding();

  useEffect(() => {
    // Listen for PASSWORD_RECOVERY event
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsRecovery(true);
      }
    });

    // Check if we're already in a recovery session
    const hash = window.location.hash;
    if (hash.includes('type=recovery')) {
      setIsRecovery(true);
    }

    return () => subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

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
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setSuccess(true);
      toast.success('Contraseña actualizada correctamente');
      setTimeout(() => navigate('/auth'), 2000);
    } catch (err: any) {
      toast.error(err.message || 'Error al actualizar contraseña');
    } finally {
      setLoading(false);
    }
  };

  if (!isRecovery && !success) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-[var(--rx-t2)]">Enlace inválido o expirado.</p>
          <button onClick={() => navigate('/auth')} className="text-[var(--rx-brand)] hover:underline mt-2 text-sm font-medium">
            Volver al login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          {branding.logoUrl ? (
            <img src={branding.logoUrl} alt={branding.orgName} className="h-16 mx-auto mb-4 object-contain" />
          ) : (
            <div className="w-14 h-14 bg-[var(--rx-brand)] rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Building2 size={28} className="text-[var(--rx-brand)]-foreground" />
            </div>
          )}
          <h1 className="rx-page-title">Nueva contraseña</h1>
          <p className="text-sm text-[var(--rx-t2)] mt-1">Ingresa tu nueva contraseña</p>
        </div>

        {success ? (
          <div className="rx-panel">
            <CheckCircle2 size={48} className="text-[var(--rx-brand)] mx-auto" />
            <p className="text-foreground font-medium">Contraseña actualizada</p>
            <p className="text-sm text-[var(--rx-t2)]">Redirigiendo al login...</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="rx-panel">
            <div>
              <label className="text-sm font-medium text-foreground block mb-1">Nueva contraseña</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                minLength={6}
                placeholder="••••••••"
                className="w-full bg-[var(--rx-s2)] rounded-lg px-3 py-2.5 text-sm outline-none border border-[var(--rx-b1)] focus:border-primary text-foreground placeholder:text-[var(--rx-t2)]"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground block mb-1">Confirmar contraseña</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                required
                minLength={6}
                placeholder="••••••••"
                className="w-full bg-[var(--rx-s2)] rounded-lg px-3 py-2.5 text-sm outline-none border border-[var(--rx-b1)] focus:border-primary text-foreground placeholder:text-[var(--rx-t2)]"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[var(--rx-brand)] text-[var(--rx-brand)]-foreground font-medium text-sm px-4 py-2.5 rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading && <Loader2 size={16} className="animate-spin" />}
              Actualizar contraseña
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default ResetPasswordPage;
