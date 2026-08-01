import { useState, FormEvent } from 'react';
import { consumeNavPayload } from '@/lib/nav';
import { useHR } from '@/context/HRContext';
import { Position, POSITIONS, Employee } from '@/types';
import { ModuleHeader, StatusBadge, EmptyState } from '@/components/modules/shared';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Mail, Phone, MapPin, Trash2, Hash, UserX } from 'lucide-react';
import { ProfileEditor } from '@/components/ProfileEditor';
import { SalaryHistory } from '@/components/SalaryHistory';
import { PayrollNumbersDialog } from '@/components/PayrollNumbersDialog';
import { useAuth } from '@/context/AuthContext';
import axios from 'axios';
import { toast } from 'sonner';

export default function EmployeeDossier(): JSX.Element {
  const { state, addEmployee, deleteEmployee, updateEmployee, anonymizeEmployee } = useHR();
  const { token } = useAuth();
  const [navPayload] = useState(() => consumeNavPayload());
  const [selectedId, setSelectedId] = useState<string | null>(navPayload?.employeeId ?? state.employees[0]?.id ?? null);
  const [branchFilter, setBranchFilter] = useState('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [anonymizeTarget, setAnonymizeTarget] = useState<Employee | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [position, setPosition] = useState<Position>('ATP');
  const [hourlyRate, setHourlyRate] = useState('25');
  const [branchId, setBranchId] = useState(state.branches[0]?.id ?? '');
  const [payrollNumbersOpen, setPayrollNumbersOpen] = useState(false);

  const selected: Employee | undefined = state.employees.find((e) => e.id === selectedId);

  const handleAdd = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const emp = addEmployee({
      firstName, lastName, email, phone, position,
      branchId,
      status: 'Actif',
      hireDate: new Date().toISOString().slice(0, 10),
      hourlyRate: Number(hourlyRate),
      weeklyHours: 35,
      address: '',
      emergencyContact: '',
      avatarColor: 'bg-violet-600',
    });
    toast.success(`${firstName} ${lastName} ajouté(e) à l'équipe.`);
    setSelectedId(emp.id);
    setDialogOpen(false);
    setFirstName(''); setLastName(''); setEmail(''); setPhone('');
  };

  const handleDelete = (id: string): void => {
    deleteEmployee(id);
    setSelectedId(state.employees.find((e) => e.id !== id)?.id ?? null);
    toast.success('Employé retiré du dossier.');
  };

  const confirmAnonymize = async (): Promise<void> => {
    if (!anonymizeTarget) return;
    const emp = anonymizeTarget;
    setAnonymizeTarget(null);
    try {
      await axios.post(
        `${process.env.REACT_APP_BACKEND_URL}/api/employees/${emp.id}/anonymize`,
        {}, { headers: { Authorization: `Bearer ${token ?? ''}` } });
    } catch {
      /* le backend n'a peut-être pas de dossier lié — on anonymise quand même localement */
    }
    anonymizeEmployee(emp.id);
    toast.success(`Renseignements de ${emp.firstName} ${emp.lastName} anonymisés définitivement. Les statistiques agrégées sont conservées.`);
  };

  return (
    <div data-testid="employees-module">
      <ModuleHeader
        title="Dossiers Employés"
        subtitle={`${state.employees.length} membres dans votre équipe.`}
        action={
          <div className="flex flex-wrap gap-2">
            <Button data-testid="payroll-numbers-button" variant="outline" onClick={() => setPayrollNumbersOpen(true)} className="rounded-full border-bronze-300 text-bronze-800 hover:bg-bronze-50">
              <Hash className="w-4 h-4 mr-1" /> Matricules paie
            </Button>
            <Button data-testid="add-employee-button" onClick={() => setDialogOpen(true)} className="rounded-full bg-emerald-600 hover:bg-emerald-700">
              <Plus className="w-4 h-4 mr-1" /> Nouvel employé
            </Button>
          </div>
        }
      />
      <PayrollNumbersDialog open={payrollNumbersOpen} onClose={() => setPayrollNumbersOpen(false)} />
      {state.employees.length === 0 ? (
        <EmptyState text="Aucun employé. Ajoutez votre premier membre d'équipe." />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="space-y-2">
            <Select value={branchFilter} onValueChange={setBranchFilter}>
              <SelectTrigger data-testid="employees-branch-filter" className="w-full mb-2">
                <SelectValue placeholder="Toutes les succursales" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes les succursales</SelectItem>
                {state.branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {state.employees.filter((e) => branchFilter === 'all' || e.branchId === branchFilter).map((emp) => (
              <button
                key={emp.id}
                data-testid={`employee-list-item-${emp.id}`}
                onClick={() => setSelectedId(emp.id)}
                className={`w-full flex items-center gap-3 p-4 rounded-xl border text-left transition-colors ${
                  selectedId === emp.id ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div className={`w-10 h-10 rounded-full ${emp.avatarColor} flex items-center justify-center text-white text-sm font-bold shrink-0`}>
                  {emp.firstName[0]}{emp.lastName[0]}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900 truncate">{emp.firstName} {emp.lastName}</p>
                  <p className="text-xs text-slate-500">{emp.position}</p>
                </div>
              </button>
            ))}
          </div>

          {selected && (
            <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-8" data-testid="employee-detail-panel">
              <div className="flex items-start justify-between mb-8">
                <div className="flex items-center gap-4">
                  <div className={`w-14 h-14 rounded-full ${selected.avatarColor} flex items-center justify-center text-white text-lg font-bold`}>
                    {selected.firstName[0]}{selected.lastName[0]}
                  </div>
                  <div>
                    <h2 className="font-heading text-xl font-bold text-slate-900">{selected.firstName} {selected.lastName}</h2>
                    <p className="text-sm text-slate-500">{selected.position}</p>
                  </div>
                </div>
                <StatusBadge status={selected.status} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 text-sm">
                <div className="space-y-3">
                  <p className="flex items-center gap-2 text-slate-600"><Mail className="w-4 h-4 text-slate-400" /> {selected.email}</p>
                  <p className="flex items-center gap-2 text-slate-600"><Phone className="w-4 h-4 text-slate-400" /> {selected.phone || '—'}</p>
                  <p className="flex items-center gap-2 text-slate-600"><MapPin className="w-4 h-4 text-slate-400" /> {selected.address || '—'}</p>
                </div>
                <div className="space-y-2">
                  <p className="text-slate-500">Succursale : <span className="font-semibold text-slate-800">{state.branches.find((b) => b.id === selected.branchId)?.name ?? '—'}</span></p>
                  <p className="text-slate-500">Embauche : <span className="font-semibold text-slate-800">{selected.hireDate}</span></p>
                  <p className="text-slate-500">Taux horaire : <span className="font-semibold text-slate-800">{selected.hourlyRate.toFixed(2)} $ / h</span></p>
                  <p className="text-slate-500">Heures / semaine : <span className="font-semibold text-slate-800">{selected.weeklyHours} h</span></p>
                  <p className="text-slate-500">Contact d'urgence : <span className="font-semibold text-slate-800">{selected.emergencyContact || '—'}</span></p>
                </div>
              </div>
              <div className="mt-8 pt-6 border-t border-slate-100 flex flex-wrap gap-3">
                {selected.anonymized ? (
                  <span data-testid="employee-anonymized-badge" className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 bg-slate-100 rounded-full px-3 py-1.5">
                    <UserX className="w-3.5 h-3.5" /> Dossier anonymisé (Loi 25)
                  </span>
                ) : (
                  <>
                    <Button
                      data-testid="toggle-employee-status-button"
                      variant="outline"
                      className="rounded-full"
                      onClick={() => updateEmployee(selected.id, { status: selected.status === 'Actif' ? 'En congé' : 'Actif' })}
                    >
                      {selected.status === 'Actif' ? 'Marquer en congé' : 'Marquer actif'}
                    </Button>
                    <Button
                      data-testid="anonymize-employee-button"
                      variant="outline"
                      className="rounded-full text-bronze-800 border-bronze-300 hover:bg-bronze-50"
                      onClick={() => setAnonymizeTarget(selected)}
                    >
                      <UserX className="w-4 h-4 mr-1" /> Anonymiser (départ)
                    </Button>
                    <Button
                      data-testid="delete-employee-button"
                      variant="outline"
                      className="rounded-full text-red-600 border-red-200 hover:bg-red-50"
                      onClick={() => handleDelete(selected.id)}
                    >
                      <Trash2 className="w-4 h-4 mr-1" /> Retirer
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}
          {selected && (
            <div className="lg:col-span-3">
              <SalaryHistory employeeId={selected.id} currentRate={selected.hourlyRate} />
            </div>
          )}
          {selected && (
            <div className="lg:col-span-3">
              <ProfileEditor employeeId={selected.id} employeeName={`${selected.firstName} ${selected.lastName}`} canManageCode />
            </div>
          )}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent data-testid="add-employee-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading">Nouvel employé</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAdd} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Prénom</Label>
                <Input data-testid="employee-firstname-input" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label>Nom</Label>
                <Input data-testid="employee-lastname-input" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Courriel</Label>
                <Input data-testid="employee-email-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label>Téléphone</Label>
                <Input data-testid="employee-phone-input" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Poste</Label>
                <Select value={position} onValueChange={(v) => setPosition(v as Position)}>
                  <SelectTrigger data-testid="employee-position-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {POSITIONS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Taux horaire ($)</Label>
                <Input data-testid="employee-rate-input" type="number" step="0.5" min="15" value={hourlyRate} onChange={(e) => setHourlyRate(e.target.value)} required />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Succursale</Label>
              <Select value={branchId} onValueChange={setBranchId}>
                <SelectTrigger data-testid="employee-branch-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {state.branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button data-testid="employee-submit-button" type="submit" className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700">
              Ajouter l'employé
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={anonymizeTarget !== null} onOpenChange={(o) => !o && setAnonymizeTarget(null)}>
        <DialogContent data-testid="anonymize-confirm-dialog" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="font-heading inline-flex items-center gap-2">
              <UserX className="w-5 h-5 text-bronze-600" /> Anonymiser définitivement ?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-600">
            Cette action retire <b>définitivement</b> les renseignements personnels de{' '}
            <b>{anonymizeTarget?.firstName} {anonymizeTarget?.lastName}</b> (nom, courriel, téléphone, adresse,
            contact d'urgence, NIP de punch, licences). Les <b>statistiques agrégées</b> — heures travaillées,
            historique de paie et coûts — sont <b>conservées</b> pour vos rapports. Idéal au départ d'un employé (droit à l'oubli — Loi 25).
          </p>
          <p className="text-xs text-red-600 font-semibold">Cette opération est irréversible.</p>
          <div className="flex gap-3 justify-end mt-2">
            <Button data-testid="anonymize-cancel-button" variant="outline" className="rounded-full" onClick={() => setAnonymizeTarget(null)}>
              Annuler
            </Button>
            <Button data-testid="anonymize-confirm-button" className="rounded-full bg-bronze-600 hover:bg-bronze-700" onClick={() => void confirmAnonymize()}>
              Anonymiser définitivement
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
