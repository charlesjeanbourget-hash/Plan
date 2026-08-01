import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ShieldCheck } from 'lucide-react';

const POINTS = [
  'Vos renseignements (coordonnées, horaires, heures travaillées, licences, évaluations) servent uniquement à la gestion RH de votre pharmacie.',
  'La géolocalisation au pointage n\'est captée qu\'avec votre accord, au moment du punch, jamais en continu.',
  'Vos données sont chiffrées et l\'accès est limité par rôle ; chaque consultation de document sensible est journalisée.',
  'Vous pouvez à tout moment demander l\'accès, la rectification ou la suppression de vos renseignements (droit d\'accès Loi 25).',
  'Aucun renseignement personnel n\'est vendu ni communiqué à des tiers à des fins commerciales.',
];

export const PrivacyConsentDialog = (): JSX.Element => {
  const { acceptPrivacy, logout } = useAuth();
  const [busy, setBusy] = useState(false);

  const accept = async (): Promise<void> => {
    setBusy(true);
    await acceptPrivacy();
    setBusy(false);
  };

  return (
    <Dialog open>
      <DialogContent data-testid="privacy-consent-dialog" className="max-w-lg [&>button]:hidden" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="font-heading inline-flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-600" /> Protection de vos renseignements
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-slate-500 -mt-1">
          Avant d'utiliser Arrière Plan, veuillez prendre connaissance de la façon dont nous protégeons
          vos renseignements personnels, conformément à la Loi 25 du Québec.
        </p>
        <ul className="space-y-2.5 my-2">
          {POINTS.map((p, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-slate-600">
              <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>{p}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-slate-400">
          En cliquant sur « J'ai lu et j'accepte », vous confirmez avoir pris connaissance de la politique de confidentialité.
        </p>
        <div className="flex gap-3 justify-end mt-2">
          <Button data-testid="privacy-consent-logout" variant="outline" className="rounded-full" onClick={logout}>
            Se déconnecter
          </Button>
          <Button data-testid="privacy-consent-accept" className="rounded-full bg-emerald-600 hover:bg-emerald-700" onClick={() => void accept()} disabled={busy}>
            {busy ? 'Enregistrement…' : 'J\'ai lu et j\'accepte'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
