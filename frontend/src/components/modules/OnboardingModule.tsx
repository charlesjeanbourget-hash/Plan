import { FormEvent, useRef, useState } from 'react';
import { useHR } from '@/context/HRContext';
import { OnboardingCategory, POSITIONS, Position, Candidate } from '@/types';
import { ModuleHeader, EmptyState } from '@/components/modules/shared';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, ScanLine, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { parseCvText, readCvFile } from '@/lib/parseCv';
import { HireCandidateDialog } from '@/components/HireCandidateDialog';

const CATEGORIES: OnboardingCategory[] = ['Documents', 'Formation', 'Équipement', 'Intégration'];

const DEFAULT_STEPS: { label: string; category: OnboardingCategory }[] = [
  { label: 'Contrat de travail signé', category: 'Documents' },
  { label: 'Spécimen de chèque / dépôt direct', category: 'Documents' },
  { label: 'Formulaires d’impôt (TD1 / TP-1015.3)', category: 'Documents' },
  { label: 'Formation Loi 25 et confidentialité', category: 'Formation' },
  { label: 'Formation caisse et systèmes internes', category: 'Formation' },
  { label: 'Uniforme / sarrau remis', category: 'Équipement' },
  { label: 'Code de punch et accès créés', category: 'Équipement' },
  { label: 'Visite de la pharmacie et présentation de l’équipe', category: 'Intégration' },
  { label: 'Jumelage avec un(e) mentor(e)', category: 'Intégration' },
];

export default function OnboardingModule(): JSX.Element {
  const { state, toggleOnboardingItem, addOnboardingItem, addCandidate, getEmployee } = useHR();
  const fileRef = useRef<HTMLInputElement>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [hireEmployeeId, setHireEmployeeId] = useState('');
  const [startOpen, setStartOpen] = useState(false);
  const [hireCandidate, setHireCandidate] = useState<Candidate | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [position, setPosition] = useState<Position>('ATP');

  const employeeIds = Array.from(new Set(state.onboardingItems.map((o) => o.employeeId)));
  const prospects = state.candidates.filter((c) => c.status !== 'Embauché(e)' && c.status !== 'Refusé(e)');

  const saveProspect = (source: 'Portail Carrières' | 'Agence' | 'Interne'): void => {
    if (!name.trim()) { toast.error('Le nom du prospect est obligatoire.'); return; }
    addCandidate({
      jobOfferId: state.jobOffers.find((o) => o.active)?.id ?? state.jobOffers[0]?.id ?? '',
      name: name.trim(), email: email.trim(), phone: phone.trim(),
      status: 'Nouvelle', appliedDate: new Date().toISOString().slice(0, 10),
      notes, source,
    });
    toast.success(`Fiche prospect créée pour ${name.trim()}.`);
    setManualOpen(false); setScanOpen(false);
    setName(''); setEmail(''); setPhone(''); setNotes('');
  };

  const onCvFile = async (file: File): Promise<void> => {
    try {
      const parsed = parseCvText(await readCvFile(file));
      setName(parsed.name || file.name.replace(/\.[^.]+$/, ''));
      setEmail(parsed.email); setPhone(parsed.phone);
      setNotes(parsed.notes || `CV importé : ${file.name}`);
      setScanOpen(true);
      toast.success('CV lu — vérifiez la fiche avant d’enregistrer.');
    } catch {
      toast.error('Lecture impossible. Collez le texte du CV.');
      setScanOpen(true);
    }
  };

  const startOnboarding = (e: FormEvent): void => {
    e.preventDefault();
    if (!hireEmployeeId) return;
    if (state.onboardingItems.some((i) => i.employeeId === hireEmployeeId)) {
      toast.info('Un parcours existe déjà pour cette personne.');
      setStartOpen(false); return;
    }
    DEFAULT_STEPS.forEach((step) => addOnboardingItem({ employeeId: hireEmployeeId, label: step.label, done: false, category: step.category }));
    const emp = getEmployee(hireEmployeeId);
    toast.success(`Parcours lancé pour ${emp ? `${emp.firstName} ${emp.lastName}` : 'l’employé'}.`);
    setStartOpen(false); setHireEmployeeId('');
  };

  return (
    <div data-testid="onboarding-module">
      <ModuleHeader title="Intégration & prospects" subtitle="Scannez un CV, créez une fiche à la main, puis suivez l’intégration." action={
        <div className="flex flex-wrap gap-2">
          <input ref={fileRef} type="file" accept=".txt,.md,.rtf,.csv,.pdf,.doc,.docx,text/plain" className="hidden" data-testid="onboarding-cv-input" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onCvFile(f); e.target.value = ''; }} />
          <Button data-testid="scan-cv-button" variant="outline" onClick={() => fileRef.current?.click()} className="rounded-full border-bronze-300 text-bronze-800"><ScanLine className="w-4 h-4 mr-1" /> Scanner un CV</Button>
          <Button data-testid="add-prospect-button" variant="outline" onClick={() => setManualOpen(true)} className="rounded-full"><UserPlus className="w-4 h-4 mr-1" /> Nouveau prospect</Button>
          <Button data-testid="start-onboarding-button" onClick={() => setStartOpen(true)} className="rounded-full bg-emerald-600 hover:bg-emerald-700"><Plus className="w-4 h-4 mr-1" /> Lancer une intégration</Button>
        </div>
      } />
      <h2 className="font-heading text-base font-bold text-slate-900 mb-3">Prospects ({prospects.length})</h2>
      {prospects.length === 0 ? <p className="text-sm text-slate-500 mb-8">Aucun prospect. Scannez un CV ou créez une fiche.</p> : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mb-10">
          {prospects.map((c) => (
            <div key={c.id} data-testid={`prospect-card-${c.id}`} className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="font-semibold text-slate-800">{c.name}</p>
              <p className="text-xs text-slate-500">{c.email || '—'} · {c.phone || '—'}</p>
              <p className="text-[11px] text-slate-400 mt-1">{c.source} · {c.status} · {c.appliedDate}</p>
              {c.notes && <p className="text-xs text-slate-600 mt-2 line-clamp-3 whitespace-pre-wrap">{c.notes}</p>}
              <Button data-testid={`prospect-hire-${c.id}`} size="sm" className="mt-3 rounded-full bg-emerald-600 hover:bg-emerald-700 text-xs" onClick={() => setHireCandidate(c)}>Créer la fiche employé</Button>
            </div>
          ))}
        </div>
      )}
      <h2 className="font-heading text-base font-bold text-slate-900 mb-3">Parcours d’intégration</h2>
      {employeeIds.length === 0 ? <EmptyState text="Aucun onboarding en cours." /> : (
        <div className="space-y-8">
          {employeeIds.map((empId) => {
            const emp = getEmployee(empId);
            const items = state.onboardingItems.filter((o) => o.employeeId === empId);
            const done = items.filter((i) => i.done).length;
            const percent = items.length ? Math.round((done / items.length) * 100) : 0;
            return (
              <div key={empId} data-testid={`onboarding-card-${empId}`} className="bg-white rounded-xl border border-slate-200 p-8">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
                  <div>
                    <h2 className="font-heading text-lg font-bold text-slate-900">{emp ? `${emp.firstName} ${emp.lastName}` : 'Employé inconnu'}</h2>
                    <p className="text-sm text-slate-500">{emp?.position} · embauché(e) le {emp?.hireDate}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-heading text-2xl font-extrabold text-emerald-700" data-testid={`onboarding-percent-${empId}`}>{percent} %</p>
                    <p className="text-xs text-slate-500">{done} / {items.length} étapes</p>
                  </div>
                </div>
                <Progress value={percent} className="h-2 mb-8" />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {CATEGORIES.map((cat) => {
                    const catItems = items.filter((i) => i.category === cat);
                    if (catItems.length === 0) return null;
                    return (
                      <div key={cat}>
                        <p className="text-xs uppercase tracking-[0.15em] text-slate-500 font-semibold mb-3">{cat}</p>
                        <div className="space-y-2.5">
                          {catItems.map((item) => (
                            <label key={item.id} className="flex items-center gap-3 cursor-pointer group">
                              <Checkbox data-testid={`onboarding-item-${item.id}`} checked={item.done} onCheckedChange={() => { toggleOnboardingItem(item.id); toast.success(item.done ? 'Étape réouverte.' : 'Étape complétée !'); }} />
                              <span className={`text-sm ${item.done ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{item.label}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <Dialog open={manualOpen || scanOpen} onOpenChange={(v) => { setManualOpen(v); setScanOpen(v); }}>
        <DialogContent data-testid="prospect-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading">{scanOpen ? 'Fiche extraite du CV' : 'Nouveau prospect'}</DialogTitle>
            <DialogDescription>Vérifiez les champs, puis enregistrez.</DialogDescription>
          </DialogHeader>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); saveProspect(scanOpen ? 'Portail Carrières' : 'Interne'); }}>
            <div className="space-y-1.5"><Label>Nom</Label><Input data-testid="prospect-name" value={name} onChange={(e) => setName(e.target.value)} required /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Courriel</Label><Input data-testid="prospect-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Téléphone</Label><Input data-testid="prospect-phone" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
            </div>
            <div className="space-y-1.5"><Label>Poste visé</Label>
              <Select value={position} onValueChange={(v) => setPosition(v as Position)}>
                <SelectTrigger data-testid="prospect-position"><SelectValue /></SelectTrigger>
                <SelectContent>{POSITIONS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>Notes / extrait du CV</Label><Textarea data-testid="prospect-notes" rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
            <Button data-testid="prospect-save" type="submit" className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700">Créer la fiche prospect</Button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={startOpen} onOpenChange={setStartOpen}>
        <DialogContent data-testid="start-onboarding-dialog">
          <DialogHeader><DialogTitle>Lancer une intégration</DialogTitle></DialogHeader>
          <form onSubmit={startOnboarding} className="space-y-4">
            <Select value={hireEmployeeId} onValueChange={setHireEmployeeId}>
              <SelectTrigger data-testid="onboarding-employee-select"><SelectValue placeholder="Employé" /></SelectTrigger>
              <SelectContent>{state.employees.filter((e) => e.status === 'Actif' && !e.anonymized).map((e) => <SelectItem key={e.id} value={e.id}>{e.firstName} {e.lastName}</SelectItem>)}</SelectContent>
            </Select>
            <Button type="submit" disabled={!hireEmployeeId} className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700">Créer les {DEFAULT_STEPS.length} étapes</Button>
          </form>
        </DialogContent>
      </Dialog>
      <HireCandidateDialog candidate={hireCandidate} suggestedPosition={position} onClose={() => setHireCandidate(null)} />
    </div>
  );
}
