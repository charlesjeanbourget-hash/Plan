import { useState, useEffect, FormEvent } from 'react';
import axios from 'axios';
import { PublicReplacementRequest } from '@/types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { CalendarDays, CheckCircle2, AlertTriangle } from 'lucide-react';
import { BrandLogo } from '@/components/BrandLogo';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

interface Props {
  token: string;
}

export default function PublicReplacementPage({ token }: Props): JSX.Element {
  const [req, setReq] = useState<PublicReplacementRequest | null>(null);
  const [loadError, setLoadError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [agencyName, setAgencyName] = useState('');
  const [agencyEmail, setAgencyEmail] = useState('');
  const [candidateName, setCandidateName] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [expYears, setExpYears] = useState('0');
  const [rate, setRate] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    axios.get<PublicReplacementRequest>(`${API}/replacements/public/${token}`)
      .then((r) => setReq(r.data))
      .catch(() => setLoadError('Cette demande est introuvable ou expirée. Vérifiez le lien reçu par courriel.'));
  }, [token]);

  const submit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setFormError('');
    try {
      await axios.post(`${API}/replacements/public/${token}/offers`, {
        agency_name: agencyName,
        agency_email: agencyEmail,
        candidate_name: candidateName,
        license_number: licenseNumber,
        experience_years: Number(expYears) || 0,
        hourly_rate: Number(rate),
        phone,
        email,
        note,
      });
      setSubmitted(true);
    } catch (err) {
      const detail = axios.isAxiosError(err) && err.response ? (err.response.data as { detail?: unknown }).detail : null;
      setFormError(typeof detail === 'string' ? detail : 'Envoi impossible. Réessayez.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="public-replacement-page" className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="max-w-3xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <BrandLogo size="sm" />
          <p className="text-xs font-bold uppercase tracking-[0.15em] text-bronze-700">Espace agence — remplacement</p>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10">
        {loadError && (
          <div data-testid="public-request-error" className="bg-white rounded-xl border border-red-200 p-10 text-center">
            <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-3" />
            <p className="text-slate-700">{loadError}</p>
          </div>
        )}

        {req && (
          <>
            <div className="bg-white rounded-xl border border-slate-200 p-7 mb-6" data-testid="public-request-card">
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <h1 className="font-heading text-2xl font-extrabold text-slate-900">{req.role}</h1>
                <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${req.status === 'open' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
                  {req.status === 'open' ? 'Demande ouverte' : 'Demande comblée'}
                </span>
                <span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold bg-bronze-50 text-bronze-800">Urgence : {req.urgency}</span>
              </div>
              <p className="text-xs uppercase tracking-[0.15em] text-slate-500 font-semibold mb-2">Plages à combler</p>
              <div className="flex flex-wrap gap-2 mb-4">
                {req.slots.map((s, i) => (
                  <span key={i} className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 text-emerald-800 px-3 py-1.5 text-sm">
                    <CalendarDays className="w-4 h-4" /> {s.date} · {s.start}–{s.end}
                  </span>
                ))}
              </div>
              {req.notes && <p className="text-sm text-slate-600">{req.notes}</p>}
            </div>

            {req.status !== 'open' ? (
              <div className="bg-white rounded-xl border border-slate-200 p-10 text-center" data-testid="request-filled-notice">
                <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto mb-3" />
                <p className="text-slate-700 font-semibold">Cette demande est déjà comblée.</p>
                <p className="text-sm text-slate-500 mt-1">Merci de votre intérêt — la pharmacie vous contactera pour ses prochains besoins.</p>
              </div>
            ) : submitted ? (
              <div className="bg-white rounded-xl border border-emerald-200 p-10 text-center" data-testid="offer-success">
                <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto mb-3" />
                <p className="font-heading text-xl font-extrabold text-slate-900 mb-1">Offre transmise !</p>
                <p className="text-sm text-slate-600">
                  La pharmacie a reçu votre proposition instantanément. Vous serez avisé(e) par courriel dès qu'une décision sera prise.
                </p>
              </div>
            ) : (
              <form onSubmit={(e) => void submit(e)} className="bg-white rounded-xl border border-slate-200 p-7 space-y-4" data-testid="offer-form">
                <h2 className="font-heading text-lg font-bold text-slate-900">Proposer un remplaçant</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Nom de votre agence *</Label>
                    <Input data-testid="offer-agency-name" value={agencyName} onChange={(e) => setAgencyName(e.target.value)} required />
                  </div>
                  <div className="space-y-2">
                    <Label>Courriel de l'agence *</Label>
                    <Input data-testid="offer-agency-email" type="email" value={agencyEmail} onChange={(e) => setAgencyEmail(e.target.value)} required />
                  </div>
                  <div className="space-y-2">
                    <Label>Nom du candidat / de la candidate *</Label>
                    <Input data-testid="offer-candidate-name" value={candidateName} onChange={(e) => setCandidateName(e.target.value)} required />
                  </div>
                  <div className="space-y-2">
                    <Label>Numéro de licence (si applicable)</Label>
                    <Input data-testid="offer-license" value={licenseNumber} onChange={(e) => setLicenseNumber(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Années d'expérience</Label>
                    <Input data-testid="offer-experience" type="number" min="0" value={expYears} onChange={(e) => setExpYears(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Taux horaire demandé ($/h) *</Label>
                    <Input data-testid="offer-rate" type="number" min="1" step="0.25" value={rate} onChange={(e) => setRate(e.target.value)} required />
                  </div>
                  <div className="space-y-2">
                    <Label>Téléphone du candidat</Label>
                    <Input data-testid="offer-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Courriel du candidat</Label>
                    <Input data-testid="offer-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Note (disponibilités, précisions…)</Label>
                  <Textarea data-testid="offer-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
                </div>
                {formError && <p data-testid="offer-error" className="text-sm text-red-600">{formError}</p>}
                <Button data-testid="offer-submit" type="submit" disabled={busy} className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700">
                  {busy ? 'Envoi…' : 'Soumettre cette offre'}
                </Button>
                <p className="text-xs text-slate-400 text-center">L'administration de la pharmacie recevra votre offre instantanément.</p>
              </form>
            )}
          </>
        )}
      </main>
    </div>
  );
}
