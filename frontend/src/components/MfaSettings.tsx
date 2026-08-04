import { useState } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ShieldCheck, Smartphone } from 'lucide-react';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export const MfaSettings = (): JSX.Element => {
  const { currentUser, token } = useAuth();
  const headers = { Authorization: `Bearer ${token ?? ''}` };
  const [enabled, setEnabled] = useState(currentUser?.mfaEnabled ?? false);
  const [setup, setSetup] = useState<{ qr_base64: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const startSetup = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await axios.post<{ qr_base64: string; secret: string }>(`${API}/auth/mfa/setup`, {}, { headers });
      setSetup(r.data);
      setCode('');
    } catch {
      toast.error('Activation impossible pour le moment.');
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (): Promise<void> => {
    setBusy(true);
    try {
      await axios.post(`${API}/auth/mfa/enable`, { code }, { headers });
      toast.success('Vérification en 2 étapes activée. Un code vous sera demandé à chaque connexion.');
      setEnabled(true);
      setSetup(null);
      setCode('');
    } catch (err) {
      const detail = axios.isAxiosError(err) && err.response ? (err.response.data as { detail?: unknown }).detail : null;
      toast.error(typeof detail === 'string' ? detail : 'Code invalide.');
    } finally {
      setBusy(false);
    }
  };

  const disable = async (): Promise<void> => {
    setBusy(true);
    try {
      await axios.post(`${API}/auth/mfa/disable`, { code }, { headers });
      toast.success('Vérification en 2 étapes désactivée.');
      setEnabled(false);
      setCode('');
    } catch (err) {
      const detail = axios.isAxiosError(err) && err.response ? (err.response.data as { detail?: unknown }).detail : null;
      toast.error(typeof detail === 'string' ? detail : 'Code invalide.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-t border-slate-200 pt-4 mt-1" data-testid="mfa-settings">
      <p className="text-sm font-bold text-slate-900 inline-flex items-center gap-2">
        <ShieldCheck className={`w-4 h-4 ${enabled ? 'text-emerald-600' : 'text-slate-400'}`} />
        Vérification en 2 étapes (MFA)
        {enabled && <span className="rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5">Activée</span>}
      </p>
      {!enabled && !setup && (
        <>
          <p className="text-xs text-slate-500 mt-1.5">Protégez votre compte avec un code généré par Google Authenticator, Authy ou une application similaire.</p>
          <Button data-testid="mfa-setup-button" size="sm" variant="outline" onClick={() => void startSetup()} disabled={busy} className="rounded-full text-xs mt-2.5">
            <Smartphone className="w-3.5 h-3.5 mr-1" /> {busy ? 'Préparation…' : 'Activer la vérification en 2 étapes'}
          </Button>
        </>
      )}
      {!enabled && setup && (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-slate-600">1. Scannez ce code QR avec votre application d'authentification :</p>
          <img data-testid="mfa-qr-image" src={`data:image/png;base64,${setup.qr_base64}`} alt="Code QR MFA" className="w-40 h-40 rounded-lg border border-slate-200 mx-auto" />
          <p className="text-[11px] text-slate-400 text-center break-all">Clé manuelle : {setup.secret}</p>
          <p className="text-xs text-slate-600">2. Entrez le code à 6 chiffres affiché :</p>
          <div className="flex gap-2">
            <Input data-testid="mfa-confirm-code-input" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="123456" className="text-center font-bold tracking-[0.3em]" />
            <Button data-testid="mfa-confirm-button" size="sm" onClick={() => void confirm()} disabled={busy || code.length !== 6} className="rounded-full bg-emerald-600 hover:bg-emerald-700 text-xs shrink-0">
              Confirmer
            </Button>
          </div>
        </div>
      )}
      {enabled && (
        <div className="mt-2.5 flex gap-2">
          <Input data-testid="mfa-disable-code-input" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="Code à 6 chiffres" className="text-center text-xs" />
          <Button data-testid="mfa-disable-button" size="sm" variant="outline" onClick={() => void disable()} disabled={busy || code.length !== 6} className="rounded-full text-xs text-red-600 shrink-0">
            Désactiver
          </Button>
        </div>
      )}
    </div>
  );
};
