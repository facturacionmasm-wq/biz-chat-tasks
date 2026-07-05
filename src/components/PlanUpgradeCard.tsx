import { Sparkles, Phone, ArrowRight, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';

interface Props {
  serviceName?: string;
  requiredPlan?: 'pro' | 'enterprise';
}

const PlanUpgradeCard = ({ serviceName = 'Agente de Voz IA', requiredPlan = 'pro' }: Props) => {
  const navigate = useNavigate();
  const planLabel = requiredPlan === 'pro' ? 'Pro' : 'Enterprise';

  return (
    <div className="flex items-center justify-center min-h-[70vh] p-4">
      <div className="w-full max-w-xl bg-card border border-border rounded-3xl p-8 text-center shadow-sm">
        <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <Phone size={30} className="text-primary" />
        </div>
        <h2 className="text-2xl font-bold mb-2">{serviceName} no incluido en tu plan</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Actualiza a <span className="font-semibold text-foreground">{planLabel}</span> para activar el {serviceName} y todas las funciones avanzadas.
        </p>

        <div className="bg-muted/40 rounded-2xl p-5 text-left space-y-2 mb-6">
          <div className="flex items-center gap-2 text-sm"><Check size={16} className="text-emerald-500" /> Llamadas ilimitadas con IA</div>
          <div className="flex items-center gap-2 text-sm"><Check size={16} className="text-emerald-500" /> Transferencia y agenda automática</div>
          <div className="flex items-center gap-2 text-sm"><Check size={16} className="text-emerald-500" /> Números Twilio dedicados</div>
          <div className="flex items-center gap-2 text-sm"><Check size={16} className="text-emerald-500" /> Soporte prioritario</div>
        </div>

        <Button size="lg" className="w-full rounded-full" onClick={() => navigate('/settings?tab=billing')}>
          <Sparkles size={16} className="mr-2" />
          Actualiza a {planLabel} para activar el Agente de Voz
          <ArrowRight size={16} className="ml-2" />
        </Button>
      </div>
    </div>
  );
};

export default PlanUpgradeCard;
