import { useState, FormEvent } from 'react';
import axios from 'axios';
import { useAuth, BackendUser } from '@/context/AuthContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Sparkles, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const TrialSignupDialog = ({ open, onClose, onSuccess }: Props): JSX.Element => {
  const { adoptSession } = useAuth();
  const [pharmacyName, setPharmacyName] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await axios.post<{ access_token: string; user: BackendUser; trial_ends_at: string }>(
        `${API}/auth/signup-trial`,
        { pharmacy_name: pharmacyName, name, email, password }
      );
      toast.success(`Bienvenue ! Votre essai gratuit est actif jusqu'au ${res.data.trial_ends_at.slice(0, 10)}.`, { duration: 8000 });
      adoptSession(res.data.access_token, res.data.user);
      onClose();
      onSuccess();
    } catch (err) {
      const detail = axios.isAxiosError(err) && err.response ? (err.response.data as { detail?: string }).detail : null;
      toast.error(detail ?? "Inscription impossible pour le moment.", { duration: 10000 });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="trial-signup-dialog" className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-emerald-600" /> Essai gratuit 30 jours
          </DialogTitle>
          <DialogDescription>
            Toutes les fonctionnalités, sans carte de crédit. Votre espace est créé instantanément et vos données restent 100 % privées.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void submit(e)} className="space-y-4">
          <div className="space-y-2">
            <Label>Nom de votre pharmacie / entreprise</Label>
            <Input data-testid="trial-pharmacy-input" value={pharmacyName} onChange={(e) => setPharmacyName(e.target.value)} placeholder="Ex. Pharmacie Tremblay" required />
          </div>
          <div className="space-y-2">
            <Label>Votre nom complet</Label>
            <Input data-testid="trial-name-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Prénom Nom" required />
          </div>
          <div className="space-y-2">
            <Label>Courriel professionnel</Label>
            <Input data-testid="trial-email-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="vous@pharmacie.ca" required />
          </div>
          <div className="space-y-2">
            <Label>Mot de passe</Label>
            <div className="relative">
              <Input
                data-testid="trial-password-input"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="10 caractères minimum"
                required
                className="pr-10"
              />
              <button
                type="button"
                data-testid="trial-password-toggle"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <Button data-testid="trial-submit-button" type="submit" disabled={submitting} className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700">
            {submitting ? 'Création de votre espace…' : 'Commencer mon essai gratuit'}
          </Button>
          <p className="text-xs text-slate-400 text-center">
            Après 30 jours, contactez-nous à info@arriereplanrh.com pour activer votre accès complet.
          </p>
        </form>
      </DialogContent>
    </Dialog>
  );
};
