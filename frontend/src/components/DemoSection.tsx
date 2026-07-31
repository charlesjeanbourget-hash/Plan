import { useState } from 'react';
import { toast } from 'sonner';
import { CalendarCheck, CheckCircle2, Clock3, MessageSquareText, ShieldCheck } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const PROMISES = [
  { icon: Clock3, text: '30 minutes, en visioconférence, au moment qui vous convient' },
  { icon: MessageSquareText, text: 'Vos vrais scénarios : horaires, punch, paie, remplacements' },
  { icon: ShieldCheck, text: 'Sans engagement et sans carte de crédit' },
];

export function DemoSection(): JSX.Element {
  const [form, setForm] = useState({ name: '', pharmacy: '', email: '', phone: '', message: '' });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim()) {
      toast.error('Votre nom et votre courriel sont requis.');
      return;
    }
    setSending(true);
    try {
      const res = await fetch(`${API}/demo-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { detail?: string }).detail || 'Erreur lors de l\'envoi.');
      }
      setSent(true);
      toast.success('Demande envoyée ! Nous vous contactons rapidement.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur lors de l\'envoi.');
    } finally {
      setSending(false);
    }
  };

  const inputCls = 'w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-400 transition-colors';

  return (
    <section id="demo" className="bg-white" data-testid="demo-section">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-24 grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-center">
        <div>
          <p className="text-xs sm:text-sm uppercase tracking-[0.18em] text-bronze-700 font-bold mb-3">Démo personnalisée</p>
          <h2 className="font-heading text-2xl sm:text-3xl lg:text-4xl font-extrabold text-slate-900 leading-tight mb-4">
            Voyez Arrière Plan <span className="text-emerald-600">en action.</span>
          </h2>
          <p className="text-sm sm:text-base text-slate-500 mb-8 max-w-md">
            Laissez-nous vos coordonnées : nous vous présentons la plateforme avec les scénarios
            réels de votre pharmacie et répondons à toutes vos questions.
          </p>
          <ul className="space-y-4">
            {PROMISES.map((p) => (
              <li key={p.text} className="flex items-start gap-3 text-sm text-slate-700">
                <span className="w-8 h-8 rounded-lg bg-emerald-50 border border-emerald-100 flex items-center justify-center shrink-0">
                  <p.icon className="w-4 h-4 text-emerald-700" />
                </span>
                <span className="pt-1.5">{p.text}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-2xl bg-white border border-slate-200 shadow-[0_30px_60px_-25px_rgba(15,23,42,0.25)] p-6 sm:p-8">
          {sent ? (
            <div className="text-center py-10" data-testid="demo-success">
              <span className="inline-flex w-14 h-14 rounded-full bg-emerald-50 border border-emerald-200 items-center justify-center mb-4">
                <CheckCircle2 className="w-7 h-7 text-emerald-600" />
              </span>
              <p className="font-heading text-xl font-extrabold text-slate-900 mb-2">Demande envoyée !</p>
              <p className="text-sm text-slate-500 max-w-xs mx-auto">
                Merci {form.name.trim().split(' ')[0]} — nous vous contactons sous 24 h ouvrables pour planifier votre démo.
              </p>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div className="flex items-center gap-2 mb-1">
                <CalendarCheck className="w-4 h-4 text-bronze-600" />
                <p className="font-heading font-bold text-slate-900">Réserver une démo</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">Nom complet *</label>
                  <input data-testid="demo-name-input" value={form.name} onChange={set('name')} className={inputCls} placeholder="Votre nom" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">Pharmacie</label>
                  <input data-testid="demo-pharmacy-input" value={form.pharmacy} onChange={set('pharmacy')} className={inputCls} placeholder="Nom de votre pharmacie" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">Courriel *</label>
                  <input data-testid="demo-email-input" type="email" value={form.email} onChange={set('email')} className={inputCls} placeholder="vous@pharmacie.ca" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">Téléphone</label>
                  <input data-testid="demo-phone-input" value={form.phone} onChange={set('phone')} className={inputCls} placeholder="(514) 555-0123" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Message</label>
                <textarea
                  data-testid="demo-message-input"
                  value={form.message}
                  onChange={set('message')}
                  rows={3}
                  className={`${inputCls} resize-none`}
                  placeholder="Parlez-nous de votre pharmacie (nombre d'employés, succursales…)"
                />
              </div>
              <button
                type="submit"
                data-testid="demo-submit-button"
                disabled={sending}
                className="w-full rounded-full bg-emerald-600 text-white font-semibold text-sm py-3 hover:bg-emerald-700 transition-colors disabled:opacity-60"
              >
                {sending ? 'Envoi en cours…' : 'Réserver ma démo'}
              </button>
              <p className="text-[11px] text-slate-400 text-center">
                Vos coordonnées ne servent qu'à vous recontacter. Aucune infolettre.
              </p>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
