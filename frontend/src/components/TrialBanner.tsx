import { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { Sparkles } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export const TrialBanner = (): JSX.Element | null => {
  const { currentUser, token } = useAuth();
  const [daysLeft, setDaysLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!token || !currentUser || currentUser.role === 'superadmin') {
      setDaysLeft(null);
      return;
    }
    axios.get<{ trial_days_left?: number }>(`${API}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => setDaysLeft(typeof r.data.trial_days_left === 'number' ? r.data.trial_days_left : null))
      .catch(() => setDaysLeft(null));
  }, [token, currentUser]);

  if (daysLeft === null) return null;
  return (
    <div
      data-testid="trial-banner"
      className="mb-6 flex flex-wrap items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
    >
      <Sparkles className="w-4 h-4 text-emerald-600 shrink-0" />
      <span>
        <b>Essai gratuit</b> — il vous reste <b>{daysLeft} jour{daysLeft > 1 ? 's' : ''}</b>.
        Pour activer votre accès complet, écrivez-nous à{' '}
        <a href="mailto:info@arriereplanrh.com" className="font-semibold underline underline-offset-2">info@arriereplanrh.com</a>.
      </span>
    </div>
  );
};
