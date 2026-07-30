import { useState, FormEvent } from 'react';
import { View, JobOffer } from '@/types';
import { useHR } from '@/context/HRContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { ArrowLeft, MapPin, Clock, BadgeDollarSign, Pill } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  onNavigate: (view: View) => void;
}

export default function PublicCareers({ onNavigate }: Props): JSX.Element {
  const { state, addCandidate } = useHR();
  const activeOffers = state.jobOffers.filter((o) => o.active);
  const [selected, setSelected] = useState<JobOffer | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');

  const apply = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (!selected) return;
    addCandidate({
      jobOfferId: selected.id,
      name,
      email,
      phone,
      status: 'Nouvelle',
      appliedDate: new Date().toISOString().slice(0, 10),
      notes,
      source: 'Portail Carrières',
    });
    toast.success('Candidature envoyée avec succès !');
    setSelected(null);
    setName(''); setEmail(''); setPhone(''); setNotes('');
  };

  return (
    <div className="min-h-screen bg-slate-50" data-testid="careers-page">
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-white/70 border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-emerald-600 flex items-center justify-center">
              <Pill className="w-5 h-5 text-white" />
            </div>
            <span className="font-heading font-extrabold text-xl text-slate-900">LuminaHR</span>
          </div>
          <button
            data-testid="careers-back-button"
            onClick={() => onNavigate('landing')}
            className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-emerald-700 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Retour à l'accueil
          </button>
        </div>
      </header>

      <div className="relative">
        <img
          src="https://images.unsplash.com/photo-1580281657529-557a6abb6387?auto=format&fit=crop&w=1600&q=60"
          alt="Équipe de pharmacie"
          className="w-full h-64 object-cover"
        />
        <div className="absolute inset-0 bg-slate-900/60 flex items-center">
          <div className="max-w-5xl mx-auto px-6 w-full">
            <p className="text-xs uppercase tracking-[0.2em] text-emerald-400 font-bold mb-3">Portail Carrières</p>
            <h1 className="font-heading text-4xl sm:text-5xl font-extrabold text-white tracking-tight">Rejoignez notre équipe</h1>
          </div>
        </div>
      </div>

      <main className="max-w-5xl mx-auto px-6 py-14">
        <p className="text-sm text-slate-500 mb-8" data-testid="careers-offer-count">
          {activeOffers.length} offre{activeOffers.length > 1 ? 's' : ''} active{activeOffers.length > 1 ? 's' : ''}
        </p>
        <div className="space-y-6">
          {activeOffers.map((offer) => (
            <div key={offer.id} data-testid={`career-offer-${offer.id}`} className="bg-white rounded-2xl border border-slate-200 p-8 hover:border-emerald-500 transition-colors">
              <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                <div>
                  <h2 className="font-heading text-lg font-bold text-slate-900">{offer.title}</h2>
                  <div className="flex flex-wrap gap-4 mt-3 text-sm text-slate-500">
                    <span className="inline-flex items-center gap-1.5"><MapPin className="w-4 h-4" /> {offer.location}</span>
                    <span className="inline-flex items-center gap-1.5"><Clock className="w-4 h-4" /> {offer.type}</span>
                    <span className="inline-flex items-center gap-1.5"><BadgeDollarSign className="w-4 h-4" /> {offer.salaryRange}</span>
                  </div>
                  <p className="mt-4 text-sm text-slate-600 max-w-2xl">{offer.description}</p>
                  <ul className="mt-4 space-y-1">
                    {offer.requirements.map((r) => (
                      <li key={r} className="text-sm text-slate-500 flex items-start gap-2">
                        <span className="text-emerald-600 mt-0.5">•</span> {r}
                      </li>
                    ))}
                  </ul>
                </div>
                <Button
                  data-testid={`apply-button-${offer.id}`}
                  onClick={() => setSelected(offer)}
                  className="rounded-full bg-emerald-600 hover:bg-emerald-700 shrink-0"
                >
                  Postuler
                </Button>
              </div>
            </div>
          ))}
          {activeOffers.length === 0 && (
            <p className="text-slate-500 text-sm">Aucune offre active pour le moment. Revenez bientôt !</p>
          )}
        </div>
      </main>

      <Dialog open={selected !== null} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent data-testid="apply-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading">Postuler — {selected?.title}</DialogTitle>
          </DialogHeader>
          <form onSubmit={apply} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="apply-name">Nom complet</Label>
              <Input id="apply-name" data-testid="apply-name-input" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="apply-email">Courriel</Label>
                <Input id="apply-email" data-testid="apply-email-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="apply-phone">Téléphone</Label>
                <Input id="apply-phone" data-testid="apply-phone-input" value={phone} onChange={(e) => setPhone(e.target.value)} required />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="apply-notes">Message (optionnel)</Label>
              <Textarea id="apply-notes" data-testid="apply-notes-input" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
            </div>
            <Button data-testid="apply-submit-button" type="submit" className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700">
              Envoyer ma candidature
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
