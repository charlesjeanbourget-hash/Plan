import { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { requestNavigate } from '@/lib/nav';
import { BadgeAlert, GraduationCap, FileWarning } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

interface ExpLicense {
  license_number: string;
  position: string;
  expiry_date: string;
  days_left: number;
}

interface ExpTraining {
  training_id: string;
  title: string;
  due_date: string;
  days_left: number;
  overdue: boolean;
}

interface ExpiringData {
  licenses: ExpLicense[];
  trainings: ExpTraining[];
}

export const ExpiringDocsBanner = (): JSX.Element | null => {
  const { token } = useAuth();
  const [data, setData] = useState<ExpiringData | null>(null);

  useEffect(() => {
    if (!token) return;
    axios
      .get<ExpiringData>(`${API}/me/expiring`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => setData(res.data))
      .catch(() => setData(null));
  }, [token]);

  if (!data || (data.licenses.length === 0 && data.trainings.length === 0)) return null;

  const hasUrgent = data.licenses.some((l) => l.days_left < 0) || data.trainings.some((t) => t.overdue);
  const tone = hasUrgent
    ? { border: 'border-red-300', bg: 'bg-red-50', icon: 'text-red-600', title: 'text-red-900', item: 'text-red-800' }
    : { border: 'border-amber-300', bg: 'bg-amber-50', icon: 'text-amber-600', title: 'text-amber-900', item: 'text-amber-800' };

  return (
    <div data-testid="expiring-docs-banner" className={`mb-8 rounded-xl border ${tone.border} ${tone.bg} px-5 py-4`}>
      <div className="flex items-center gap-3 mb-2">
        <div className="relative">
          <BadgeAlert className={`w-6 h-6 ${tone.icon}`} />
          <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
        </div>
        <p className={`text-sm font-bold ${tone.title}`}>Vos documents à surveiller</p>
      </div>
      <div className="space-y-1.5 pl-9">
        {data.licenses.map((l) => (
          <p key={l.license_number} data-testid="expiring-license-item" className={`text-sm ${tone.item} flex items-center gap-2`}>
            <FileWarning className="w-4 h-4 shrink-0" />
            {l.days_left < 0
              ? <>Votre licence <strong>{l.license_number}</strong>{l.position ? ` (${l.position})` : ''} est <strong>expirée depuis {Math.abs(l.days_left)} jour{Math.abs(l.days_left) > 1 ? 's' : ''}</strong> ({l.expiry_date}). Contactez votre gestionnaire pour le renouvellement.</>
              : <>Votre licence <strong>{l.license_number}</strong>{l.position ? ` (${l.position})` : ''} expire dans <strong>{l.days_left} jour{l.days_left > 1 ? 's' : ''}</strong> ({l.expiry_date}).</>}
          </p>
        ))}
        {data.trainings.map((t) => (
          <button
            key={t.training_id}
            data-testid="expiring-training-item"
            onClick={() => requestNavigate('training')}
            className={`text-sm ${tone.item} flex items-center gap-2 text-left hover:underline`}
          >
            <GraduationCap className="w-4 h-4 shrink-0" />
            {t.overdue
              ? <span>La formation <strong>« {t.title} »</strong> est <strong>en retard</strong> (échéance {t.due_date}) — cliquez pour la compléter.</span>
              : <span>La formation <strong>« {t.title} »</strong> est à compléter d'ici le <strong>{t.due_date}</strong> ({t.days_left} jour{t.days_left > 1 ? 's' : ''} restant{t.days_left > 1 ? 's' : ''}) — cliquez pour y accéder.</span>}
          </button>
        ))}
      </div>
    </div>
  );
};
