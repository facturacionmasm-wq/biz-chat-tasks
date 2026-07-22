import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Shows a persistent banner when the user's PIN was reset by an admin
 * (or generated during invitation) and must be changed on first use.
 */
const PinChangeBanner = () => {
  const { user } = useAuth();
  const [mustChange, setMustChange] = useState(false);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('pin_must_change, pin_temp_expires_at')
        .eq('user_id', user.id)
        .maybeSingle();
      if (!cancelled && data) {
        setMustChange(!!(data as any).pin_must_change);
        setExpiresAt((data as any).pin_temp_expires_at ?? null);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  if (!mustChange) return null;

  const expired = expiresAt ? new Date(expiresAt).getTime() < Date.now() : false;

  return (
    <div className="mx-3 mt-3 flex items-center gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
      <AlertTriangle size={18} className="text-amber-500 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-foreground">
          {expired ? 'Tu PIN temporal expiró' : 'Tienes un PIN temporal activo'}
        </p>
        <p className="text-xs text-muted-foreground">
          {expired
            ? 'Solicita a un administrador que lo resetee de nuevo.'
            : 'Debes cambiarlo antes de usar los agentes de voz/WhatsApp.'}
          {expiresAt && !expired && ` Expira: ${new Date(expiresAt).toLocaleString()}`}
        </p>
      </div>
      <Link
        to="/settings"
        className="rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold px-3 py-1.5 shrink-0"
      >
        Cambiar PIN
      </Link>
    </div>
  );
};

export default PinChangeBanner;
