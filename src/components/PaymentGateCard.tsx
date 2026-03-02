import { useState, useEffect } from 'react';
import { CreditCard, Loader2, Shield, Zap, Check, Package, Phone, MessageSquare } from 'lucide-react';
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
  redirecting: boolean;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  MXN: 'MX$', COP: 'COP$', ARS: 'AR$', CLP: 'CL$', PEN: 'S/', USD: '$', EUR: '€',
};

const PaymentGateCard = ({ serviceName, serviceType, onPurchasePackage, redirecting }: PaymentGateCardProps) => {
  const [packages, setPackages] = useState<ServicePackage[]>([]);
  const [selectedPkg, setSelectedPkg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPackages = async () => {
      const { data } = await supabase
        .from('service_packages')
        .select('*')
        .eq('service_type', serviceType)
        .eq('active', true)
        .order('sort_order');
      setPackages((data || []) as ServicePackage[]);
      // Pre-select popular
      const popular = (data || []).find((p: any) => p.popular);
      if (popular) setSelectedPkg((popular as any).id);
      setLoading(false);
    };
    fetchPackages();
  }, [serviceType]);

  const ServiceIcon = serviceType === 'voice' ? Phone : MessageSquare;

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
            Elige un paquete para comenzar. Se registrará tu tarjeta y se cobrará el paquete seleccionado.
          </p>
        </div>

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

        <div className="bg-card border border-border rounded-xl p-4 mb-5 space-y-2.5">
          <div className="flex items-start gap-3">
            <Shield size={16} className="text-primary mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-medium text-foreground">Pago seguro con Stripe</p>
              <p className="text-[11px] text-muted-foreground">Encriptación de nivel bancario. Tu tarjeta queda guardada para futuras compras.</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Zap size={16} className="text-primary mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-medium text-foreground">Sin suscripción</p>
              <p className="text-[11px] text-muted-foreground">Compras paquetes cuando los necesitas. Sin cargos recurrentes automáticos.</p>
            </div>
          </div>
        </div>

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

        <p className="text-center text-[11px] text-muted-foreground mt-3">
          El cobro se realizará de inmediato al completar el registro de tarjeta.
        </p>
      </div>
    </div>
  );
};

export default PaymentGateCard;
