import { FormEvent, useState } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import { useHR } from '@/context/HRContext';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';

export function ShiftSwapPanel(): JSX.Element {
  const { state, addShiftSwap, updateShiftSwap, setShiftSwapStatus, updateShift, getEmployee } = useHR();
  const [shiftId, setShiftId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [reason, setReason] = useState('');

  const upcoming = state.shifts
    .slice()
    .sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`))
    .slice(-80);

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    const shift = state.shifts.find((s) => s.id === shiftId);
    if (!shift || !targetId) return;
    addShiftSwap({
      shiftId: shift.id,
      requesterId: shift.employeeId,
      targetEmployeeId: targetId,
      reason: reason.trim() || 'Échange de quart',
      status: 'En attente',
      peerStatus: 'En attente',
    });
    setShiftId('');
    setTargetId('');
    setReason('');
    toast.success('Demande envoyée au collègue. Vous approuverez ensuite.');
  };

  const peerOk = (id: string): void => {
    updateShiftSwap(id, { peerStatus: 'Approuvée' });
    toast.success('Le collègue accepte. En attente de votre approbation.');
  };

  const adminOk = (id: string): void => {
    const swap = state.shiftSwaps.find((s) => s.id === id);
    if (!swap) return;
    const shift = state.shifts.find((s) => s.id === swap.shiftId);
    if (shift) updateShift(shift.id, { employeeId: swap.targetEmployeeId });
    setShiftSwapStatus(id, 'Approuvée');
    updateShiftSwap(id, { peerStatus: swap.peerStatus ?? 'Approuvée' });
    toast.success('Quart échangé dans le calendrier.');
  };

  const refuse = (id: string): void => {
    setShiftSwapStatus(id, 'Refusée');
    toast.message('Échange refusé.');
  };

  const pending = state.shiftSwaps.filter((s) => s.status === 'En attente');

  return (
    <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4" data-testid="shift-swap-panel">
      <p className="text-sm font-bold text-slate-800 inline-flex items-center gap-2 mb-3">
        <ArrowLeftRight className="w-4 h-4 text-emerald-600" /> Échanges de quarts encadrés
      </p>
      <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-end">
        <div className="space-y-1">
          <Label className="text-xs">Quart à céder</Label>
          <Select value={shiftId} onValueChange={setShiftId}>
            <SelectTrigger data-testid="swap-shift"><SelectValue placeholder="Choisir" /></SelectTrigger>
            <SelectContent>
              {upcoming.map((s) => {
                const e = getEmployee(s.employeeId);
                return (
                  <SelectItem key={s.id} value={s.id}>
                    {e ? `${e.firstName} ${e.lastName[0]}.` : '?'} · {s.date} {s.startTime}–{s.endTime}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Collègue</Label>
          <Select value={targetId} onValueChange={setTargetId}>
            <SelectTrigger data-testid="swap-target"><SelectValue placeholder="Qui reprend ?" /></SelectTrigger>
            <SelectContent>
              {state.employees.filter((e) => e.status === 'Actif').map((e) => (
                <SelectItem key={e.id} value={e.id}>{e.firstName} {e.lastName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Motif</Label>
          <Input data-testid="swap-reason" value={reason} onChange={(ev) => setReason(ev.target.value)} placeholder="Optionnel" />
        </div>
        <Button type="submit" data-testid="swap-submit" className="rounded-full bg-emerald-600 hover:bg-emerald-700">Proposer</Button>
      </form>
      {pending.length > 0 && (
        <ul className="mt-3 space-y-2">
          {pending.map((s) => {
            const from = getEmployee(s.requesterId);
            const to = getEmployee(s.targetEmployeeId);
            const shift = state.shifts.find((x) => x.id === s.shiftId);
            return (
              <li key={s.id} data-testid={`swap-row-${s.id}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs">
                <span className="font-semibold text-slate-800">
                  {from ? `${from.firstName} ${from.lastName}` : '?'} → {to ? `${to.firstName} ${to.lastName}` : '?'}
                </span>
                <span className="text-slate-500">{shift ? `${shift.date} ${shift.startTime}–${shift.endTime}` : ''}</span>
                {s.peerStatus !== 'Approuvée' ? (
                  <Button size="sm" variant="outline" className="rounded-full ml-auto text-xs" onClick={() => peerOk(s.id)}>Collègue accepte</Button>
                ) : (
                  <span className="ml-auto text-emerald-700 font-semibold">Collègue OK</span>
                )}
                <Button size="sm" className="rounded-full bg-emerald-600 hover:bg-emerald-700 text-xs" onClick={() => adminOk(s.id)}>Approuver</Button>
                <Button size="sm" variant="outline" className="rounded-full text-xs text-red-600" onClick={() => refuse(s.id)}>Refuser</Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
