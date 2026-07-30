import { useState, FormEvent } from 'react';
import { useHR } from '@/context/HRContext';
import { Position, POSITIONS, ContractType, CANDIDATE_STATUSES, CandidateStatus } from '@/types';
import { ModuleHeader, StatusBadge } from '@/components/modules/shared';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';

export default function RecruitmentModule(): JSX.Element {
  const { state, addJobOffer, updateJobOffer, setCandidateStatus } = useHR();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [position, setPosition] = useState<Position>('ATP');
  const [type, setType] = useState<ContractType>('Temps plein');
  const [salaryRange, setSalaryRange] = useState('');
  const [description, setDescription] = useState('');

  const handleAdd = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    addJobOffer({
      title, position, type, salaryRange, description,
      location: 'Montréal, QC',
      requirements: [],
      postedDate: new Date().toISOString().slice(0, 10),
      active: true,
    });
    toast.success('Offre publiée sur le Portail Carrières.');
    setDialogOpen(false);
    setTitle(''); setSalaryRange(''); setDescription('');
  };

  return (
    <div data-testid="recruitment-module">
      <ModuleHeader
        title="Recrutement"
        subtitle="Gérez vos offres d'emploi et le pipeline de candidatures."
        action={
          <Button data-testid="add-offer-button" onClick={() => setDialogOpen(true)} className="rounded-full bg-emerald-600 hover:bg-emerald-700">
            <Plus className="w-4 h-4 mr-1" /> Nouvelle offre
          </Button>
        }
      />

      <h2 className="font-heading text-base font-bold text-slate-900 mb-4">Offres d'emploi</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-12">
        {state.jobOffers.map((offer) => (
          <div key={offer.id} data-testid={`offer-card-${offer.id}`} className="bg-white rounded-xl border border-slate-200 p-6">
            <div className="flex items-start justify-between gap-3 mb-3">
              <h3 className="font-heading font-bold text-slate-900 text-sm">{offer.title}</h3>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-slate-500">{offer.active ? 'Active' : 'Inactive'}</span>
                <Switch
                  data-testid={`offer-toggle-${offer.id}`}
                  checked={offer.active}
                  onCheckedChange={(checked) => {
                    updateJobOffer(offer.id, { active: checked });
                    toast.success(checked ? 'Offre activée.' : 'Offre désactivée.');
                  }}
                />
              </div>
            </div>
            <p className="text-xs text-slate-500 mb-2">{offer.type} · {offer.salaryRange}</p>
            <p className="text-xs text-slate-400">Publiée le {offer.postedDate} · {state.candidates.filter((c) => c.jobOfferId === offer.id).length} candidature(s)</p>
          </div>
        ))}
      </div>

      <h2 className="font-heading text-base font-bold text-slate-900 mb-4">Pipeline de candidatures ({state.candidates.length})</h2>
      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm min-w-[800px]">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-[0.15em] text-slate-500">
              <th className="p-4">Candidat(e)</th>
              <th className="p-4">Poste visé</th>
              <th className="p-4">Source</th>
              <th className="p-4">Date</th>
              <th className="p-4">Statut</th>
              <th className="p-4">Changer le statut</th>
            </tr>
          </thead>
          <tbody>
            {state.candidates.map((c) => {
              const offer = state.jobOffers.find((o) => o.id === c.jobOfferId);
              return (
                <tr key={c.id} data-testid={`candidate-row-${c.id}`} className="border-b border-slate-100 last:border-0">
                  <td className="p-4">
                    <p className="font-semibold text-slate-800">{c.name}</p>
                    <p className="text-xs text-slate-500">{c.email}</p>
                  </td>
                  <td className="p-4 text-slate-600">{offer?.title ?? '—'}</td>
                  <td className="p-4 text-slate-600">{c.source}</td>
                  <td className="p-4 text-slate-600">{c.appliedDate}</td>
                  <td className="p-4"><StatusBadge status={c.status} /></td>
                  <td className="p-4">
                    <Select value={c.status} onValueChange={(v) => { setCandidateStatus(c.id, v as CandidateStatus); toast.success('Statut mis à jour.'); }}>
                      <SelectTrigger data-testid={`candidate-status-select-${c.id}`} className="w-40 h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {CANDIDATE_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </td>
                </tr>
              );
            })}
            {state.candidates.length === 0 && (
              <tr><td colSpan={6} className="p-8 text-center text-slate-500">Aucune candidature pour le moment.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent data-testid="add-offer-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading">Nouvelle offre d'emploi</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAdd} className="space-y-4">
            <div className="space-y-2">
              <Label>Titre du poste</Label>
              <Input data-testid="offer-title-input" value={title} onChange={(e) => setTitle(e.target.value)} required />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Type de poste</Label>
                <Select value={position} onValueChange={(v) => setPosition(v as Position)}>
                  <SelectTrigger data-testid="offer-position-select"><SelectValue /></SelectTrigger>
                  <SelectContent>{POSITIONS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Horaire</Label>
                <Select value={type} onValueChange={(v) => setType(v as ContractType)}>
                  <SelectTrigger data-testid="offer-type-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Temps plein">Temps plein</SelectItem>
                    <SelectItem value="Temps partiel">Temps partiel</SelectItem>
                    <SelectItem value="Contractuel">Contractuel</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Fourchette salariale</Label>
              <Input data-testid="offer-salary-input" value={salaryRange} onChange={(e) => setSalaryRange(e.target.value)} placeholder="Ex. : 23 $ – 28 $ / h" required />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea data-testid="offer-description-input" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} required />
            </div>
            <Button data-testid="offer-submit-button" type="submit" className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700">
              Publier l'offre
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
