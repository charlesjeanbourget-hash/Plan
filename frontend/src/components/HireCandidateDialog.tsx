import { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { useHR } from '@/context/HRContext';
import { Candidate, Position, POSITIONS } from '@/types';
import { PHARMACY_TASKS } from '@/lib/pharmacy';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { UserPlus } from 'lucide-react';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const AVATAR_COLORS = ['bg-emerald-600', 'bg-sky-600', 'bg-bronze-600', 'bg-violet-600', 'bg-rose-600', 'bg-amber-600'];

export const HireCandidateDialog = ({ candidate, suggestedPosition, onClose }: {
  candidate: Candidate | null;
  suggestedPosition?: Position;
  onClose: () => void;
}): JSX.Element => {
  const { token } = useAuth();
  const { state, addEmployee } = useHR();
  const [position, setPosition] = useState<Position>('ATP');
  const [rate, setRate] = useState('');
  const [capacities, setCapacities] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!candidate) return;
    setPosition(suggestedPosition ?? 'ATP');
    setRate('');
    setCapacities([]);
  }, [candidate, suggestedPosition]);

  const toggleCapacity = (c: string): void =>
    setCapacities((list) => (list.includes(c) ? list.filter((x) => x !== c) : [...list, c]));

  const hire = async (): Promise<void> => {
    if (!candidate) return;
    setBusy(true);
    const parts = candidate.name.trim().split(/\s+/);
    const firstName = parts[0] ?? candidate.name;
    const lastName = parts.slice(1).join(' ') || '—';
    const today = new Date().toISOString().slice(0, 10);
    const emp = addEmployee({
      firstName,
      lastName,
      email: candidate.email,
      phone: candidate.phone,
      position,
      branchId: state.branches[0]?.id ?? 'b1',
      status: 'Actif',
      hireDate: today,
      hourlyRate: Math.max(0, Number(rate.replace(',', '.')) || 0),
      weeklyHours: 35,
      address: '',
      emergencyContact: '',
      avatarColor: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
    });
    try {
      await axios.put(`${API}/profiles/${emp.id}`, {
        employee_name: `${firstName} ${lastName}`,
        roles: [position],
        capacities,
      }, { headers: { Authorization: `Bearer ${token ?? ''}` } });
    } catch {
      toast.error('Fiche créée, mais le profil (capacités) n\'a pas pu être enregistré — complétez-le dans Employés.');
    }
    toast.success(`${candidate.name} embauché(e) ! Fiche employé créée avec ${capacities.length} capacité(s).`, { duration: 6000 });
    setBusy(false);
    onClose();
  };

  return (
    <Dialog open={!!candidate} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="hire-candidate-dialog" className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading inline-flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-emerald-600" /> Embaucher {candidate?.name}
          </DialogTitle>
          <DialogDescription>
            Sa fiche employé sera créée automatiquement (nom, courriel, téléphone) avec le poste et les capacités choisis.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Poste</Label>
            <Select value={position} onValueChange={(v) => setPosition(v as Position)}>
              <SelectTrigger data-testid="hire-position-select"><SelectValue /></SelectTrigger>
              <SelectContent>
                {POSITIONS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Taux horaire ($/h, optionnel)</Label>
            <Input data-testid="hire-rate-input" value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" placeholder="Ex. 22.50" />
          </div>
        </div>
        <div className="space-y-2">
          <Label>Capacités et tâches maîtrisées ({capacities.length})</Label>
          <div data-testid="hire-capacities" className="flex flex-wrap gap-1.5 max-h-44 overflow-y-auto rounded-lg border border-slate-200 p-3">
            {PHARMACY_TASKS.map((t, i) => (
              <button
                key={t}
                type="button"
                data-testid={`hire-capacity-${i}`}
                onClick={() => toggleCapacity(t)}
                className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${
                  capacities.includes(t)
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-emerald-300'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
        <Button
          data-testid="hire-confirm-button"
          onClick={() => void hire()}
          disabled={busy}
          className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700"
        >
          {busy ? 'Création…' : 'Créer la fiche employé'}
        </Button>
      </DialogContent>
    </Dialog>
  );
};
