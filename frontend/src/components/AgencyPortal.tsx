import { useState, FormEvent } from 'react';
import { View } from '@/types';
import { useHR } from '@/context/HRContext';
import { BrandLogo } from '@/components/BrandLogo';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Lock, CalendarDays, Clock } from 'lucide-react';
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
    <div className="min-h-screen bg-slate-50" data-testid="agency-page">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 sm:h-20 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <BrandLogo size="sm" hideTextOnSmall />
            <span className="hidden sm:inline-flex px-2.5 py-0.5 rounded-full bg-bronze-100 text-bronze-800 text-xs font-bold">Agences</span>
          </div>
          <button
            data-testid="agency-back-button"
            onClick={() => onNavigate('landing')}
            className="inline-flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-slate-900 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Retour à l'accueil
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-16">
        {!authenticated ? (
          <div className="max-w-md mx-auto bg-white rounded-2xl border border-slate-200 shadow-sm p-10">
            <div className="w-12 h-12 rounded-xl bg-bronze-100 flex items-center justify-center mb-6">
              <Lock className="w-6 h-6 text-bronze-700" />
            </div>
            <h1 className="font-heading text-2xl font-bold text-slate-900 mb-2">Portail sécurisé</h1>
            <p className="text-sm text-slate-500 mb-8">
              Réservé aux agences de placement partenaires. Entrez votre code d'accès pour consulter les demandes de remplacement.
            </p>
            <form onSubmit={handleAccess} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="agency-code">Code d'accès</Label>
                <Input
                  id="agency-code"
                  data-testid="agency-code-input"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Ex. : AGENCE2024"
                  required
                />
              </div>
              {error && <p data-testid="agency-error-message" className="text-sm text-red-600">{error}</p>}
              <Button data-testid="agency-access-button" type="submit" className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700">
                Accéder au portail
              </Button>
            </form>
            <p className="mt-6 text-xs text-slate-400">Code de démonstration : AGENCE2024</p>
          </div>
        ) : (
          <div data-testid="agency-dashboard">
            <span className="block w-12 h-1 rounded-full bg-gradient-to-r from-emerald-500 to-bronze-500 mb-4" />
            <p className="text-xs uppercase tracking-[0.2em] text-bronze-700 font-bold mb-3">Demandes de remplacement</p>
            <h1 className="font-heading text-3xl font-extrabold text-slate-900 mb-10">
              {openRequests.length} demande{openRequests.length > 1 ? 's' : ''} en cours
            </h1>
            <div className="space-y-6">
              {openRequests.map((req) => (
                <div key={req.id} data-testid={`agency-request-${req.id}`} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
                  <div className="flex flex-wrap items-center gap-3 mb-4">
                    <h2 className="font-heading text-lg font-bold text-slate-900">{req.position}</h2>
                    <Badge className={req.status === 'Ouverte' ? 'bg-emerald-600' : 'bg-bronze-500'}>{req.status}</Badge>
                  </div>
                  <div className="flex flex-wrap gap-5 text-sm text-slate-500 mb-4">
                    <span className="inline-flex items-center gap-1.5"><CalendarDays className="w-4 h-4" /> {req.date}</span>
                    <span className="inline-flex items-center gap-1.5"><Clock className="w-4 h-4" /> {req.startTime} – {req.endTime}</span>
                  </div>
                  <p className="text-sm text-slate-600 mb-6">{req.reason}</p>
                  {req.agencyProposal && (
                    <p className="text-sm text-bronze-800 bg-bronze-50 border border-bronze-200 rounded-lg p-3 mb-6">
                      Proposition actuelle : {req.agencyProposal}
                    </p>
                  )}
                  <div className="flex flex-col sm:flex-row gap-3">
                    <Input
                      data-testid={`agency-proposal-input-${req.id}`}
                      value={proposals[req.id] ?? ''}
                      onChange={(e) => setProposals((p) => ({ ...p, [req.id]: e.target.value }))}
                      placeholder="Votre proposition (candidat, tarif, disponibilité)…"
                      className="flex-1"
                    />
                    <Button
                      data-testid={`agency-proposal-submit-${req.id}`}
                      onClick={() => submitProposal(req.id)}
                      className="rounded-full bg-emerald-600 hover:bg-emerald-700"
                    >
                      Proposer un candidat
                    </Button>
                  </div>
                </div>
              ))}
              {openRequests.length === 0 && (
                <p className="text-slate-500 text-sm">Aucune demande de remplacement ouverte pour le moment.</p>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
