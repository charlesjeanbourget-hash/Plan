import { useState, FormEvent } from 'react';
import { View } from '@/types';
import { useAuth } from '@/context/AuthContext';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Pill, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  onNavigate: (view: View) => void;
  onSuccess: () => void;
}

export default function LoginPage({ onNavigate, onSuccess }: Props): JSX.Element {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const err = await login(email.trim(), password.trim());
    setLoading(false);
    if (err) {
      setError(err);
    } else {
      toast.success('Connexion réussie. Bienvenue !');
      onSuccess();
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 relative">
      <div className="absolute inset-0 opacity-40 bg-[radial-gradient(circle_at_20%_20%,#d1fae5_0,transparent_40%),radial-gradient(circle_at_80%_80%,#ffedd5_0,transparent_40%)]" />
      <div className="relative w-full max-w-md">
        <button
          data-testid="login-back-button"
          onClick={() => onNavigate('landing')}
          className="mb-6 inline-flex items-center gap-2 text-sm text-slate-500 hover:text-emerald-700 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Retour à l'accueil
        </button>
        <div className="bg-white rounded-2xl border border-slate-200 p-10">
          <div className="flex items-center gap-2 mb-8">
            <div className="w-9 h-9 rounded-lg bg-emerald-600 flex items-center justify-center">
              <Pill className="w-5 h-5 text-white" />
            </div>
            <span className="font-heading font-extrabold text-xl text-slate-900">LuminaHR</span>
          </div>
          <h1 className="font-heading text-2xl font-bold text-slate-900 mb-1">Espace Employés & Gestion</h1>
          <p className="text-sm text-slate-500 mb-8">Connectez-vous à votre compte.</p>
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email">Courriel</Label>
              <Input
                id="email"
                data-testid="login-email-input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="vous@pharmacie.ca"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Mot de passe</Label>
              <div className="relative">
                <Input
                  id="password"
                  data-testid="login-password-input"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="pr-10"
                  required
                />
                <button
                  type="button"
                  data-testid="login-password-toggle"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-700 transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            {error && (
              <p data-testid="login-error-message" className="text-sm text-red-600">{error}</p>
            )}
            <Button data-testid="login-submit-button" type="submit" disabled={loading} className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700">
              {loading ? 'Connexion…' : 'Se connecter'}
            </Button>
          </form>
          <div className="mt-8 rounded-lg bg-slate-50 border border-slate-200 p-4 text-xs text-slate-500 space-y-1">
            <p className="font-semibold text-slate-700">Comptes de démonstration :</p>
            <p>Admin — admin@luminahr.ca / admin123</p>
            <p>Employée — julie@luminahr.ca / employe123</p>
          </div>
        </div>
      </div>
    </div>
  );
}
