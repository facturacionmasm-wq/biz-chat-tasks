import { CreditCard, Loader2, Shield, Zap } from 'lucide-react';

interface PaymentGateCardProps {
  serviceName: string;
  onRegisterCard: () => void;
  redirecting: boolean;
}

const PaymentGateCard = ({ serviceName, onRegisterCard, redirecting }: PaymentGateCardProps) => {
  return (
    <div className="flex items-center justify-center h-full p-4">
      <div className="w-full max-w-md text-center">
        <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <CreditCard size={32} className="text-primary" />
        </div>
        <h2 className="text-xl font-bold text-foreground mb-2">
          Registra tu método de pago
        </h2>
        <p className="text-sm text-muted-foreground mb-6">
          Para usar <span className="font-semibold text-foreground">{serviceName}</span> necesitas
          registrar una tarjeta de crédito. Los consumos se cobran automáticamente al final del mes.
        </p>

        <div className="bg-card border border-border rounded-xl p-4 mb-6 text-left space-y-3">
          <div className="flex items-start gap-3">
            <Shield size={16} className="text-primary mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-medium text-foreground">Pago seguro con Stripe</p>
              <p className="text-[11px] text-muted-foreground">Tu información está protegida con encriptación de nivel bancario.</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Zap size={16} className="text-primary mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-medium text-foreground">Solo pagas lo que usas</p>
              <p className="text-[11px] text-muted-foreground">Sin cargos fijos adicionales. Facturación basada en consumo real.</p>
            </div>
          </div>
        </div>

        <button
          onClick={onRegisterCard}
          disabled={redirecting}
          className="w-full bg-primary text-primary-foreground font-medium text-sm px-6 py-3 rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {redirecting ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Redirigiendo a Stripe...
            </>
          ) : (
            <>
              <CreditCard size={16} />
              Registrar tarjeta de crédito
            </>
          )}
        </button>

        <p className="text-[11px] text-muted-foreground mt-3">
          No se realizará ningún cargo inmediato. La tarjeta se usará para cobros mensuales de consumo.
        </p>
      </div>
    </div>
  );
};

export default PaymentGateCard;
