import { useState } from 'react';
import { Info, ArrowRight, CheckCircle2, XCircle, Clock, Globe } from 'lucide-react';
import { BYON_OPTIONS, type ByonOption } from '@/lib/byon-options';
import VerifiedCallerIdWizard from '@/components/byon/VerifiedCallerIdWizard';
import HostedNumberRequestForm from '@/components/byon/HostedNumberRequestForm';
import ByonRequestsList from '@/components/byon/ByonRequestsList';

interface Props {
  onMetaClick: () => void;
  onBuyNewClick: () => void;
}

const accentClass = (accent: ByonOption['accent']) => {
  switch (accent) {
    case 'emerald': return 'text-[var(--rx-emerald)] bg-[var(--rx-emerald)]/10';
    case 'amber': return 'text-[var(--rx-amber)] bg-[var(--rx-amber)]/10';
    case 'rose': return 'text-[var(--rx-rose)] bg-[var(--rx-rose)]/10';
    default: return 'text-[var(--rx-brand)] bg-[var(--rx-brand)]/10';
  }
};

const BringYourOwnNumberTab = ({ onMetaClick, onBuyNewClick }: Props) => {
  const [callerIdOpen, setCallerIdOpen] = useState(false);
  const [hostedOpen, setHostedOpen] = useState(false);
  const [portInOpen, setPortInOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleClick = (id: ByonOption['id']) => {
    switch (id) {
      case 'meta_whatsapp': return onMetaClick();
      case 'verified_caller_id': return setCallerIdOpen(true);
      case 'hosted_sms': return setHostedOpen(true);
      case 'port_in': return setPortInOpen(true);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rx-panel flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <Info size={20} className="text-[var(--rx-brand)]" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-foreground">Trae tu propio número</h3>
          <p className="text-xs text-[var(--rx-t2)] mt-0.5">
            ¿Ya tienes un número celular o de negocio que quieras usar en la plataforma? Elige la ruta que mejor se adapte a tu caso.
            Si prefieres comenzar con un número nuevo, también puedes comprarlo directamente.
          </p>
        </div>
        <button
          onClick={onBuyNewClick}
          className="text-xs font-medium px-3 py-2 rounded-lg border border-[var(--rx-b1)] hover:bg-[var(--rx-s2)] shrink-0"
        >
          Prefiero comprar uno nuevo
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {BYON_OPTIONS.map((opt) => {
          const Icon = opt.icon;
          return (
            <div key={opt.id} className="rx-panel flex flex-col">
              <div className="flex items-start gap-3 mb-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${accentClass(opt.accent)}`}>
                  <Icon size={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-foreground">{opt.title}</h3>
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${opt.automated ? 'bg-[var(--rx-emerald)]/15 text-[var(--rx-emerald)]' : 'bg-[var(--rx-amber)]/15 text-[var(--rx-amber)]'}`}>
                      {opt.automated ? 'Automático' : 'Trámite manual'}
                    </span>
                  </div>
                  <p className="text-[11px] text-[var(--rx-t2)]">{opt.short}</p>
                </div>
              </div>

              <p className="text-xs text-[var(--rx-t2)] leading-relaxed">{opt.description}</p>

              <div className="grid grid-cols-2 gap-2 mt-3 text-[11px]">
                <div className="bg-[var(--rx-s2)]/50 rounded-md p-2">
                  <p className="text-[10px] font-medium text-[var(--rx-t2)] uppercase tracking-wide mb-0.5 flex items-center gap-1"><Clock size={10} /> Tiempo</p>
                  <p className="text-foreground">{opt.timing}</p>
                </div>
                <div className="bg-[var(--rx-s2)]/50 rounded-md p-2">
                  <p className="text-[10px] font-medium text-[var(--rx-t2)] uppercase tracking-wide mb-0.5">Costo</p>
                  <p className="text-foreground">{opt.cost}</p>
                </div>
                <div className="bg-[var(--rx-s2)]/50 rounded-md p-2 col-span-2 flex items-start gap-1">
                  <Globe size={10} className="text-[var(--rx-t2)] mt-0.5" />
                  <span className="text-foreground">{opt.countries.join(' · ')}</span>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                <div>
                  <p className="text-[10px] font-medium text-[var(--rx-t2)] uppercase mb-1">Recibe</p>
                  <p className="text-foreground">{opt.receives}</p>
                </div>
                <div>
                  <p className="text-[10px] font-medium text-[var(--rx-t2)] uppercase mb-1">Envía</p>
                  <p className="text-foreground">{opt.sends}</p>
                </div>
              </div>

              <div className="mt-3 space-y-1">
                {opt.goodFor.slice(0, 2).map((g, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-[11px] text-foreground">
                    <CheckCircle2 size={11} className="text-[var(--rx-emerald)] mt-0.5 shrink-0" />
                    <span>{g}</span>
                  </div>
                ))}
                {opt.notGoodFor.slice(0, 2).map((n, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-[11px] text-[var(--rx-t2)]">
                    <XCircle size={11} className="text-[var(--rx-rose)]/80 mt-0.5 shrink-0" />
                    <span>{n}</span>
                  </div>
                ))}
              </div>

              <details className="mt-3">
                <summary className="text-[11px] text-[var(--rx-brand)] cursor-pointer">Requisitos</summary>
                <ul className="mt-1 space-y-1 text-[11px] text-[var(--rx-t2)] list-disc pl-4">
                  {opt.requirements.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              </details>

              <div className="mt-4">
                <button
                  onClick={() => handleClick(opt.id)}
                  className="w-full text-xs font-medium px-4 py-2 rounded-lg bg-[var(--rx-brand)] text-[var(--rx-brand)]-foreground hover:opacity-90 flex items-center justify-center gap-1.5"
                >
                  {opt.ctaLabel} <ArrowRight size={12} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3">Mis solicitudes</h3>
        <ByonRequestsList refreshKey={refreshKey} />
      </div>

      <VerifiedCallerIdWizard
        open={callerIdOpen}
        onOpenChange={setCallerIdOpen}
        onVerified={() => setRefreshKey((k) => k + 1)}
      />
      <HostedNumberRequestForm
        open={hostedOpen}
        onOpenChange={setHostedOpen}
        requestType="hosted_sms"
        onSubmitted={() => setRefreshKey((k) => k + 1)}
      />
      <HostedNumberRequestForm
        open={portInOpen}
        onOpenChange={setPortInOpen}
        requestType="port_in"
        onSubmitted={() => setRefreshKey((k) => k + 1)}
      />
    </div>
  );
};

export default BringYourOwnNumberTab;
