import { useState, FormEvent } from 'react';
import { View } from '@/types';
import { useHR } from '@/context/HRContext';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Building2, Lock, CalendarDays, Clock } from 'lucide-react';
import { toast } from 'sonner';

const ACCESS_CODE = 'AGENCE2024';

interface Props {
  onNavigate: (view: View) => void;
}

export default function AgencyPortal({ onNavigate }: Props): JSX.Element {
  const { state, updateReplacement } = useHR();
  const [authenticated, setAuthenticated] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [proposals, setProposals] = useState<Record<string, string>>({});

  const openRequests = state.replacementRequests.filter((r) => r.status === 'Ouverte' || r.status === 'Proposée');

  const handleAccess = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (code.trim().toUpperCase() === ACCESS_CODE) {
      setAuthenticated(true);
      setError('');
    } else {
      setError("Code d'accès invalide.");
    }
  };

  const submitProposal = (id: string): void => {
    const text = (proposals[id] ?? '').trim();
    if (!text) {
      toast.error('Veuillez décrire votre proposition.');
      return;
    }
    updateReplacement(id, { status: 'Proposée', agencyProposal: text });
    toast.success('Proposition envoyée à la pharmacie !');
    setProposals((p) => ({ ...p, [id]: '' }));
  };

  return (
    <div className="min-h-screen bg-slate-900" data-testid="agency-page">
      <header className="border-b border-slate-800">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-sky-500/20 flex items-center justify-center">
              <Building2 className="w-5 h-5 text-sky-400" />
            </div>
            <span className="font-heading font-extrabold text-xl text-white">LuminaHR <span className="text-sky-400 text-sm font-semibold">Agences</span></span>
          </div>
          <button
            data-testid="agency-back-button"
            onClick={() => onNavigate('landing')}
            className="inline-flex items-center gap-2 text-sm font-semibold text-slate-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Retour à l'accueil
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-16">
        {!authenticated ? (
          <div className="max-w-md mx-auto bg-slate-800 rounded-2xl border border-slate-700 p-10">
            <div className="w-12 h-12 rounded-xl bg-sky-500/20 flex items-center justify-center mb-6">
              <Lock className="w-6 h-6 text-sky-400" />
            </div>
            <h1 className="font-heading text-2xl font-bold text-white mb-2">Portail sécurisé</h1>
            <p className="text-sm text-slate-400 mb-8">
              Réservé aux agences de placement partenaires. Entrez votre code d'accès pour consulter les demandes de remplacement.
            </p>
            <form onSubmit={handleAccess} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="agency-code" className="text-slate-300">Code d'accès</Label>
                <Input
                  id="agency-code"
                  data-testid="agency-code-input"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Ex. : AGENCE2024"
                  className="bg-slate-900 border-slate-700 text-white placeholder:text-slate-600"
                  required
                />
              </div>
              {error && <p data-testid="agency-error-message" className="text-sm text-red-400">{error}</p>}
              <Button data-testid="agency-access-button" type="submit" className="w-full rounded-full bg-sky-600 hover:bg-sky-700">
                Accéder au portail
              </Button>
            </form>
            <p className="mt-6 text-xs text-slate-500">Code de démonstration : AGENCE2024</p>
          </div>
        ) : (
          <div data-testid="agency-dashboard">
            <p className="text-xs uppercase tracking-[0.2em] text-sky-400 font-bold mb-3">Demandes de remplacement</p>
            <h1 className="font-heading text-3xl font-extrabold text-white mb-10">
              {openRequests.length} demande{openRequests.length > 1 ? 's' : ''} en cours
            </h1>
            <div className="space-y-6">
              {openRequests.map((req) => (
                <div key={req.id} data-testid={`agency-request-${req.id}`} className="bg-slate-800 rounded-2xl border border-slate-700 p-8">
                  <div className="flex flex-wrap items-center gap-3 mb-4">
                    <h2 className="font-heading text-lg font-bold text-white">{req.position}</h2>
                    <Badge className={req.status === 'Ouverte' ? 'bg-emerald-600' : 'bg-orange-500'}>{req.status}</Badge>
                  </div>
                  <div className="flex flex-wrap gap-5 text-sm text-slate-400 mb-4">
                    <span className="inline-flex items-center gap-1.5"><CalendarDays className="w-4 h-4" /> {req.date}</span>
                    <span className="inline-flex items-center gap-1.5"><Clock className="w-4 h-4" /> {req.startTime} – {req.endTime}</span>
                  </div>
                  <p className="text-sm text-slate-300 mb-6">{req.reason}</p>
                  {req.agencyProposal && (
                    <p className="text-sm text-sky-300 bg-sky-500/10 border border-sky-500/30 rounded-lg p-3 mb-6">
                      Proposition actuelle : {req.agencyProposal}
                    </p>
                  )}
                  <div className="flex flex-col sm:flex-row gap-3">
                    <Input
                      data-testid={`agency-proposal-input-${req.id}`}
                      value={proposals[req.id] ?? ''}
                      onChange={(e) => setProposals((p) => ({ ...p, [req.id]: e.target.value }))}
                      placeholder="Votre proposition (candidat, tarif, disponibilité)…"
                      className="bg-slate-900 border-slate-700 text-white placeholder:text-slate-600 flex-1"
                    />
                    <Button
                      data-testid={`agency-proposal-submit-${req.id}`}
                      onClick={() => submitProposal(req.id)}
                      className="rounded-full bg-sky-600 hover:bg-sky-700"
                    >
                      Proposer un candidat
                    </Button>
                  </div>
                </div>
              ))}
              {openRequests.length === 0 && (
                <p className="text-slate-400 text-sm">Aucune demande de remplacement ouverte pour le moment.</p>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
