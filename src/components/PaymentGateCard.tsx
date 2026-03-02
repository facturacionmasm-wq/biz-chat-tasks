import { useState, useEffect } from 'react';
import { CreditCard, Loader2, Shield, Zap, Check, Package, Phone, MessageSquare, ArrowRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface ServicePackage {
  id: string;
  service_type: string;
  name: string;
  description: string | null;
  units: number;
  unit_label: string;
  price: number;
  currency: string;
  popular: boolean;
  sort_order: number;
}

interface PaymentGateCardProps {
  serviceName: string;
  serviceType: 'voice' | 'whatsapp';
  onPurchasePackage: (packageId: string) => void;
  onSetupCard: (serviceType: 'voice' | 'whatsapp') => void;
  redirecting: boolean;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  MXN: 'MX$', COP: 'COP$', ARS: 'AR$', CLP: 'CL$', PEN: 'S/', USD: '$', EUR: '€',
};

const PaymentGateCard = ({ serviceName, serviceType, onPurchasePackage, onSetupCard, redirecting }: PaymentGateCardProps) => {
  const [packages, setPackages] = useState<ServicePackage[]>([]);
  const [selectedPkg, setSelectedPkg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'packages' | 'payg'>('packages');

  useEffect(() => {
    const fetchPackages = async () => {
      const { data } = await supabase
        .from('service_packages')
        .select('*')
        .eq('service_type', serviceType)
        .eq('active', true)
        .order('sort_order');
      setPackages((data || []) as ServicePackage[]);
      const popular = (data || []).find((p: any) => p.popular);
      if (popular) setSelectedPkg((popular as any).id);
      setLoading(false);
    };
    fetchPackages();
  }, [serviceType]);

  const ServiceIcon = serviceType === 'voice' ? Phone : MessageSquare;
  const unitLabel = serviceType === 'voice' ? 'minuto' : 'mensaje';

  return (
    <div className="flex items-center justify-center h-full p-4">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <ServiceIcon size={32} className="text-primary" />
          </div>
          <h2 className="text-xl font-bold text-foreground mb-2">
            Activa {serviceName}
          </h2>
          <p className="text-sm text-muted-foreground">
            Elige cómo quieres pagar por el servicio.
          </p>
        </div>

        {/* Mode toggle */}
        <div className="flex rounded-lg bg-muted p-1 mb-6">
          <button
            onClick={() => setMode('packages')}
            className={`flex-1 text-sm font-medium py-2 px-4 rounded-md transition-all ${
              mode === 'packages'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Package size={14} className="inline mr-1.5 -mt-0.5" />
            Paquetes prepago
          </button>
          <button
            onClick={() => setMode('payg')}
            className={`flex-1 text-sm font-medium py-2 px-4 rounded-md transition-all ${
              mode === 'payg'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Zap size={14} className="inline mr-1.5 -mt-0.5" />
            Pago por uso
          </button>
        </div>

        {mode === 'packages' ? (
          <>
            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2 size={24} className="animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
                {packages.map((pkg) => {
                  const isSelected = selectedPkg === pkg.id;
                  const symbol = CURRENCY_SYMBOLS[pkg.currency] || '$';
                  const pricePerUnit = (pkg.price / pkg.units).toFixed(2);

                  return (
                    <button
                      key={pkg.id}
                      onClick={() => setSelectedPkg(pkg.id)}
                      className={`relative text-left p-5 rounded-xl border-2 transition-all ${
                        isSelected
                          ? 'border-primary bg-primary/5 shadow-lg shadow-primary/10 scale-[1.02]'
                          : 'border-border hover:border-primary/30 bg-card'
                      }`}
                    >
                      {pkg.popular && (
                        <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-[10px] font-bold px-3 py-0.5 rounded-full uppercase tracking-wider">
                          Popular
                        </span>
                      )}

                      <div className="flex items-center gap-2 mb-2">
                        <Package size={16} className="text-primary" />
                        <span className="text-sm font-bold text-foreground">{pkg.name}</span>
                      </div>

                      <div className="mb-3">
                        <span className="text-2xl font-bold text-foreground">{symbol}{pkg.price.toLocaleString()}</span>
                        <span className="text-xs text-muted-foreground ml-1">{pkg.currency}</span>
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2 text-xs">
                          <Check size={12} className="text-success shrink-0" />
                          <span className="text-foreground font-medium">{pkg.units.toLocaleString()} {pkg.unit_label}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs">
                          <Check size={12} className="text-success shrink-0" />
                          <span className="text-muted-foreground">{symbol}{pricePerUnit}/{pkg.unit_label.replace(/s$/, '')}</span>
                        </div>
                        {pkg.description && (
                          <p className="text-[11px] text-muted-foreground mt-1">{pkg.description}</p>
                        )}
                      </div>

                      {isSelected && (
                        <div className="absolute top-3 right-3 w-5 h-5 bg-primary rounded-full flex items-center justify-center">
                          <Check size={12} className="text-primary-foreground" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            <button
              onClick={() => selectedPkg && onPurchasePackage(selectedPkg)}
              disabled={redirecting || !selectedPkg}
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
                  Comprar paquete y registrar tarjeta
                </>
              )}
            </button>
          </>
        ) : (
          <>
            {/* Pay as you go */}
            <div className="bg-card border border-border rounded-xl p-6 mb-6">
              <h3 className="text-base font-bold text-foreground mb-3">Pago por uso automático</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Registra tu tarjeta de crédito y solo paga por lo que uses. Se cobrará automáticamente al final de cada período.
              </p>

              <div className="space-y-3">
                <div className="flex items-center justify-between py-2 border-b border-border">
                  <span className="text-sm text-foreground">Cargo base mensual</span>
                  <span className="text-sm font-bold text-foreground">Sin cargo fijo</span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-border">
                  <span className="text-sm text-foreground">Costo por {unitLabel}</span>
                  <span className="text-sm font-bold text-foreground">
                    {serviceType === 'voice' ? 'MX$1.50/min' : 'MX$0.50/msg'}
                  </span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm text-foreground">Facturación</span>
                  <span className="text-sm font-bold text-foreground">Mensual automática</span>
                </div>
              </div>
            </div>

            <div className="bg-card border border-border rounded-xl p-4 mb-5 space-y-2.5">
              <div className="flex items-start gap-3">
                <Shield size={16} className="text-primary mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-medium text-foreground">Pago seguro con Stripe</p>
                  <p className="text-[11px] text-muted-foreground">Encriptación de nivel bancario. Tu tarjeta queda guardada para cobros automáticos.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Zap size={16} className="text-primary mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-medium text-foreground">Sin compromisos</p>
                  <p className="text-[11px] text-muted-foreground">Cancela cuando quieras. Solo pagas por el uso real del servicio.</p>
                </div>
              </div>
            </div>

            <button
              onClick={() => onSetupCard(serviceType)}
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
                  Registrar tarjeta y activar servicio
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </>
        )}

        <p className="text-center text-[11px] text-muted-foreground mt-3">
          {mode === 'packages'
            ? 'El cobro se realizará de inmediato al completar el registro de tarjeta.'
            : 'No se realizará ningún cobro ahora. Se facturará al final del período según tu uso.'}
        </p>
      </div>
    </div>
  );
};

export default PaymentGateCard;
