import { useState, useEffect, FormEvent } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { useHR } from '@/context/HRContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const REASONS = ['Vaccination', 'Prise de sang', 'Tension artérielle', 'Injection', 'Consultation', 'Autre'];

export const AppointmentDialog = ({ open, onOpenChange, onCreated }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: () => void;
}): JSX.Element => {
  const { token, currentUser } = useAuth();
  const { state } = useHR();
  const isManager = currentUser?.role !== 'employee';
  const nurses = state.employees.filter((e) => e.position === 'Infirmier(ère)' && e.status === 'Actif');
  const [empId, setEmpId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [start, setStart] = useState('10:00');
  const [end, setEnd] = useState('10:30');
  const [client, setClient] = useState('');
  const [reason, setReason] = useState('Vaccination');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEmpId(isManager ? (nurses[0]?.id ?? '') : (currentUser?.employeeId ?? ''));
    setClient('');
    setNotes('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    const emp = state.employees.find((x) => x.id === empId);
    if (!emp) {
      toast.error('Choisissez un(e) infirmier(ère).');
      return;
    }
    if (end <= start) {
      toast.error('L\'heure de fin doit suivre l\'heure de début.');
      return;
    }
    const dayShifts = state.shifts.filter((s) => s.employeeId === empId && s.date === date);
    const within = dayShifts.some((s) => s.startTime <= start && end <= s.endTime);
    if (!within) {
      toast.error(dayShifts.length === 0
        ? `Impossible : aucun quart de travail planifié le ${date}. Le rendez-vous doit tomber sur une plage de travail.`
        : `Impossible : ${start}–${end} est hors des plages de travail du ${date} (${dayShifts.map((s) => `${s.startTime}–${s.endTime}`).join(', ')}).`);
      return;
    }
    setBusy(true);
    try {
      await axios.post(`${API}/appointments`, {
        employee_id: empId,
        employee_name: `${emp.firstName} ${emp.lastName}`,
        date, start, end, client_name: client, reason, notes,
      }, { headers: { Authorization: `Bearer ${token ?? ''}` } });
      toast.success(`Rendez-vous « ${reason} » ajouté à l'horaire du ${date}.`);
      onOpenChange(false);
      onCreated();
    } catch {
      toast.error('Création du rendez-vous impossible.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="appointment-dialog" className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading">Nouveau rendez-vous</DialogTitle>
          <DialogDescription>
            Le rendez-vous doit tomber sur une plage horaire de travail planifiée — sinon il sera bloqué.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void submit(e)} className="space-y-4">
          {isManager ? (
            <div className="space-y-2">
              <Label>Infirmier(ère)</Label>
              <Select value={empId} onValueChange={setEmpId}>
                <SelectTrigger data-testid="appointment-nurse-select"><SelectValue placeholder="Choisir" /></SelectTrigger>
                <SelectContent>
                  {nurses.length === 0 ? (
                    <SelectItem value="none" disabled>Aucun(e) employé(e) au poste Infirmier(ère)</SelectItem>
                  ) : nurses.map((n) => (
                    <SelectItem key={n.id} value={n.id}>{n.firstName} {n.lastName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <p className="text-sm text-slate-600">Rendez-vous pour : <span className="font-semibold">{currentUser?.name}</span></p>
          )}
          <div className="space-y-2">
            <Label>Client</Label>
            <Input data-testid="appointment-client-input" value={client} onChange={(e) => setClient(e.target.value)} placeholder="Ex. M. Jean Talbot" required />
          </div>
          <div className="space-y-2">
            <Label>Motif</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger data-testid="appointment-reason-select"><SelectValue /></SelectTrigger>
              <SelectContent>
                {REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2 col-span-1">
              <Label>Date</Label>
              <Input data-testid="appointment-date-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Début</Label>
              <Input data-testid="appointment-start-input" type="time" value={start} onChange={(e) => setStart(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Fin</Label>
              <Input data-testid="appointment-end-input" type="time" value={end} onChange={(e) => setEnd(e.target.value)} required />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Notes (facultatif)</Label>
            <Input data-testid="appointment-notes-input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex. 2e dose, apporter carnet" />
          </div>
          <Button data-testid="appointment-submit-button" type="submit" disabled={busy || !client.trim() || !empId || empId === 'none'} className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700">
            {busy ? 'Ajout…' : 'Ajouter le rendez-vous'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};
