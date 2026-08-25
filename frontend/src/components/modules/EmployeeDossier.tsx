import { useState, FormEvent } from 'react';
import { consumeNavPayload } from '@/lib/nav';
import { useHR } from '@/context/HRContext';
import { Position, POSITIONS, Employee } from '@/types';
import { ModuleHeader, StatusBadge, EmptyState, CollapsibleSection } from '@/components/modules/shared';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Mail, Phone, MapPin, Trash2, Hash, UserX, Pencil, FileSpreadsheet, ListPlus, KeySquare, ArrowLeft, ChevronRight, Search } from 'lucide-react';
import { CustomFieldsPanel } from '@/components/CustomFieldsPanel';
import { ModuleAccessPanel } from '@/components/ModuleAccessPanel';
import { IncompatibilitiesPanel } from '@/components/IncompatibilitiesPanel';
import { ProfileEditor } from '@/components/ProfileEditor';
import { SalaryHistory } from '@/components/SalaryHistory';
import { PayrollNumbersDialog } from '@/components/PayrollNumbersDialog';
import { BranchManagerDialog } from '@/components/BranchManagerDialog';
import { EmployeeImportDialog } from '@/components/EmployeeImportDialog';
import { useAuth } from '@/context/AuthContext';
import axios from 'axios';
import { toast } from 'sonner';
import { branchLabel } from '@/lib/branchLabel';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function EmployeeDossier(): JSX.Element {
  const { state, addEmployee, deleteEmployee, updateEmployee, anonymizeEmployee } = useHR();
  const { token } = useAuth();
  const [navPayload] = useState(() => consumeNavPayload());
  const [selectedId, setSelectedId] = useState<string | null>(navPayload?.employeeId ?? null);
  const [branchFilter, setBranchFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  const norm = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const filteredEmployees = state.employees.filter((e) => {
    if (branchFilter !== 'all' && e.branchId !== branchFilter && !(e.branchIds ?? []).includes(branchFilter)) return false;
    const q = norm(searchQuery.trim());
    if (!q) return true;
    return norm(`${e.firstName} ${e.lastName} ${e.position ?? ''} ${e.email ?? ''}`).includes(q);
  });
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
  const [branchesOpen, setBranchesOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    firstName: '', lastName: '', email: '', phone: '', address: '', emergencyContact: '',
    position: 'ATP' as Position, branchId: '', branchIds: [] as string[], hireDate: '', weeklyHours: '35', hourlyRate: '25',
  });

  const selected: Employee | undefined = state.employees.find((e) => e.id === selectedId);

  const syncRateToProfile = (employeeId: string, rate: number, name: string): void => {
    void axios.put(`${API}/profiles/${employeeId}`,
      { hourly_rate: rate, employee_name: name },
      { headers: { Authorization: `Bearer ${token ?? ''}` } })
      .catch(() => toast.error('Synchronisation du taux horaire avec le profil impossible — réessayez.'));
  };

  const openEdit = (): void => {
    if (!selected) return;
    setEditForm({
      firstName: selected.firstName,
      lastName: selected.lastName,
      email: selected.email,
      phone: selected.phone ?? '',
      address: selected.address ?? '',
      emergencyContact: selected.emergencyContact ?? '',
      position: selected.position,
      branchId: selected.branchId,
      branchIds: (selected.branchIds ?? []).filter((b) => b !== selected.branchId),
      hireDate: selected.hireDate,
      weeklyHours: String(selected.weeklyHours),
      hourlyRate: String(selected.hourlyRate),
    });
    setEditOpen(true);
  };

  const handleEdit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (!selected) return;
    const rate = Math.max(0, Number(editForm.hourlyRate.replace(',', '.')) || 0);
    updateEmployee(selected.id, {
      firstName: editForm.firstName.trim(),
      lastName: editForm.lastName.trim(),
      email: editForm.email.trim(),
      phone: editForm.phone.trim(),
      address: editForm.address.trim(),
      emergencyContact: editForm.emergencyContact.trim(),
      position: editForm.position,
      branchId: editForm.branchId,
      branchIds: [editForm.branchId, ...editForm.branchIds.filter((b) => b !== editForm.branchId)],
      hireDate: editForm.hireDate,
      weeklyHours: Math.max(0, Number(editForm.weeklyHours) || 0),
      hourlyRate: rate,
    });
    syncRateToProfile(selected.id, rate, `${editForm.firstName.trim()} ${editForm.lastName.trim()}`);
    setEditOpen(false);
    toast.success('Dossier mis à jour — taux horaire synchronisé pour la génération IA et les calculs de coûts.');
  };

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
    syncRateToProfile(emp.id, Number(hourlyRate) || 0, `${firstName} ${lastName}`);
    toast.success(`${firstName} ${lastName} ajouté(e) à l'équipe.`);
    setSelectedId(emp.id);
    setDialogOpen(false);
    setFirstName(''); setLastName(''); setEmail(''); setPhone('');
  };

  const handleDelete = (id: string): void => {
    deleteEmployee(id);
    setSelectedId(null);
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
      {!selected && (
        <ModuleHeader
          title="Dossiers Employés"
          subtitle={`${state.employees.length} membres dans votre équipe.`}
          action={
            <div className="flex flex-wrap gap-2">
              <Button data-testid="manage-branches-button" variant="outline" onClick={() => setBranchesOpen(true)} className="rounded-full border-bronze-300 text-bronze-800 hover:bg-bronze-50">
                <MapPin className="w-4 h-4 mr-1" /> Succursales
              </Button>
              <Button data-testid="import-employees-button" variant="outline" onClick={() => setImportOpen(true)} className="rounded-full border-bronze-300 text-bronze-800 hover:bg-bronze-50">
                <FileSpreadsheet className="w-4 h-4 mr-1" /> Importer (Excel)
              </Button>
              <Button data-testid="payroll-numbers-button" variant="outline" onClick={() => setPayrollNumbersOpen(true)} className="rounded-full border-bronze-300 text-bronze-800 hover:bg-bronze-50">
                <Hash className="w-4 h-4 mr-1" /> Matricules paie
              </Button>
              <Button data-testid="add-employee-button" onClick={() => setDialogOpen(true)} className="rounded-full bg-emerald-600 hover:bg-emerald-700">
                <Plus className="w-4 h-4 mr-1" /> Nouvel employé
              </Button>
            </div>
          }
        />
      )}
      <PayrollNumbersDialog open={payrollNumbersOpen} onClose={() => setPayrollNumbersOpen(false)} />
      <BranchManagerDialog open={branchesOpen} onClose={() => setBranchesOpen(false)} />
      <EmployeeImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
      {state.employees.length === 0 ? (
        <EmptyState text="Aucun employé. Ajoutez votre premier membre d'équipe." />
      ) : selected ? (
        <div data-testid="employee-profile-page">
          <Button
            data-testid="back-to-employees-list"
            variant="outline"
            onClick={() => setSelectedId(null)}
            className="rounded-full mb-6 border-slate-300 text-slate-700 hover:bg-slate-50"
          >
            <ArrowLeft className="w-4 h-4 mr-1.5" /> Revenir à la liste des employés
          </Button>
          <div className="space-y-6">
            <div className="bg-white rounded-xl border border-slate-200 p-6 sm:p-8" data-testid="employee-detail-panel">
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
                  <p className="text-slate-500">Succursale{(selected.branchIds ?? []).length > 1 ? 's' : ''} : <span className="font-semibold text-slate-800" data-testid="employee-branches-label">{
                    ((selected.branchIds ?? []).length > 0 ? (selected.branchIds ?? []) : [selected.branchId])
                      .map((bid) => state.branches.find((b) => b.id === bid)?.name)
                      .filter(Boolean)
                      .join(', ') || '—'
                  }</span></p>
                  <p className="text-slate-500">Embauche : <span className="font-semibold text-slate-800">{selected.hireDate}</span></p>
                  <p className="text-slate-500">Taux horaire : <span className="font-semibold text-slate-800">{(selected.hourlyRate ?? 0).toFixed(2)} $ / h</span></p>
                  <p className="text-slate-500">Heures / semaine : <span className="font-semibold text-slate-800">{selected.weeklyHours ?? 0} h</span></p>
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
                      data-testid="edit-employee-button"
                      variant="outline"
                      className="rounded-full border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                      onClick={openEdit}
                    >
                      <Pencil className="w-4 h-4 mr-1" /> Modifier le dossier
                    </Button>
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
            <SalaryHistory employeeId={selected.id} currentRate={selected.hourlyRate} />
            <CollapsibleSection id="dossier-module-access" title="Accès aux modules (rôles personnalisés)" icon={KeySquare}>
              <ModuleAccessPanel employeeId={selected.id} />
            </CollapsibleSection>
            <CollapsibleSection id="dossier-custom-fields" title="Champs RH personnalisés" icon={ListPlus}>
              <CustomFieldsPanel employeeId={selected.id} />
            </CollapsibleSection>
            <CollapsibleSection id="dossier-incompat" title="Incompatibilités de travail" icon={UserX}>
              <IncompatibilitiesPanel employeeId={selected.id} />
            </CollapsibleSection>
            <ProfileEditor employeeId={selected.id} employeeName={`${selected.firstName} ${selected.lastName}`} canManageCode />
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1 sm:max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              <Input
                data-testid="employee-search-input"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Rechercher un employé par nom, poste ou courriel…"
                className="pl-9"
              />
            </div>
            <Select value={branchFilter} onValueChange={setBranchFilter}>
              <SelectTrigger data-testid="employees-branch-filter" className="w-full sm:max-w-xs">
                <SelectValue placeholder="Toutes les succursales" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes les succursales</SelectItem>
                {state.branches.map((b) => <SelectItem key={b.id} value={b.id}>{branchLabel(b)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {filteredEmployees.map((emp) => (
              <button
                key={emp.id}
                data-testid={`employee-list-item-${emp.id}`}
                onClick={() => setSelectedId(emp.id)}
                className="w-full flex items-center gap-3 p-4 rounded-xl border border-slate-200 bg-white text-left transition-all hover:border-emerald-400 hover:shadow-sm"
              >
                <div className={`w-10 h-10 rounded-full ${emp.avatarColor} flex items-center justify-center text-white text-sm font-bold shrink-0`}>
                  {emp.firstName[0]}{emp.lastName[0]}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900 truncate">{emp.firstName} {emp.lastName}</p>
                  <p className="text-xs text-slate-500">{emp.position}</p>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
              </button>
            ))}
          </div>
          {filteredEmployees.length === 0 && (
            <p data-testid="employee-search-empty" className="text-sm text-slate-500 text-center py-8">
              Aucun employé ne correspond à « {searchQuery} ».
            </p>
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
                  {state.branches.map((b) => <SelectItem key={b.id} value={b.id}>{branchLabel(b)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button data-testid="employee-submit-button" type="submit" className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700">
              Ajouter l'employé
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent data-testid="edit-employee-dialog" className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-heading inline-flex items-center gap-2">
              <Pencil className="w-4 h-4 text-emerald-600" /> Modifier le dossier
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEdit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Prénom</Label>
                <Input data-testid="edit-firstname-input" value={editForm.firstName} onChange={(e) => setEditForm((f) => ({ ...f, firstName: e.target.value }))} required />
              </div>
              <div className="space-y-2">
                <Label>Nom</Label>
                <Input data-testid="edit-lastname-input" value={editForm.lastName} onChange={(e) => setEditForm((f) => ({ ...f, lastName: e.target.value }))} required />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Courriel</Label>
                <Input data-testid="edit-email-input" type="email" value={editForm.email} onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))} required />
              </div>
              <div className="space-y-2">
                <Label>Téléphone</Label>
                <Input data-testid="edit-phone-input" value={editForm.phone} onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Adresse</Label>
              <Input data-testid="edit-address-input" value={editForm.address} onChange={(e) => setEditForm((f) => ({ ...f, address: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Contact d'urgence</Label>
              <Input data-testid="edit-emergency-input" value={editForm.emergencyContact} onChange={(e) => setEditForm((f) => ({ ...f, emergencyContact: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Poste</Label>
                <Select value={editForm.position} onValueChange={(v) => setEditForm((f) => ({ ...f, position: v as Position }))}>
                  <SelectTrigger data-testid="edit-position-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {POSITIONS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Succursale principale</Label>
                <Select value={editForm.branchId} onValueChange={(v) => setEditForm((f) => ({ ...f, branchId: v, branchIds: f.branchIds.filter((b) => b !== v) }))}>
                  <SelectTrigger data-testid="edit-branch-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {state.branches.map((b) => <SelectItem key={b.id} value={b.id}>{branchLabel(b)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {state.branches.length > 1 && (
              <div className="space-y-2">
                <Label>Succursales additionnelles (peut aussi travailler à…)</Label>
                <div className="flex flex-wrap gap-1.5">
                  {state.branches.filter((b) => b.id !== editForm.branchId).map((b) => {
                    const on = editForm.branchIds.includes(b.id);
                    return (
                      <button
                        key={b.id}
                        type="button"
                        data-testid={`edit-extra-branch-${b.id}`}
                        onClick={() => setEditForm((f) => ({ ...f, branchIds: on ? f.branchIds.filter((x) => x !== b.id) : [...f.branchIds, b.id] }))}
                        className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${on ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-slate-200 text-slate-600 hover:border-emerald-300'}`}
                      >
                        {b.name}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] text-slate-400">L'employé apparaîtra dans les horaires de chaque succursale cochée. Les budgets restent calculés séparément par succursale, selon la succursale de chaque quart.</p>
              </div>
            )}
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Embauche</Label>
                <Input data-testid="edit-hiredate-input" type="date" value={editForm.hireDate} onChange={(e) => setEditForm((f) => ({ ...f, hireDate: e.target.value }))} required />
              </div>
              <div className="space-y-2">
                <Label>Heures / sem.</Label>
                <Input data-testid="edit-weeklyhours-input" type="number" min="0" max="80" value={editForm.weeklyHours} onChange={(e) => setEditForm((f) => ({ ...f, weeklyHours: e.target.value }))} required />
              </div>
              <div className="space-y-2">
                <Label>Taux horaire ($)</Label>
                <Input data-testid="edit-rate-input" type="number" step="0.05" min="0" max="1000" value={editForm.hourlyRate} onChange={(e) => setEditForm((f) => ({ ...f, hourlyRate: e.target.value }))} required />
              </div>
            </div>
            <p className="text-[11px] text-slate-400">
              Le taux horaire est synchronisé automatiquement avec le profil serveur — utilisé par la génération d'horaire IA, les coûts du calendrier et les rapports budget.
            </p>
            <Button data-testid="edit-employee-submit" type="submit" className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700">
              Enregistrer les modifications
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
