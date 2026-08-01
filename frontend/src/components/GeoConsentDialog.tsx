import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { MapPin } from 'lucide-react';

interface Props {
  open: boolean;
  onDecision: (granted: boolean) => void;
}

export const GeoConsentDialog = ({ open, onDecision }: Props): JSX.Element => (
  <Dialog open={open}>
    <DialogContent data-testid="geo-consent-dialog" className="max-w-md [&>button]:hidden" aria-describedby={undefined}>
      <DialogHeader>
        <DialogTitle className="font-heading inline-flex items-center gap-2">
          <MapPin className="w-5 h-5 text-emerald-600" /> Enregistrer votre position ?
        </DialogTitle>
      </DialogHeader>
      <p className="text-sm text-slate-500">
        Pour confirmer votre lieu de travail au moment du pointage, Arrière Plan peut enregistrer
        votre position géographique. Elle n'est captée qu'au moment du punch, jamais en continu.
        Vous pouvez refuser : votre pointage fonctionnera quand même. (Conforme à la Loi 25)
      </p>
      <div className="flex gap-3 justify-end mt-2">
        <Button data-testid="geo-consent-decline" variant="outline" className="rounded-full" onClick={() => onDecision(false)}>
          Refuser
        </Button>
        <Button data-testid="geo-consent-accept" className="rounded-full bg-emerald-600 hover:bg-emerald-700" onClick={() => onDecision(true)}>
          J'accepte
        </Button>
      </div>
    </DialogContent>
  </Dialog>
);
