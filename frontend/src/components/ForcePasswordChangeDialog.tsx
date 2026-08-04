import { useState, FormEvent } from 'react';
import { useAuth } from '@/context/AuthContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';

export const ForcePasswordChangeDialog = ({ expired = false }: { expired?: boolean }): JSX.Element => {
  const { changePassword, logout } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setError('');
    if (next !== confirm) {
      setError('Les deux nouveaux mots de passe ne correspondent pas.');
      return;
    }
    setBusy(true);
    const err = await changePassword(current, next);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    toast.success('Mot de passe mis à jour. Bienvenue !');
  };

  return (
    <Dialog open>
      <DialogContent
        data-testid="force-password-dialog"
        className="max-w-md [&>button]:hidden"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle className="font-heading inline-flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-bronze-600" /> Sécurisez votre compte
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-slate-500 -mt-2">
          {expired
            ? 'Votre mot de passe a expiré selon la politique de sécurité de votre pharmacie. Choisissez un nouveau mot de passe pour continuer.'
            : 'Votre mot de passe est temporaire. Pour protéger les données de votre pharmacie, choisissez un nouveau mot de passe avant de continuer.'}
        </p>
        <form onSubmit={(e) => void submit(e)} className="space-y-4">
          <div className="space-y-2">
            <Label>{expired ? 'Mot de passe actuel' : 'Mot de passe temporaire actuel'}</Label>
            <Input data-testid="force-pw-current" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoComplete="current-password" />
          </div>
          <div className="space-y-2">
            <Label>Nouveau mot de passe</Label>
            <Input data-testid="force-pw-new" type="password" value={next} onChange={(e) => setNext(e.target.value)} required autoComplete="new-password" />
            <p className="text-xs text-slate-400">Au moins 10 caractères, avec une majuscule, une minuscule et un chiffre.</p>
          </div>
          <div className="space-y-2">
            <Label>Confirmez le nouveau mot de passe</Label>
            <Input data-testid="force-pw-confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" />
          </div>
          {error && <p data-testid="force-pw-error" className="text-sm text-red-600">{error}</p>}
          <Button data-testid="force-pw-submit" type="submit" disabled={busy} className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700">
            {busy ? 'Enregistrement…' : 'Changer mon mot de passe'}
          </Button>
          <button type="button" data-testid="force-pw-logout" onClick={logout} className="w-full text-center text-xs text-slate-400 hover:text-slate-600">
            Se déconnecter
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
};
