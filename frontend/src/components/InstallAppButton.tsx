import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Download, Share, PlusSquare } from 'lucide-react';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}

export const InstallAppButton = (): JSX.Element | null => {
  const [deferred, setDeferred] = useState<InstallPromptEvent | null>(null);
  const [iosOpen, setIosOpen] = useState(false);
  const [installed, setInstalled] = useState(() => window.matchMedia('(display-mode: standalone)').matches);
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);

  useEffect(() => {
    const onPrompt = (e: Event): void => {
      e.preventDefault();
      setDeferred(e as InstallPromptEvent);
    };
    const onInstalled = (): void => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (installed || (!deferred && !isIos)) return null;

  const install = async (): Promise<void> => {
    if (deferred) {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === 'accepted') setDeferred(null);
    } else {
      setIosOpen(true);
    }
  };

  return (
    <>
      <button
        data-testid="install-app-button"
        onClick={() => void install()}
        className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 transition-colors"
      >
        <Download className="w-4 h-4 shrink-0" />
        Installer l'application
      </button>
      <Dialog open={iosOpen} onOpenChange={setIosOpen}>
        <DialogContent data-testid="ios-install-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading">Installer sur votre iPhone / iPad</DialogTitle>
            <DialogDescription>Deux gestes et l'app aura son icône sur votre écran d'accueil, comme une vraie application.</DialogDescription>
          </DialogHeader>
          <ol className="space-y-4 text-sm text-slate-700">
            <li className="flex items-start gap-3">
              <span className="shrink-0 w-7 h-7 rounded-full bg-emerald-100 text-emerald-700 font-bold flex items-center justify-center">1</span>
              <span className="pt-1">Touchez le bouton <Share className="w-4 h-4 inline text-sky-600" /> <strong>Partager</strong> en bas de Safari.</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="shrink-0 w-7 h-7 rounded-full bg-emerald-100 text-emerald-700 font-bold flex items-center justify-center">2</span>
              <span className="pt-1">Choisissez <PlusSquare className="w-4 h-4 inline text-slate-600" /> <strong>« Sur l'écran d'accueil »</strong>, puis <strong>Ajouter</strong>.</span>
            </li>
          </ol>
          <p className="text-xs text-slate-500">L'app s'ouvrira en plein écran avec l'icône Arrière Plan, sans barre de navigateur.</p>
        </DialogContent>
      </Dialog>
    </>
  );
};
