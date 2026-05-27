import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { ShieldX, Clock, CreditCard } from 'lucide-react';

const SubscriptionBlockedPage = () => {
  const { signOut, subscriptionStatus } = useAuth();
  const navigate = useNavigate();

  const planName = subscriptionStatus?.plan_name || 'Tu plan';

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md text-center">
        <div className="w-16 h-16 bg-destructive/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
          <ShieldX size={32} className="text-[var(--rx-rose)]" />
        </div>

        <h1 className="text-2xl font-bold text-foreground mb-2">
          Suscripción expirada
        </h1>
        <p className="text-sm text-[var(--rx-t2)] mb-6">
          Tu período de prueba de <strong>{planName}</strong> ha terminado.
          Para continuar usando la plataforma, activa tu suscripción.
        </p>

        <div className="rx-panel">
          <div className="flex items-center gap-3 text-left">
            <Clock size={18} className="text-[var(--rx-t2)] shrink-0" />
            <div>
              <p className="text-sm font-medium text-foreground">Trial finalizado</p>
              <p className="text-xs text-[var(--rx-t2)]">
                {subscriptionStatus?.trial_ends_at
                  ? `Expiró el ${new Date(subscriptionStatus.trial_ends_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}`
                  : 'Tu período de prueba ha expirado'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 text-left">
            <CreditCard size={18} className="text-[var(--rx-t2)] shrink-0" />
            <div>
              <p className="text-sm font-medium text-foreground">Activa tu plan</p>
              <p className="text-xs text-[var(--rx-t2)]">
                Tus datos están seguros. Activa un plan para recuperar el acceso completo.
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={() => window.location.href = 'mailto:admin@rybixholding.com?subject=Activar suscripción'}
          className="w-full bg-[var(--rx-brand)] text-[var(--rx-brand)]-foreground font-medium text-sm px-4 py-3 rounded-lg hover:opacity-90 mb-3"
        >
          Contactar administrador
        </button>

        <button
          onClick={signOut}
          className="text-sm text-[var(--rx-t2)] hover:text-foreground transition-colors"
        >
          Cerrar sesión
        </button>
      </div>
    </div>
  );
};

export default SubscriptionBlockedPage;
