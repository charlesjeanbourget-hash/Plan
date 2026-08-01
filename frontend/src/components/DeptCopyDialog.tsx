import { useState } from 'react';
import { useHR } from '@/context/HRContext';
import { DEPARTMENTS } from '@/lib/pharmacy';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Layers, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onClose: () => void;
  days: string[];
}

export const DeptCopyDialog = ({ open, onClose, days }: Props): JSX.Element => {
  const { state, addShift } = useHR();
  const [source, setSource] = useState('Général');
  const [target, setTarget] = useState('Plancher');
  const [remap, setRemap] = useState<Record<string, string>>({});

  const sourceShifts = state.shifts.filter(
    (s) => s.date >= days[0] && s.date <= days[6] && (s.department ?? 'Général') === source);
  const sourceEmpIds = Array.from(new Set(sourceShifts.map((s) => s.employeeId)));

  const copy = (): void => {
    if (source === target) {
      toast.error('Choisissez deux départements différents.');
      return;
    }
    let copied = 0;
    let skipped = 0;
    sourceShifts.forEach((s) => {
      const empId = remap[s.employeeId] ?? s.employeeId;
      const exists = state.shifts.some((x) => x.employeeId === empId && x.date === s.date
        && x.startTime === s.startTime && x.endTime === s.endTime && (x.department ?? 'Général') === target);
      if (exists) {
        skipped += 1;
        return;
      }
      addShift({ employeeId: empId, date: s.date, startTime: s.startTime, endTime: s.endTime, department: target });
      copied += 1;
    });
    toast.success(`${copied} quart(s) copiés de « ${source} » vers « ${target} »${skipped > 0 ? ` · ${skipped} ignorés (déjà présents)` : ''}.`);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent data-testid="dept-copy-dialog" className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading inline-flex items-center gap-2">
            <Layers className="w-4 h-4 text-bronze-600" /> Copier la semaine entre départements
          </DialogTitle>
          <DialogDescription>
            Copie les quarts de la semaine du {days[0]} d'un département vers un autre. Réassignez chaque personne au besoin pour éviter les conflits d'horaire.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
          <div className="space-y-2">
            <Label>Département source</Label>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger data-testid="dept-copy-source"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DEPARTMENTS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <ArrowRight className="w-4 h-4 text-slate-400 mb-2.5" />
          <div className="space-y-2">
            <Label>Département cible</Label>
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger data-testid="dept-copy-target"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DEPARTMENTS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        {sourceShifts.length === 0 ? (
          <p data-testid="dept-copy-empty" className="text-sm text-slate-500">
            Aucun quart « {source} » dans la semaine affichée — rien à copier.
          </p>
        ) : (
          <>
            <div className="space-y-2">
              <Label>Réassignation des employés (facultatif)</Label>
              <div className="space-y-1.5 rounded-lg border border-slate-200 p-2.5 max-h-48 overflow-y-auto">
                {sourceEmpIds.map((eid) => {
                  const emp = state.employees.find((e) => e.id === eid);
                  const n = sourceShifts.filter((s) => s.employeeId === eid).length;
                  return (
                    <div key={eid} className="flex items-center gap-2 text-sm">
                      <span className="w-40 truncate font-semibold text-slate-700">
                        {emp ? `${emp.firstName} ${emp.lastName}` : eid} <span className="text-slate-400 font-normal">({n})</span>
                      </span>
                      <ArrowRight className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                      <Select value={remap[eid] ?? eid} onValueChange={(v) => setRemap((m) => ({ ...m, [eid]: v }))}>
                        <SelectTrigger data-testid={`dept-copy-emp-${eid}`} className="h-8 text-xs flex-1"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {state.employees.map((e) => (
                            <SelectItem key={e.id} value={e.id}>{e.firstName} {e.lastName} — {e.position}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  );
                })}
              </div>
              <p className="text-[11px] text-slate-400">
                Astuce : choisissez d'autres employés pour la copie afin d'éviter qu'une même personne soit sur deux départements en même temps (conflit rouge).
              </p>
            </div>
            <Button data-testid="dept-copy-submit" onClick={copy} className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700">
              Copier {sourceShifts.length} quart(s) vers « {target} »
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
