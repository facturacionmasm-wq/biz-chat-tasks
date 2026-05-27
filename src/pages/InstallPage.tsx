import { useState, useEffect } from 'react';
import { Download, Smartphone, Monitor, Share, Plus, MoreVertical, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const InstallPage = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const ua = navigator.userAgent;
    setIsIOS(/iPad|iPhone|iPod/.test(ua));

    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsInstalled(true);
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);

    const installed = () => setIsInstalled(true);
    window.addEventListener('appinstalled', installed);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', installed);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') setIsInstalled(true);
    setDeferredPrompt(null);
  };

  if (isInstalled) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background p-4">
        <Card className="max-w-md w-full text-center">
          <CardContent className="pt-8 pb-8 space-y-4">
            <CheckCircle2 className="mx-auto text-[var(--rx-brand)]" size={56} />
            <h1 className="rx-page-title">¡App instalada!</h1>
            <p className="text-[var(--rx-t2)]">RYBIX ya está en tu dispositivo. Puedes abrirla desde tu pantalla de inicio.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-background p-4">
      <div className="max-w-md w-full space-y-6">
        <div className="text-center space-y-2">
          <div className="w-20 h-20 rounded-2xl bg-[var(--rx-brand)] flex items-center justify-center mx-auto shadow-lg">
            <span className="text-3xl font-bold text-[var(--rx-brand)]-foreground">R</span>
          </div>
          <h1 className="text-2xl font-bold text-foreground mt-4">Instalar RYBIX</h1>
          <p className="text-[var(--rx-t2)]">Accede rápidamente desde tu pantalla de inicio, sin necesidad de tiendas de apps.</p>
        </div>

        {/* Benefits */}
        <Card>
          <CardContent className="pt-5 space-y-3">
            {[
              { icon: Smartphone, text: 'Acceso rápido desde tu inicio' },
              { icon: Monitor, text: 'Funciona en móvil, tablet y PC' },
              { icon: Download, text: 'Carga rápida y offline' },
            ].map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <Icon size={18} className="text-[var(--rx-brand)]" />
                </div>
                <span className="text-sm text-foreground">{text}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Install button or iOS instructions */}
        {deferredPrompt ? (
          <Button onClick={handleInstall} className="w-full h-12 text-base" size="lg">
            <Download className="mr-2" size={20} />
            Instalar ahora
          </Button>
        ) : isIOS ? (
          <Card>
            <CardContent className="pt-5 space-y-3">
              <p className="text-sm font-semibold text-foreground">En Safari:</p>
              <div className="flex items-center gap-3 text-sm text-[var(--rx-t2)]">
                <Share size={18} className="shrink-0 text-[var(--rx-brand)]" />
                <span>Toca el botón <strong>Compartir</strong></span>
              </div>
              <div className="flex items-center gap-3 text-sm text-[var(--rx-t2)]">
                <Plus size={18} className="shrink-0 text-[var(--rx-brand)]" />
                <span>Selecciona <strong>Agregar a inicio</strong></span>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="pt-5 space-y-3">
              <p className="text-sm font-semibold text-foreground">Desde tu navegador:</p>
              <div className="flex items-center gap-3 text-sm text-[var(--rx-t2)]">
                <MoreVertical size={18} className="shrink-0 text-[var(--rx-brand)]" />
                <span>Abre el menú del navegador</span>
              </div>
              <div className="flex items-center gap-3 text-sm text-[var(--rx-t2)]">
                <Download size={18} className="shrink-0 text-[var(--rx-brand)]" />
                <span>Selecciona <strong>Instalar app</strong></span>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

export default InstallPage;
