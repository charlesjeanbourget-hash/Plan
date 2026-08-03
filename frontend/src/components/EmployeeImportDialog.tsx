import { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import axios from 'axios';
import { useHR } from '@/context/HRContext';
import { useAuth } from '@/context/AuthContext';
import { POSITIONS, Position } from '@/types';
import { DEPARTMENTS } from '@/lib/pharmacy';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { FileSpreadsheet, Upload, Download, CheckCircle2, AlertTriangle, XCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const norm = (s: string): string =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');

const HEADER_ALIASES: Record<string, string[]> = {
  firstName: ['prenom', 'firstname', 'first', 'prenoms'],
  lastName: ['nom', 'nomdefamille', 'nomfamille', 'famille', 'lastname', 'surname', 'last'],
  fullName: ['nomcomplet', 'name', 'employe', 'employee', 'membre', 'fullname', 'nomprenom', 'prenomnom', 'nometprenom', 'prenometnom', 'employes', 'nomemploye', 'nomdelemploye', 'personnel', 'staff'],
  email: ['courriel', 'email', 'emailaddress', 'adressecourriel', 'mail', 'adresseemail', 'adressedecourriel', 'courrielprofessionnel'],
  phone: ['telephone', 'phone', 'cellulaire', 'mobile', 'tel', 'numerodetelephone', 'numerotelephone', 'telephonecellulaire', 'cell'],
  position: ['poste', 'postes', 'position', 'positions', 'role', 'roles', 'titre', 'emploi', 'jobtitle', 'fonction', 'titredemploi', 'occupation'],
  hourlyRate: ['tauxhoraire', 'taux', 'hourlyrate', 'salairehoraire', 'rate', 'salaire', 'wage', 'tauxdesalaire', 'remuneration'],
  branch: ['succursale', 'branch', 'site', 'location', 'etablissement', 'pharmacie', 'lieu', 'lieudetravail'],
  hireDate: ['datedembauche', 'embauche', 'hiredate', 'dateembauche', 'startdate', 'datededebut', 'debut'],
  weeklyHours: ['heuresparsemaine', 'heuressemaine', 'hoursperweek', 'heures', 'weeklyhours', 'heuressem', 'heuresgaranties', 'hressem'],
  address: ['adresse', 'address', 'domicile'],
  emergencyContact: ['contactdurgence', 'urgence', 'emergencycontact', 'emergency', 'personneaurgence'],
  department: ['departement', 'department', 'dept', 'equipe', 'team'],
};

const matchPosition = (raw: string): Position | null => {
  const n = norm(raw);
  if (!n) return null;
  const exact = POSITIONS.find((p) => norm(p) === n);
  if (exact) return exact;
  if (n.includes('pharmacien')) return 'Pharmacien(ne)';
  if (n.includes('assistant') || n === 'atp') return 'ATP';
  if (n.includes('technicien') || n.includes('labo')) return 'Technicien(ne) de laboratoire';
  if (n.includes('infirmier')) return 'Infirmier(ère)';
  if (n.includes('gestionnaire') || n.includes('manager') || n.includes('gerant') || n.includes('superviseur')) return 'Gestionnaire';
  if (n.includes('caissier') || n.includes('caisse')) return 'Caissier(ère)';
  if (n.includes('entrepot')) return "Commis d'entrepôt";
  if (n.includes('livreur') || n.includes('livraison') || n.includes('chauffeur')) return 'Livreur(se)';
  if (n.includes('commis')) return 'Commis';
  const partial = POSITIONS.filter((p) => {
    const np = norm(p);
    return np.includes(n) || n.includes(np);
  }).sort((a, b) => norm(b).length - norm(a).length);
  return partial[0] ?? null;
};

const parseDateCell = (raw: unknown): string => {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw.toISOString().slice(0, 10);
  const s = String(raw ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) {
    let day = Number(m[1]);
    let month = Number(m[2]);
    if (month > 12 && day <= 12) [day, month] = [month, day];
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${m[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  const d = new Date(s);
  if (s && !Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return new Date().toISOString().slice(0, 10);
};

const parseNum = (raw: unknown): number => {
  const s = String(raw ?? '').replace(/[$\s]/g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
};

interface ParsedRow {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  position: Position;
  branchId: string;
  branchLabel: string;
  hireDate: string;
  weeklyHours: number;
  hourlyRate: number;
  address: string;
  emergencyContact: string;
  department: string;
  status: 'ok' | 'duplicate' | 'error';
  warnings: string[];
  error?: string;
}

const AVATAR_COLORS = ['bg-emerald-600', 'bg-sky-600', 'bg-amber-600', 'bg-rose-600', 'bg-teal-600', 'bg-indigo-600'];

interface Props {
  open: boolean;
  onClose: () => void;
}

export const EmployeeImportDialog = ({ open, onClose }: Props): JSX.Element => {
  const { state, addEmployee } = useHR();
  const { token } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [importing, setImporting] = useState(false);

  const reset = (): void => {
    setRows([]);
    setFileName('');
    if (fileRef.current) fileRef.current.value = '';
  };

  const downloadTemplate = (): void => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Prénom', 'Nom', 'Courriel', 'Téléphone', 'Poste', 'Taux horaire', 'Succursale', "Date d'embauche", 'Heures par semaine', 'Département', 'Adresse', "Contact d'urgence"],
      ['Marie', 'Tremblay', 'marie.tremblay@exemple.ca', '514-555-0199', 'ATP', '26.50', state.branches[0]?.name ?? 'Centre-Ville', '2024-05-01', '35', 'Laboratoire', '123 rue Principale, Montréal', 'Paul Tremblay 514-555-0000'],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Employés');
    XLSX.writeFile(wb, 'modele_import_employes.xlsx');
  };

  const handleFile = async (file: File): Promise<void> => {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { cellDates: true });
      const findHeaderRow = (matrix: unknown[][]): { headerIdx: number; map: Record<string, number> } | null => {
        for (let i = 0; i < Math.min(matrix.length, 25); i++) {
          const row = matrix[i] ?? [];
          const map: Record<string, number> = {};
          row.forEach((cell, ci) => {
            const nh = norm(String(cell ?? ''));
            if (!nh) return;
            const field = Object.keys(HEADER_ALIASES).find((f) => HEADER_ALIASES[f].includes(nh) || norm(f) === nh);
            if (field && !(field in map)) map[field] = ci;
          });
          if (map.firstName !== undefined || map.fullName !== undefined || map.lastName !== undefined) {
            return { headerIdx: i, map };
          }
        }
        return null;
      };
      let matrix: unknown[][] = [];
      let header: { headerIdx: number; map: Record<string, number> } | null = null;
      for (const name of wb.SheetNames) {
        const m = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: '' });
        const h = findHeaderRow(m);
        if (h) { matrix = m; header = h; break; }
      }
      if (!header) {
        const first = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
        const firstRow = first.find((r) => (r ?? []).some((c) => String(c ?? '').trim()));
        const cols = (firstRow ?? []).map((c) => String(c ?? '').trim()).filter(Boolean).slice(0, 8).join(', ');
        toast.error(
          `Aucune colonne de nom reconnue${cols ? ` — colonnes détectées : ${cols}` : ''}. Renommez vos en-têtes (ex. Prénom, Nom, Courriel) ou téléchargez le modèle.`,
          { duration: 10000 }
        );
        return;
      }
      const map = header.map;
      const rawRows = matrix
        .slice(header.headerIdx + 1)
        .filter((r) => (r ?? []).some((c) => String(c ?? '').trim() !== ''));
      if (rawRows.length === 0) {
        toast.error('Aucune ligne d\'employé trouvée sous la ligne d\'en-têtes.');
        return;
      }
      const existingEmails = new Set(state.employees.filter((e) => !e.anonymized).map((e) => e.email.toLowerCase().trim()).filter(Boolean));
      const existingNames = new Set(state.employees.filter((e) => !e.anonymized).map((e) => norm(`${e.firstName}${e.lastName}`)));
      const seenInFile = new Set<string>();
      const parsed: ParsedRow[] = rawRows.map((r) => {
        const get = (f: string): string => String(map[f] !== undefined ? r[map[f]] ?? '' : '').trim();
        let firstName = get('firstName');
        let lastName = get('lastName');
        if ((!firstName || !lastName) && get('fullName')) {
          const parts = get('fullName').split(/\s+/);
          firstName = firstName || parts[0] || '';
          lastName = lastName || parts.slice(1).join(' ');
        }
        if (firstName && !lastName && map.fullName === undefined && map.firstName === undefined) {
          const parts = firstName.split(/\s+/);
          if (parts.length > 1) {
            firstName = parts[0];
            lastName = parts.slice(1).join(' ');
          }
        }
        const warnings: string[] = [];
        const email = get('email').toLowerCase();
        if (!firstName && !lastName) {
          return { firstName, lastName, email, phone: '', position: 'ATP', branchId: '', branchLabel: '', hireDate: '', weeklyHours: 35, hourlyRate: 0, address: '', emergencyContact: '', department: '', status: 'error', warnings, error: 'Nom manquant' } as ParsedRow;
        }
        const dupKey = email || norm(`${firstName}${lastName}`);
        const isDup = (email && existingEmails.has(email)) || (!email && existingNames.has(norm(`${firstName}${lastName}`))) || seenInFile.has(dupKey);
        seenInFile.add(dupKey);
        if (!email) warnings.push('Courriel manquant');
        const rawPos = get('position');
        let position = matchPosition(rawPos);
        if (!position) {
          position = 'ATP';
          if (rawPos) warnings.push(`Poste « ${rawPos} » non reconnu → ATP`);
          else warnings.push('Poste manquant → ATP');
        }
        const rawBranch = get('branch');
        const branch = state.branches.find((b) => norm(b.name) === norm(rawBranch) || norm(b.name).includes(norm(rawBranch)) || (norm(rawBranch) && norm(rawBranch).includes(norm(b.name))));
        const branchId = branch?.id ?? state.branches[0]?.id ?? '';
        if (rawBranch && !branch) warnings.push(`Succursale « ${rawBranch} » inconnue → ${state.branches[0]?.name ?? 'défaut'}`);
        const hourlyRate = parseNum(map.hourlyRate !== undefined ? r[map.hourlyRate] : '');
        if (hourlyRate <= 0) warnings.push('Taux horaire manquant');
        const rawDept = get('department');
        const department = DEPARTMENTS.find((d) => norm(d) === norm(rawDept)) ?? '';
        if (rawDept && !department) warnings.push(`Département « ${rawDept} » inconnu`);
        return {
          firstName, lastName, email, phone: get('phone'),
          position, branchId, branchLabel: branch?.name ?? state.branches[0]?.name ?? '',
          hireDate: parseDateCell(map.hireDate !== undefined ? r[map.hireDate] : ''),
          weeklyHours: parseNum(map.weeklyHours !== undefined ? r[map.weeklyHours] : '') || 35,
          hourlyRate, address: get('address'), emergencyContact: get('emergencyContact'), department,
          status: isDup ? 'duplicate' : 'ok', warnings,
        } as ParsedRow;
      });
      setRows(parsed);
      setFileName(file.name);
    } catch {
      toast.error('Lecture du fichier impossible — utilisez un fichier .xlsx, .xls ou .csv.');
    }
  };

  const doImport = async (): Promise<void> => {
    const ok = rows.filter((r) => r.status === 'ok');
    if (ok.length === 0) return;
    setImporting(true);
    const puts: Promise<unknown>[] = [];
    ok.forEach((r, i) => {
      const emp = addEmployee({
        firstName: r.firstName, lastName: r.lastName, email: r.email, phone: r.phone,
        position: r.position, branchId: r.branchId, status: 'Actif', hireDate: r.hireDate,
        hourlyRate: r.hourlyRate, weeklyHours: r.weeklyHours, address: r.address,
        emergencyContact: r.emergencyContact, avatarColor: AVATAR_COLORS[i % AVATAR_COLORS.length],
      });
      const body: Record<string, unknown> = { hourly_rate: r.hourlyRate, employee_name: `${r.firstName} ${r.lastName}` };
      if (r.department) body.department = r.department;
      puts.push(axios.put(`${API}/profiles/${emp.id}`, body, { headers: { Authorization: `Bearer ${token ?? ''}` } }).catch(() => null));
    });
    await Promise.all(puts);
    setImporting(false);
    const dups = rows.filter((r) => r.status === 'duplicate').length;
    toast.success(`${ok.length} employé(s) importés${dups > 0 ? ` · ${dups} ignorés (déjà présents)` : ''} — il ne reste qu'à cocher les préférences et compétences dans chaque profil.`);
    reset();
    onClose();
  };

  const okCount = rows.filter((r) => r.status === 'ok').length;
  const dupCount = rows.filter((r) => r.status === 'duplicate').length;
  const errCount = rows.filter((r) => r.status === 'error').length;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { reset(); onClose(); } }}>
      <DialogContent data-testid="employee-import-dialog" className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading inline-flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" /> Importer une liste d'employés (Excel)
          </DialogTitle>
          <DialogDescription>
            Importez un fichier .xlsx, .xls ou .csv exporté d'Agendrix ou d'un autre système — les dossiers se remplissent automatiquement. Il ne restera qu'à cocher les préférences et compétences de chacun.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Button data-testid="import-template-button" type="button" variant="outline" onClick={downloadTemplate} className="rounded-full border-bronze-300 text-bronze-800 hover:bg-bronze-50">
            <Download className="w-4 h-4 mr-1" /> Télécharger le modèle Excel
          </Button>
          <Button data-testid="import-file-button" type="button" onClick={() => fileRef.current?.click()} className="rounded-full bg-emerald-600 hover:bg-emerald-700">
            <Upload className="w-4 h-4 mr-1" /> Choisir le fichier…
          </Button>
          <input
            ref={fileRef}
            data-testid="import-file-input"
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); }}
          />
          {fileName && <span className="text-xs text-slate-500">{fileName}</span>}
        </div>
        <p className="text-[11px] text-slate-400">
          Colonnes reconnues (français ou anglais) : Prénom, Nom (ou Nom complet), Courriel, Téléphone, Poste, Taux horaire, Succursale, Date d'embauche, Heures par semaine, Département, Adresse, Contact d'urgence. Les doublons (courriel ou nom déjà au dossier) sont ignorés automatiquement.
        </p>
        {rows.length > 0 && (
          <>
            <div data-testid="import-summary" className="flex flex-wrap gap-2 text-xs font-semibold">
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200"><CheckCircle2 className="w-3.5 h-3.5" /> {okCount} à importer</span>
              {dupCount > 0 && <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200"><AlertTriangle className="w-3.5 h-3.5" /> {dupCount} doublon(s) ignoré(s)</span>}
              {errCount > 0 && <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-red-50 text-red-700 border border-red-200"><XCircle className="w-3.5 h-3.5" /> {errCount} ligne(s) invalide(s)</span>}
            </div>
            <div className="rounded-lg border border-slate-200 overflow-x-auto max-h-64 overflow-y-auto">
              <table data-testid="import-preview-table" className="w-full text-xs">
                <thead className="bg-slate-50 sticky top-0">
                  <tr className="text-left text-slate-500">
                    <th className="px-3 py-2">Employé</th>
                    <th className="px-3 py-2">Poste</th>
                    <th className="px-3 py-2">Taux</th>
                    <th className="px-3 py-2">Succursale</th>
                    <th className="px-3 py-2">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} data-testid={`import-row-${i}`} className="border-t border-slate-100">
                      <td className="px-3 py-1.5 font-semibold text-slate-700">{r.firstName} {r.lastName}{r.email && <span className="block font-normal text-slate-400">{r.email}</span>}</td>
                      <td className="px-3 py-1.5">{r.position}</td>
                      <td className="px-3 py-1.5">{r.hourlyRate > 0 ? `${r.hourlyRate.toFixed(2)} $` : '—'}</td>
                      <td className="px-3 py-1.5">{r.branchLabel}</td>
                      <td className="px-3 py-1.5">
                        {r.status === 'ok' && <span className="text-emerald-700 font-semibold">Prêt</span>}
                        {r.status === 'duplicate' && <span className="text-amber-700 font-semibold">Doublon</span>}
                        {r.status === 'error' && <span className="text-red-600 font-semibold">{r.error}</span>}
                        {r.warnings.length > 0 && <span className="block text-[10px] text-amber-600">{r.warnings.join(' · ')}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Button
              data-testid="import-confirm-button"
              type="button"
              disabled={okCount === 0 || importing}
              onClick={() => void doImport()}
              className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700"
            >
              {importing ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Importation…</> : `Importer ${okCount} employé(s)`}
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
