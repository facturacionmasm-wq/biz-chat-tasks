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
          <h1 className="text-2xl font-bold text-foreground">
            Solicitud pendiente
          </h1>
          <p className="text-muted-foreground">
            Tu solicitud para unirte a <span className="font-semibold text-foreground">{orgName}</span> está
            pendiente de aprobación por un administrador.
          </p>
        </div>

        <div className="bg-card border border-border rounded-xl p-4 text-left space-y-2">
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Email:</span>{' '}
            {user?.email}
          </p>
          <p className="text-sm text-muted-foreground">
            Recibirás acceso una vez que un administrador apruebe tu solicitud.
          </p>
        </div>

        <button
          onClick={signOut}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <LogOut size={14} />
          Cerrar sesión
        </button>
      </div>
    </div>
  );
};

export default PendingApprovalPage;
