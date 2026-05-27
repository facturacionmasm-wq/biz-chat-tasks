import { Clock, LogOut } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useBranding } from '@/hooks/useBranding';

const PendingApprovalPage = () => {
  const { signOut, user } = useAuth();
  const branding = useBranding();
  const orgName = branding.orgName || 'la organización';

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="mx-auto w-16 h-16 rounded-2xl bg-amber-500/10 flex items-center justify-center">
          <Clock className="text-amber-500" size={32} />
        </div>

        <div className="space-y-2">
          <h1 className="rx-page-title">
            Solicitud pendiente
          </h1>
          <p className="text-[var(--rx-t2)]">
            Tu solicitud para unirte a <span className="font-semibold text-foreground">{orgName}</span> está
            pendiente de aprobación por un administrador.
          </p>
        </div>

        <div className="rx-panel">
          <p className="text-sm text-[var(--rx-t2)]">
            <span className="font-medium text-foreground">Email:</span>{' '}
            {user?.email}
          </p>
          <p className="text-sm text-[var(--rx-t2)]">
            Recibirás acceso una vez que un administrador apruebe tu solicitud.
          </p>
        </div>

        <button
          onClick={signOut}
          className="inline-flex items-center gap-2 text-sm text-[var(--rx-t2)] hover:text-foreground transition-colors"
        >
          <LogOut size={14} />
          Cerrar sesión
        </button>
      </div>
    </div>
  );
};

export default PendingApprovalPage;
