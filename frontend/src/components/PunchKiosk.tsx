import { useState } from 'react';
import axios from 'axios';
import { View, PunchActionResult, PunchPreview } from '@/types';
import { fmtTime } from '@/lib/pharmacy';
import { ArrowLeft, Pill, Delete, LogIn, LogOut, UserCheck } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

interface Props {
  onNavigate: (v: View) => void;
}

const extractDetail = (err: unknown): string => {
  const detail = axios.isAxiosError(err) && err.response ? (err.response.data as { detail?: unknown }).detail : null;
  return typeof detail === 'string' ? detail : 'Erreur de communication avec le serveur.';
};

export default function PunchKiosk({ onNavigate }: Props): JSX.Element {
  const [code, setCode] = useState('');
  const [preview, setPreview] = useState<PunchPreview | null>(null);
  const [result, setResult] = useState<PunchActionResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const press = (digit: string): void => {
    setError('');
    setResult(null);
    if (code.length < 4) setCode(code + digit);
  };

  const reset = (): void => {
    setCode('');
    setPreview(null);
    setError('');
  };

  const submit = async (): Promise<void> => {
    if (code.length !== 4 || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await axios.post<PunchPreview>(`${API}/punch/preview`, { code });
      setPreview(res.data);
    } catch (err) {
      setError(extractDetail(err));
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await axios.post<PunchActionResult>(`${API}/punch`, { code });
      setResult(res.data);
      setCode('');
      setPreview(null);
      window.setTimeout(() => setResult(null), 8000);
    } catch (err) {
      setError(extractDetail(err));
      setCode('');
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="punch-kiosk" className="min-h-screen bg-slate-900 flex flex-col items-center justify-center px-4 py-10">
      <button
        data-testid="kiosk-back-button"
        onClick={() => onNavigate('landing')}
        className="fixed top-5 left-5 inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors"
      >
        <ArrowLeft className="w-4 h-4" /> Retour au site
      </button>

      <div className="flex items-center gap-2 mb-8">
        <span className="w-10 h-10 rounded-xl bg-emerald-500 flex items-center justify-center">
          <Pill className="w-5 h-5 text-white" />
        </span>
        <div>
          <p className="font-heading font-extrabold text-white text-lg leading-tight">LuminaHR</p>
          <p className="text-xs text-slate-400">Borne de punch — entrez votre NIP personnel</p>
        </div>
      </div>

      <div className="w-full max-w-xs">
        {preview ? (
          <div data-testid="kiosk-confirm-panel" className="rounded-2xl bg-slate-800 border border-emerald-500/40 p-6 text-center">
            <UserCheck className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
            <p className="text-white font-heading font-extrabold text-xl mb-1" data-testid="kiosk-confirm-name">
              Êtes-vous bien {preview.employee_name} ?
            </p>
            <p className="text-sm text-slate-300 mb-6">
              {preview.next_action === 'in'
                ? 'Vous allez puncher votre ENTRÉE.'
                : `Vous allez puncher votre SORTIE${preview.since ? ` (entrée à ${fmtTime(preview.since)})` : ''}.`}
            </p>
            <button
              data-testid="kiosk-confirm-yes"
              onClick={() => void confirm()}
              disabled={busy}
              className="w-full h-14 rounded-2xl bg-emerald-600 text-white font-bold hover:bg-emerald-500 disabled:opacity-40 active:scale-95 transition-all mb-3"
            >
              Oui, c'est moi — confirmer
            </button>
            <button
              data-testid="kiosk-confirm-no"
              onClick={reset}
              disabled={busy}
              className="w-full h-12 rounded-2xl bg-slate-700 text-slate-300 font-semibold hover:bg-slate-600 active:scale-95 transition-all"
            >
              Non, ce n'est pas moi
            </button>
          </div>
        ) : (
          <>
            <div data-testid="kiosk-code-display" className="bg-slate-800 rounded-2xl h-16 flex items-center justify-center gap-3 mb-4 border border-slate-700">
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className={`w-4 h-4 rounded-full ${i < code.length ? 'bg-emerald-400' : 'bg-slate-600'}`} />
              ))}
            </div>

            {result && (
              <div data-testid="kiosk-result" className={`rounded-xl p-4 mb-4 text-center ${result.action === 'in' ? 'bg-emerald-500/15 border border-emerald-500/40' : 'bg-sky-500/15 border border-sky-500/40'}`}>
                <p className="text-white font-heading font-bold inline-flex items-center gap-2">
                  {result.action === 'in' ? <LogIn className="w-4 h-4 text-emerald-400" /> : <LogOut className="w-4 h-4 text-sky-400" />}
                  Bonjour {result.employee_name} !
                </p>
                <p className="text-sm text-slate-300 mt-1">
                  {result.action === 'in'
                    ? `Entrée enregistrée à ${fmtTime(result.time)}. Bon quart de travail !`
                    : `Sortie enregistrée à ${fmtTime(result.time)} — durée : ${result.duration_hours} h. À bientôt !`}
                </p>
              </div>
            )}
            {error && (
              <p data-testid="kiosk-error" className="rounded-xl bg-red-500/15 border border-red-500/40 text-red-300 text-sm text-center p-3 mb-4">{error}</p>
            )}

            <div className="grid grid-cols-3 gap-3">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
                <button
                  key={d}
                  data-testid={`kiosk-key-${d}`}
                  onClick={() => press(d)}
                  className="h-16 rounded-2xl bg-slate-800 border border-slate-700 text-white text-xl font-bold hover:bg-slate-700 active:scale-95 transition-all"
                >
                  {d}
                </button>
              ))}
              <button
                data-testid="kiosk-key-clear"
                onClick={reset}
                className="h-16 rounded-2xl bg-slate-800 border border-slate-700 text-slate-400 flex items-center justify-center hover:bg-slate-700 active:scale-95 transition-all"
                aria-label="Effacer"
              >
                <Delete className="w-5 h-5" />
              </button>
              <button
                data-testid="kiosk-key-0"
                onClick={() => press('0')}
                className="h-16 rounded-2xl bg-slate-800 border border-slate-700 text-white text-xl font-bold hover:bg-slate-700 active:scale-95 transition-all"
              >
                0
              </button>
              <button
                data-testid="kiosk-submit"
                onClick={() => void submit()}
                disabled={code.length !== 4 || busy}
                className="h-16 rounded-2xl bg-emerald-600 text-white font-bold hover:bg-emerald-500 disabled:opacity-40 active:scale-95 transition-all"
              >
                OK
              </button>
            </div>
            <p className="text-center text-xs text-slate-500 mt-6">
              Un punch = entrée · un second punch = sortie. Votre identité sera confirmée avant l'enregistrement.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
