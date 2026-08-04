import { useState, FormEvent } from 'react';
import axios from 'axios';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { MailCheck, KeyRound, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialEmail?: string;
  onReset: (email: string) => void;
}

const errDetail = (err: unknown): string | null => {
  if (axios.isAxiosError(err) && err.response) {
    const d = (err.response.data as { detail?: unknown }).detail;
    if (typeof d === 'string') return d;
  }
  return null;
};

export const ForgotPasswordDialog = ({ open, onOpenChange, initialEmail, onReset }: Props): JSX.Element => {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState(initialEmail ?? '');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);

  const reset = (): void => {
    setStep('email');
    setCode('');
    setNewPassword('');
    setConfirm('');
  };

  const sendCode = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    try {
      await axios.post(`${API}/auth/forgot-password`, { email: email.trim() });
      toast.success('Si un compte existe pour ce courriel, le code de vérification est en route.');
      setStep('code');
    } catch (err) {
      toast.error(errDetail(err) ?? 'Envoi impossible pour le moment.');
    } finally {
      setBusy(false);
    }
  };

  const submitReset = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (newPassword !== confirm) {
      toast.error('Les deux mots de passe ne correspondent pas.');
      return;
    }
    setBusy(true);
    try {
      await axios.post(`${API}/auth/reset-password`, {
        email: email.trim(), code: code.trim(), new_password: newPassword,
      });
      toast.success('Mot de passe réinitialisé. Connectez-vous avec votre nouveau mot de passe.');
      onReset(email.trim());
      onOpenChange(false);
      reset();
    } catch (err) {
      toast.error(errDetail(err) ?? 'Réinitialisation impossible.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent data-testid="forgot-password-dialog" className="sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="font-heading inline-flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-emerald-600" /> Identifiants oubliés
          </DialogTitle>
          <DialogDescription>
            {step === 'email'
              ? 'Entrez votre courriel : nous vous enverrons votre identifiant de connexion et un code de vérification.'
              : 'Entrez le code à 6 chiffres reçu par courriel, puis choisissez votre nouveau mot de passe.'}
          </DialogDescription>
        </DialogHeader>

        {step === 'email' ? (
          <form onSubmit={(e) => void sendCode(e)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="forgot-email">Courriel du compte</Label>
              <Input
                id="forgot-email"
                data-testid="forgot-email-input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="vous@pharmacie.ca"
                required
              />
            </div>
            <Button data-testid="forgot-send-button" type="submit" disabled={busy} className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700">
              <MailCheck className="w-4 h-4 mr-1.5" /> {busy ? 'Envoi…' : 'Envoyer le code de vérification'}
            </Button>
          </form>
        ) : (
          <form onSubmit={(e) => void submitReset(e)} className="space-y-4">
            <div data-testid="forgot-code-info" className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-800">
              Un courriel a été envoyé à <strong>{email}</strong> (vérifiez vos indésirables). Il contient votre identifiant
              de connexion et un code valide 15 minutes.
            </div>
            <div className="space-y-2">
              <Label htmlFor="forgot-code">Code de vérification (6 chiffres)</Label>
              <Input
                id="forgot-code"
                data-testid="forgot-code-input"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                className="text-center text-lg tracking-[0.5em] font-bold"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="forgot-new-password">Nouveau mot de passe</Label>
              <div className="relative">
                <Input
                  id="forgot-new-password"
                  data-testid="forgot-new-password-input"
                  type={showPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Min. 10 caractères, majuscule, minuscule, chiffre"
                  className="pr-10"
                  required
                />
                <button
                  type="button"
                  data-testid="forgot-password-toggle"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-700 transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="forgot-confirm">Confirmer le mot de passe</Label>
              <Input
                id="forgot-confirm"
                data-testid="forgot-confirm-input"
                type={showPassword ? 'text' : 'password'}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••••••"
                required
              />
            </div>
            <Button data-testid="forgot-reset-button" type="submit" disabled={busy} className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700">
              {busy ? 'Réinitialisation…' : 'Réinitialiser mon mot de passe'}
            </Button>
            <button
              type="button"
              data-testid="forgot-resend-link"
              onClick={() => { setStep('email'); setCode(''); }}
              className="block w-full text-center text-xs text-slate-500 hover:text-emerald-700 transition-colors"
            >
              Courriel non reçu ? Renvoyer un code
            </button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
};
