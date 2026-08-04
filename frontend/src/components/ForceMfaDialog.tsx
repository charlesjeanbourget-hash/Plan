import { useAuth } from '@/context/AuthContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MfaSettings } from '@/components/MfaSettings';
import { ShieldAlert } from 'lucide-react';

export const ForceMfaDialog = (): JSX.Element => {
  const { logout, refreshUser } = useAuth();
  return (
    <Dialog open>
      <DialogContent
        data-testid="force-mfa-dialog"
        className="max-w-md [&>button]:hidden"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle className="font-heading inline-flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-bronze-600" /> Vérification en 2 étapes requise
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-slate-500 -mt-2">
          Votre pharmacie exige la vérification en 2 étapes (MFA) pour tous les comptes.
          Activez-la maintenant pour accéder à la plateforme.
        </p>
        <MfaSettings onChanged={() => void refreshUser()} />
        <button type="button" data-testid="force-mfa-logout" onClick={logout} className="w-full text-center text-xs text-slate-400 hover:text-slate-600">
          Se déconnecter
        </button>
      </DialogContent>
    </Dialog>
  );
};
