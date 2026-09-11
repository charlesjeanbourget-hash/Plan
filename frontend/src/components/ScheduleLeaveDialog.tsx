import { FormEvent, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { useHR } from '@/context/HRContext';
import { useAuth } from '@/context/AuthContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TreePalm } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const LEAVE_TYPES = ['Vacances', 'Maladie', 'Mobile', 'Absence'] as const;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultEmployeeId?: string;
  defaultDate?: string;
}

export function ScheduleLeaveDialog({ open, onOpenChange, defaultEmployeeId, defaultDate }: Props): JSX.Element {
  const { state, addLeaveRequest, getEmployee } = useHR();
  const { currentUser, token } = useAuth();
  const isAdmin = currentUser?.role !== 'employee';
  const employees = state.employees.filter((e) => e.status === 'Actif' && !e.anonymized);

  const submit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    const form = e.currentTarget;
    const empId = isAdmin
      ? (form.elements.namedItem('employeeId') as HTMLSelectElement | null)?.value || employees[0]?.id || ''
      : (currentUser?.employeeId ?? '');
    const type = (form.elements.namedItem('type') as HTMLSelectElement | null)?.value || 'Vacances';
    const startDate = (form.querySelector('[name=startDate]') as HTMLInputElement).value;
    const endDate = (form.querySelector('[name=endDate]') as HTMLInputElement).value;
    const reason = (form.querySelector('[name=reason]') as HTMLInputElement).value;
    const approveNow = isAdmin && (form.querySelector('[name=approveNow]') as HTMLInputElement)?.checked;
    const emp = getEmployee(empId);
    if (!empId || !startDate || !endDate) {
      toast.error('Employé et dates obligatoires.');
      return;
    }
    if (endDate < startDate) {
      toast.error('La date de fin doit être après le début.');
      return;
    }
    try {
      const res = await axios.post<{ id?: string }>(`${API}/leave/requests`, {
        employee_id: empId,
        employee_name: emp ? `${emp.firstName} ${emp.lastName}` : (currentUser?.name ?? ''),
        type, start_date: startDate, end_date: endDate, reason,
      }, { headers: { Authorization: `Bearer ${token ?? ''}` } });
      const id = res.data.id;
      if (isAdmin && approveNow && id) {
        await axios.post(`${API}/leave/requests/${id}/decide`, { action: 'approve' }, { headers: { Authorization: `Bearer ${token ?? ''}` } });
        addLeaveRequest({ employeeId: empId, type: type as 'Vacances', startDate, endDate, reason, status: 'Approuvée' });
        toast.success('Absence ajoutée à l\u2019horaire. Les quarts qui chevauchent passent en rouge.');
      } else {
        addLeaveRequest({ employeeId: empId, type: type as 'Vacances', startDate, endDate, reason, status: 'En attente' });
        toast.success(isAdmin ? 'Demande créée — à approuver dans Congés.' : 'Demande soumise — l\u2019employeur doit l\u2019accepter.');
      }
      onOpenChange(false);
    } catch (err) {
      const detail = axios.isAxiosError(err) && err.response ? (err.response.data as { detail?: unknown }).detail : null;
      toast.error(typeof detail === 'string' ? detail : 'Enregistrement impossible.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="schedule-leave-dialog" className="max-w-md">
        <DialogHeader>
          <DialogTitle className="inline-flex items-center gap-2">
            <TreePalm className="w-5 h-5 text-amber-600" /> Ajouter une absence
          </DialogTitle>
          <DialogDescription>
            L’absence approuvée apparaît dans la grille. Un quart sur ces dates devient un conflit rouge.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void submit(e)} className="space-y-3">
          {isAdmin && (
            <div>
              <Label>Employé</Label>
              <select name="employeeId" data-testid="leave-employee" defaultValue={defaultEmployeeId || employees[0]?.id} className="w-full h-10 rounded-md border border-slate-200 px-3 text-sm">
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <Label>Type</Label>
            <select name="type" data-testid="leave-type" defaultValue="Vacances" className="w-full h-10 rounded-md border border-slate-200 px-3 text-sm">
              {LEAVE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Du</Label>
              <Input name="startDate" data-testid="leave-start" type="date" defaultValue={defaultDate} required />
            </div>
            <div>
              <Label>Au</Label>
              <Input name="endDate" data-testid="leave-end" type="date" defaultValue={defaultDate} required />
            </div>
          </div>
          <div>
            <Label>Note interne (optionnel)</Label>
            <Input name="reason" data-testid="leave-reason" placeholder="Visible employeur seulement" />
          </div>
          {isAdmin && (
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" name="approveNow" data-testid="leave-approve-now" defaultChecked />
              Approuver tout de suite (apparaît dans l’horaire)
            </label>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
            <Button data-testid="leave-submit" type="submit" className="bg-amber-600 hover:bg-amber-700">Ajouter à l’horaire</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
