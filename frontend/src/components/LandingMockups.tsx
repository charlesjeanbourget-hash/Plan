import type { ReactNode } from 'react';
import {
  Pin, Paperclip, CheckCheck, Flame, Award, MapPin, Camera, Mail, Link2,
  GraduationCap, Star, ShieldCheck, ScrollText, ClipboardCheck, Send,
  ChevronDown, FileText, Check, Navigation, TrendingUp,
  TreePalm, PartyPopper, Sparkles, Building2, HeartHandshake, Hand,
} from 'lucide-react';

interface BoxProps { children: ReactNode; className?: string }

function Window({ title, children, className = '' }: BoxProps & { title: string }): JSX.Element {
  return (
    <div className={`rounded-2xl bg-white border border-slate-200/80 shadow-[0_35px_70px_-25px_rgba(15,23,42,0.3)] overflow-hidden ${className}`}>
      <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-slate-100 bg-slate-50/80">
        <span className="w-2 h-2 rounded-full bg-slate-300/70" />
        <span className="w-2 h-2 rounded-full bg-slate-200" />
        <span className="w-2 h-2 rounded-full bg-slate-200" />
        <span className="ml-2 text-[10px] font-semibold text-slate-500 truncate">{title}</span>
      </div>
      {children}
    </div>
  );
}

function FloatCard({ children, className = '' }: BoxProps): JSX.Element {
  return (
    <div className={`absolute rounded-xl bg-white border border-slate-200/80 shadow-[0_25px_50px_-15px_rgba(15,23,42,0.35)] ${className}`}>
      {children}
    </div>
  );
}

function MockRoot({ children }: BoxProps): JSX.Element {
  return <div aria-hidden="true" className="relative select-none pointer-events-none">{children}</div>;
}

const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

export function MockSchedule(): JSX.Element {
  const rows: { name: string; chips: (string | null)[]; bronze?: number }[] = [
    { name: 'Julie G.', chips: ['8–16', '8–16', null, '8–16', '8–16', null, null] },
    { name: 'Karim B.', chips: [null, '12–20', '12–20', null, '12–20', '9–17', null] },
    { name: 'Sarah T.', chips: ['9–17', null, '9–17', '9–17', null, null, '10–14'], bronze: 5 },
  ];
  return (
    <MockRoot>
      <div className="px-2 sm:px-8 pt-6 pb-14">
        <Window title="Horaires — semaine du 3 août">
          <div className="p-3 sm:p-4">
            <div className="grid grid-cols-[56px_repeat(7,1fr)] gap-1 mb-1">
              <span />
              {DAYS.map((d) => (
                <span key={d} className="text-[8px] font-bold text-slate-400 text-center uppercase">{d}</span>
              ))}
            </div>
            {rows.map((r) => (
              <div key={r.name} className="grid grid-cols-[56px_repeat(7,1fr)] gap-1 mb-1.5 items-center">
                <span className="text-[9px] font-semibold text-slate-600 truncate">{r.name}</span>
                {r.chips.map((c, i) => (
                  <div key={i} className="h-6 flex items-center justify-center">
                    {c && (
                      <span className={`w-full text-center rounded-md text-[8px] font-semibold px-0.5 py-1 border ${
                        r.bronze === i
                          ? 'bg-bronze-100 border-bronze-300 text-bronze-800'
                          : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      }`}>{c}</span>
                    )}
                  </div>
                ))}
              </div>
            ))}
            <div className="grid grid-cols-[56px_repeat(7,1fr)] gap-1 items-center">
              <span className="text-[9px] font-semibold text-bronze-700 truncate">Rempl.</span>
              {DAYS.map((_, i) => (
                <div key={i} className="h-6 flex items-center justify-center">
                  {i === 5 && <span className="w-full text-center rounded-md text-[8px] font-semibold px-0.5 py-1 bg-bronze-100 border border-bronze-300 text-bronze-800">9–17</span>}
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
              <span className="text-[9px] text-slate-500">Coût estimé : <b className="text-emerald-700">1 240 $</b> · Budget : 1 500 $</span>
              <span className="rounded-full bg-emerald-600 text-white text-[9px] font-semibold px-2.5 py-1">Publier la semaine</span>
            </div>
          </div>
        </Window>
        <FloatCard className="right-0 sm:-right-2 -bottom-6 w-44 sm:w-52 rotate-2 animate-float">
          <div className="p-3.5">
            <p className="text-[10px] font-bold text-slate-800 mb-2">Créer un quart</p>
            <div className="space-y-1.5 mb-2.5">
              <div className="rounded-md border border-slate-200 px-2 py-1.5 text-[9px] text-slate-600">Julie Gagnon</div>
              <div className="rounded-md border border-slate-200 px-2 py-1.5 text-[9px] text-slate-600">08 h 00 — 16 h 00</div>
            </div>
            <div className="rounded-full bg-emerald-600 text-white text-[9px] font-semibold text-center py-1.5">Ajouter le quart</div>
          </div>
        </FloatCard>
        <FloatCard className="left-0 sm:-left-2 -top-1 -rotate-2 animate-float-slow">
          <div className="px-3 py-2 flex items-center gap-1.5">
            <CheckCheck className="w-3.5 h-3.5 text-emerald-600" />
            <span className="text-[9px] font-semibold text-slate-700">Horaire vu par 4/5 employés</span>
          </div>
        </FloatCard>
      </div>
    </MockRoot>
  );
}

export function MockPunch(): JSX.Element {
  const rows = [
    { d: 'Lun. 3 août', p: '8 h 02 — 16 h 04', t: '7,9 h', ts: false },
    { d: 'Mar. 4 août', p: '7 h 58 — 17 h 31', t: '9,5 h', ts: true },
    { d: 'Mer. 5 août', p: '8 h 00 — 16 h 01', t: '8,0 h', ts: false },
    { d: 'Jeu. 6 août', p: '11 h 55 — 20 h 03', t: '8,1 h', ts: false },
  ];
  return (
    <MockRoot>
      <div className="px-2 sm:px-8 pt-4 pb-16">
        <Window title="Feuille de temps — Julie Gagnon">
          <div className="p-3 sm:p-4">
            {rows.map((r) => (
              <div key={r.d} className="flex items-center justify-between border-b border-slate-50 py-2">
                <span className="text-[9px] font-semibold text-slate-600 w-20">{r.d}</span>
                <span className="text-[9px] text-slate-500">{r.p}</span>
                <span className="flex items-center gap-1.5">
                  <span className="text-[9px] font-bold text-slate-800">{r.t}</span>
                  {r.ts && <span className="rounded-full bg-bronze-100 border border-bronze-300 text-bronze-800 text-[8px] font-bold px-1.5 py-0.5">TS +1,5 h</span>}
                </span>
              </div>
            ))}
            <div className="mt-2.5 flex items-center justify-between">
              <span className="text-[9px] text-slate-500">Total de la semaine</span>
              <span className="text-[11px] font-extrabold text-emerald-700">33,5 h</span>
            </div>
          </div>
        </Window>
        <FloatCard className="right-0 sm:right-2 -bottom-10 w-40 sm:w-44 rotate-3 !bg-slate-900 !border-slate-700 animate-float">
          <div className="p-4 text-center">
            <p className="text-[9px] text-slate-400 mb-0.5">Bonjour !</p>
            <p className="font-heading text-2xl font-extrabold text-white mb-2">08:30</p>
            <div className="flex justify-center gap-1.5 mb-2.5">
              {[0, 1, 2, 3].map((i) => <span key={i} className={`w-2 h-2 rounded-full ${i < 3 ? 'bg-emerald-400' : 'bg-slate-600'}`} />)}
            </div>
            <div className="grid grid-cols-3 gap-1">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                <span key={n} className="rounded-md bg-slate-800 text-slate-300 text-[9px] font-semibold py-1">{n}</span>
              ))}
            </div>
            <div className="mt-1.5 rounded-md bg-emerald-500 text-white text-[9px] font-bold py-1 flex items-center justify-center gap-1">
              <Check className="w-3 h-3" /> Puncher
            </div>
          </div>
        </FloatCard>
      </div>
    </MockRoot>
  );
}

export function MockTasks(): JSX.Element {
  const items = [
    { t: 'Vérifier les frigos (2°C – 8°C)', by: 'Julie', done: true },
    { t: 'Décompte des narcotiques', by: 'Karim', done: true },
    { t: 'Rotation des dates de péremption', by: 'Équipe', done: true },
    { t: 'Balancer la caisse du comptoir', by: 'Sarah', done: false },
  ];
  return (
    <MockRoot>
      <div className="px-2 sm:px-8 pt-4 pb-14">
        <Window title="Tâches par quart — Matin">
          <div className="p-3 sm:p-4">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[9px] font-semibold text-slate-600">Progression du quart</span>
              <span className="text-[9px] font-bold text-emerald-700">6 / 8 complétées</span>
            </div>
            <div className="h-1.5 rounded-full bg-slate-100 mb-3.5 overflow-hidden">
              <div className="h-full w-3/4 rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400" />
            </div>
            {items.map((it) => (
              <div key={it.t} className="flex items-center gap-2.5 py-1.5 border-b border-slate-50">
                <span className={`w-4 h-4 rounded-md flex items-center justify-center shrink-0 ${it.done ? 'bg-emerald-500' : 'border-2 border-slate-300'}`}>
                  {it.done && <Check className="w-3 h-3 text-white" />}
                </span>
                <span className={`text-[9px] flex-1 ${it.done ? 'text-slate-400 line-through' : 'text-slate-700 font-semibold'}`}>{it.t}</span>
                <span className="rounded-full bg-slate-100 text-slate-500 text-[8px] font-semibold px-2 py-0.5">{it.by}</span>
              </div>
            ))}
          </div>
        </Window>
        <FloatCard className="right-0 sm:-right-2 -bottom-8 w-44 sm:w-48 rotate-2 animate-float">
          <div className="p-3.5">
            <div className="flex items-center gap-1.5 mb-2">
              <Flame className="w-4 h-4 text-bronze-600" />
              <span className="text-[10px] font-bold text-slate-800">Série de 4 semaines</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <span className="rounded-full bg-bronze-100 border border-bronze-300 text-bronze-800 text-[8px] font-bold px-2 py-1 inline-flex items-center gap-1"><Award className="w-2.5 h-2.5" /> Semaine parfaite</span>
              <span className="rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-[8px] font-bold px-2 py-1">Esprit d'équipe</span>
            </div>
          </div>
        </FloatCard>
      </div>
    </MockRoot>
  );
}

export function MockChat(): JSX.Element {
  return (
    <MockRoot>
      <div className="flex justify-center px-2 sm:px-8 pt-4 pb-12">
        <div className="relative">
          <div className="w-60 sm:w-64 rounded-[2.2rem] border-[6px] border-slate-900 bg-white shadow-[0_35px_70px_-20px_rgba(15,23,42,0.4)] overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/80">
              <p className="text-[10px] font-bold text-slate-800">Toute l'équipe</p>
              <p className="text-[8px] text-slate-400">6 membres</p>
            </div>
            <div className="px-3 py-2 bg-bronze-50 border-b border-bronze-100 flex items-center gap-1.5">
              <Pin className="w-3 h-3 text-bronze-700 shrink-0" />
              <span className="text-[8px] font-semibold text-bronze-800 truncate">Réunion d'équipe vendredi 9 h — salle du labo</span>
            </div>
            <div className="p-3 space-y-2 bg-white">
              <div className="max-w-[80%] rounded-2xl rounded-tl-md bg-slate-100 px-2.5 py-1.5">
                <p className="text-[8px] font-bold text-slate-500 mb-0.5">Marc (gestionnaire)</p>
                <p className="text-[9px] text-slate-700">L'horaire de la semaine prochaine est publié !</p>
              </div>
              <div className="max-w-[80%] rounded-2xl rounded-tl-md bg-slate-100 px-2.5 py-1.5 flex items-center gap-1.5">
                <span className="w-6 h-6 rounded-md bg-white border border-slate-200 flex items-center justify-center shrink-0"><FileText className="w-3 h-3 text-bronze-600" /></span>
                <div>
                  <p className="text-[8px] font-bold text-slate-700">protocole-vaccins.pdf</p>
                  <p className="text-[7px] text-slate-400">240 Ko · Document</p>
                </div>
              </div>
              <div className="ml-auto max-w-[80%] rounded-2xl rounded-tr-md bg-emerald-600 px-2.5 py-1.5">
                <p className="text-[9px] text-white">Parfait, merci ! Je confirme pour vendredi.</p>
              </div>
              <p className="text-right text-[7px] text-slate-400 flex items-center justify-end gap-0.5">
                <CheckCheck className="w-2.5 h-2.5 text-emerald-500" /> Vu par 5
              </p>
            </div>
            <div className="px-3 pb-3 flex items-center gap-1.5">
              <span className="flex-1 rounded-full border border-slate-200 px-2.5 py-1.5 text-[8px] text-slate-400 flex items-center justify-between">Écrire un message… <Paperclip className="w-3 h-3" /></span>
              <span className="w-6 h-6 rounded-full bg-emerald-600 flex items-center justify-center"><Send className="w-3 h-3 text-white" /></span>
            </div>
          </div>
          <FloatCard className="hidden sm:block -right-40 top-12 w-44 rotate-2 animate-float">
            <div className="p-3">
              <p className="text-[9px] font-bold text-slate-800 mb-1.5">Accusés de lecture</p>
              <p className="text-[8px] text-slate-500 mb-2">Horaire — semaine du 3 août</p>
              {['Julie G.', 'Karim B.', 'Sarah T.'].map((n) => (
                <div key={n} className="flex items-center justify-between py-1 border-b border-slate-50">
                  <span className="text-[8px] font-semibold text-slate-600">{n}</span>
                  <CheckCheck className="w-3 h-3 text-emerald-500" />
                </div>
              ))}
            </div>
          </FloatCard>
          <FloatCard className="hidden sm:block -left-36 bottom-6 w-40 -rotate-2 animate-float-slow">
            <div className="px-3 py-2.5 flex items-center gap-2">
              <Pin className="w-3.5 h-3.5 text-bronze-600 shrink-0" />
              <span className="text-[8px] font-semibold text-slate-700">Message épinglé — visible par toute l'équipe</span>
            </div>
          </FloatCard>
        </div>
      </div>
    </MockRoot>
  );
}

export function MockDelivery(): JSX.Element {
  const stops = [
    { n: 1, name: 'M. Robert Sirois', addr: '1240 rue Ontario E.', km: '2,4 km', urgent: true },
    { n: 2, name: 'Mme Denise Roy', addr: '3315 av. du Parc', km: '3,1 km', urgent: false },
    { n: 3, name: 'M. Paul Tremblay', addr: '890 boul. Pie-IX', km: '4,2 km', urgent: false },
  ];
  return (
    <MockRoot>
      <div className="px-2 sm:px-8 pt-4 pb-14">
        <Window title="Ma tournée du jour — 3 livraisons">
          <div className="p-3 sm:p-4">
            {stops.map((s) => (
              <div key={s.n} className="flex items-center gap-2.5 py-2 border-b border-slate-50">
                <span className="w-5 h-5 rounded-full bg-emerald-600 text-white text-[9px] font-bold flex items-center justify-center shrink-0">{s.n}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[9px] font-bold text-slate-700 flex items-center gap-1.5">
                    {s.name}
                    {s.urgent && <span className="rounded-full bg-red-50 border border-red-200 text-red-700 text-[7px] font-bold px-1.5 py-px">URGENT</span>}
                  </p>
                  <p className="text-[8px] text-slate-400 flex items-center gap-0.5"><MapPin className="w-2.5 h-2.5" /> {s.addr}</p>
                </div>
                <span className="text-[9px] font-semibold text-slate-500">{s.km}</span>
              </div>
            ))}
            <div className="mt-2.5 flex items-center justify-between">
              <span className="text-[9px] text-slate-500">Total : <b className="text-slate-800">9,7 km</b></span>
              <span className="rounded-full bg-emerald-600 text-white text-[9px] font-semibold px-2.5 py-1 inline-flex items-center gap-1"><Navigation className="w-2.5 h-2.5" /> Ouvrir dans Maps</span>
            </div>
          </div>
        </Window>
        <FloatCard className="right-0 sm:-right-2 -bottom-9 w-44 sm:w-48 rotate-2 animate-float">
          <div className="p-3.5">
            <p className="text-[9px] font-bold text-slate-800 mb-1.5 flex items-center gap-1"><Camera className="w-3 h-3 text-bronze-600" /> Preuve de livraison</p>
            <div className="rounded-lg border border-slate-200 bg-slate-50 h-12 flex items-center justify-center mb-1.5">
              <svg viewBox="0 0 90 26" className="w-24 h-7">
                <path d="M4 20 C 12 4, 18 26, 26 12 S 42 6, 50 15 S 66 22, 74 8 S 84 14, 87 10" fill="none" stroke="#334155" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </div>
            <p className="text-[8px] font-semibold text-emerald-700">Signée — livrée à 14 h 32</p>
          </div>
        </FloatCard>
      </div>
    </MockRoot>
  );
}

export function MockReplacement(): JSX.Element {
  const offers = [
    { agency: 'PharmaStaff Québec', cand: 'Marie Dubé', rate: '42 $/h', best: true },
    { agency: 'Nova Placement', cand: 'Éric Fortin', rate: '45 $/h', best: false },
  ];
  return (
    <MockRoot>
      <div className="px-2 sm:px-8 pt-8 pb-12">
        <Window title="Remplacement — Pharmacien(ne)">
          <div className="p-3 sm:p-4">
            <div className="flex flex-wrap items-center gap-1.5 mb-3">
              <span className="rounded-full bg-slate-100 text-slate-600 text-[8px] font-semibold px-2 py-1">Sam. 8 août · 9 h — 17 h</span>
              <span className="rounded-full bg-bronze-100 border border-bronze-300 text-bronze-800 text-[8px] font-bold px-2 py-1">Envoyée à 4 agences</span>
            </div>
            <p className="text-[9px] font-bold text-slate-700 mb-1.5">Offres reçues (2)</p>
            {offers.map((o) => (
              <div key={o.agency} className={`flex items-center justify-between rounded-lg border px-2.5 py-2 mb-1.5 ${o.best ? 'border-emerald-300 bg-emerald-50/60' : 'border-slate-200'}`}>
                <div>
                  <p className="text-[9px] font-bold text-slate-700">{o.cand}</p>
                  <p className="text-[8px] text-slate-400">{o.agency}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-extrabold text-slate-800">{o.rate}</span>
                  {o.best && <span className="rounded-full bg-emerald-600 text-white text-[8px] font-semibold px-2 py-1">Retenir</span>}
                </div>
              </div>
            ))}
          </div>
        </Window>
        <FloatCard className="left-0 sm:-left-2 -top-4 -rotate-2 animate-float-slow">
          <div className="px-3 py-2 flex items-center gap-1.5">
            <Mail className="w-3.5 h-3.5 text-emerald-600" />
            <span className="text-[9px] font-semibold text-slate-700">Courriels envoyés automatiquement</span>
          </div>
        </FloatCard>
        <FloatCard className="right-0 sm:-right-2 -bottom-5 rotate-2 animate-float">
          <div className="px-3 py-2 flex items-center gap-1.5">
            <Link2 className="w-3.5 h-3.5 text-bronze-600" />
            <span className="text-[9px] font-semibold text-slate-700">Lien public sécurisé — sans compte</span>
          </div>
        </FloatCard>
      </div>
    </MockRoot>
  );
}

export function MockTraining(): JSX.Element {
  const sections = ['Ouverture de la pharmacie', 'Comptage et validation des pilules', 'Conformité et registres'];
  return (
    <MockRoot>
      <div className="px-2 sm:px-8 pt-4 pb-16">
        <Window title="Formation d'intégration — générée par l'IA">
          <div className="p-3 sm:p-4">
            <p className="text-[8px] text-slate-400 mb-2">6 sections · Examen de 14 questions · Note de passage 80 %</p>
            {sections.map((s, i) => (
              <div key={s} className="flex items-center justify-between rounded-lg border border-slate-200 px-2.5 py-2 mb-1.5">
                <span className="text-[9px] font-semibold text-slate-700 flex items-center gap-2">
                  <span className="w-4 h-4 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-700 text-[8px] font-bold flex items-center justify-center">{i + 1}</span>
                  {s}
                </span>
                <ChevronDown className="w-3 h-3 text-slate-300" />
              </div>
            ))}
          </div>
        </Window>
        <FloatCard className="right-0 sm:-right-2 -bottom-10 w-48 sm:w-52 rotate-2 animate-float">
          <div className="p-3.5">
            <p className="text-[8px] font-bold text-bronze-700 uppercase tracking-wide mb-1">Question 3 / 14</p>
            <p className="text-[9px] font-bold text-slate-800 mb-2">Que vérifier avant d'ouvrir le laboratoire ?</p>
            {['La température des frigos', 'Le courrier du jour', 'Les réseaux sociaux'].map((o, i) => (
              <div key={o} className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 mb-1 ${i === 0 ? 'border-emerald-300 bg-emerald-50/70' : 'border-slate-200'}`}>
                <span className={`w-2.5 h-2.5 rounded-full border ${i === 0 ? 'bg-emerald-500 border-emerald-500' : 'border-slate-300'}`} />
                <span className="text-[8px] text-slate-600">{o}</span>
              </div>
            ))}
          </div>
        </FloatCard>
        <FloatCard className="left-0 sm:-left-2 -top-1 -rotate-2 animate-float-slow">
          <div className="px-3 py-2 flex items-center gap-1.5">
            <GraduationCap className="w-3.5 h-3.5 text-bronze-600" />
            <span className="text-[9px] font-semibold text-slate-700">Certificat PDF après réussite</span>
          </div>
        </FloatCard>
      </div>
    </MockRoot>
  );
}

export function MockEvaluation(): JSX.Element {
  const criteria = [
    { c: 'Service à la clientèle', n: 5 },
    { c: 'Rigueur au laboratoire', n: 4 },
    { c: 'Esprit d\'équipe', n: 5 },
  ];
  return (
    <MockRoot>
      <div className="px-2 sm:px-8 pt-4 pb-16">
        <Window title="Évaluation — Julie Gagnon">
          <div className="p-3 sm:p-4">
            {criteria.map((r) => (
              <div key={r.c} className="flex items-center justify-between py-2 border-b border-slate-50">
                <span className="text-[9px] font-semibold text-slate-600">{r.c}</span>
                <span className="flex gap-0.5">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Star key={i} className={`w-3 h-3 ${i <= r.n ? 'text-bronze-500 fill-bronze-400' : 'text-slate-200'}`} />
                  ))}
                </span>
              </div>
            ))}
            <div className="mt-2.5 flex items-center justify-between">
              <span className="text-[9px] text-slate-500">70 % employeur · 30 % auto-évaluation</span>
              <span className="rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-[9px] font-bold px-2 py-1">Score global : 87 %</span>
            </div>
          </div>
        </Window>
        <FloatCard className="right-0 sm:-right-2 -bottom-10 w-44 sm:w-48 rotate-2 animate-float">
          <div className="p-3.5">
            <p className="text-[8px] font-bold text-slate-500 uppercase tracking-wide mb-0.5">Taux suggéré</p>
            <p className="font-heading text-xl font-extrabold text-emerald-700 mb-0.5">27,10 $/h</p>
            <p className="text-[8px] text-slate-500 mb-2 flex items-center gap-1"><TrendingUp className="w-2.5 h-2.5 text-emerald-600" /> +4,6 % — calculé sur votre BAIIA</p>
            <div className="rounded-full bg-emerald-600 text-white text-[9px] font-semibold text-center py-1.5">Proposer à l'employée</div>
          </div>
        </FloatCard>
      </div>
    </MockRoot>
  );
}

export function MockLicenses(): JSX.Element {
  const rows = [
    { n: 'Julie Gagnon', r: 'ATP', badge: '134 jours', tone: 'emerald' },
    { n: 'Karim Bélanger', r: 'Pharmacien', badge: '28 jours', tone: 'bronze' },
    { n: 'Marc Lavoie', r: 'Infirmier', badge: 'Expirée', tone: 'red' },
  ];
  return (
    <MockRoot>
      <div className="px-2 sm:px-8 pt-8 pb-12">
        <Window title="Licences professionnelles — coffre-fort Loi 25">
          <div className="p-3 sm:p-4">
            {rows.map((r) => (
              <div key={r.n} className="flex items-center justify-between py-2 border-b border-slate-50">
                <div>
                  <p className="text-[9px] font-bold text-slate-700">{r.n}</p>
                  <p className="text-[8px] text-slate-400">{r.r} — certificat au coffre</p>
                </div>
                <span className={`rounded-full text-[8px] font-bold px-2 py-1 border ${
                  r.tone === 'emerald' ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : r.tone === 'bronze' ? 'bg-bronze-100 border-bronze-300 text-bronze-800'
                  : 'bg-red-50 border-red-200 text-red-700'
                }`}>{r.badge}</span>
              </div>
            ))}
          </div>
        </Window>
        <FloatCard className="left-0 sm:-left-2 -top-4 -rotate-2 animate-float-slow">
          <div className="px-3 py-2 flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            <span className="text-[9px] font-semibold text-slate-700">Documents chiffrés — accès contrôlé</span>
          </div>
        </FloatCard>
        <FloatCard className="right-0 sm:-right-2 -bottom-5 w-48 rotate-2 animate-float">
          <div className="px-3 py-2.5 flex items-start gap-2">
            <ScrollText className="w-3.5 h-3.5 text-bronze-600 shrink-0 mt-0.5" />
            <span className="text-[8px] font-semibold text-slate-700">Rappel envoyé 30 jours avant l'échéance · consultation journalisée</span>
          </div>
        </FloatCard>
      </div>
    </MockRoot>
  );
}

export function MockRecruitment(): JSX.Element {
  const cols = [
    { t: 'Candidatures', n: 3, cards: ['Sophie M.', 'David R.'] },
    { t: 'Entrevue', n: 2, cards: ['Sarah T.'] },
    { t: 'Embauché(e)', n: 1, cards: ['Alex F.'] },
  ];
  return (
    <MockRoot>
      <div className="px-2 sm:px-8 pt-4 pb-16">
        <Window title="Recrutement — ATP temps plein">
          <div className="p-3 sm:p-4 grid grid-cols-3 gap-2">
            {cols.map((c, ci) => (
              <div key={c.t} className="rounded-lg bg-slate-50 border border-slate-100 p-2">
                <p className="text-[8px] font-bold text-slate-500 uppercase mb-1.5">{c.t} ({c.n})</p>
                {c.cards.map((name) => (
                  <div key={name} className={`rounded-md bg-white border px-2 py-1.5 mb-1 ${ci === 2 ? 'border-emerald-300' : 'border-slate-200'}`}>
                    <p className="text-[8px] font-bold text-slate-700">{name}</p>
                    <p className="text-[7px] text-slate-400">{ci === 2 ? 'Dossier créé' : 'ATP'}</p>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Window>
        <FloatCard className="right-0 sm:-right-2 -bottom-10 w-44 sm:w-48 rotate-2 animate-float">
          <div className="p-3.5">
            <p className="text-[9px] font-bold text-slate-800 mb-2 flex items-center gap-1"><ClipboardCheck className="w-3 h-3 text-emerald-600" /> Onboarding — Alex F.</p>
            {[{ t: 'Contrat signé', done: true }, { t: 'NIP de punch créé', done: true }, { t: 'Formation d\'intégration', done: false }].map((s) => (
              <div key={s.t} className="flex items-center gap-1.5 py-1">
                <span className={`w-3 h-3 rounded-full flex items-center justify-center ${s.done ? 'bg-emerald-500' : 'border border-slate-300'}`}>
                  {s.done && <Check className="w-2 h-2 text-white" />}
                </span>
                <span className={`text-[8px] ${s.done ? 'text-slate-400 line-through' : 'text-slate-600 font-semibold'}`}>{s.t}</span>
              </div>
            ))}
            <p className="text-[8px] font-bold text-bronze-700 mt-1">Démarré automatiquement à l'embauche</p>
          </div>
        </FloatCard>
      </div>
    </MockRoot>
  );
}

export function MockLeaves(): JSX.Element {
  return (
    <MockRoot>
      <div className="px-2 sm:px-8 pt-6 pb-14">
        <Window title="Vacances — soldes et demandes">
          <div className="p-4">
            <div className="flex gap-2 mb-3">
              {[['Vacances', '12 j'], ['Maladie', '6 j'], ['Mobile', '3 j']].map(([l, v]) => (
                <div key={l} className="flex-1 rounded-lg bg-emerald-50 border border-emerald-100 px-2 py-1.5 text-center">
                  <p className="text-[8px] uppercase font-bold text-emerald-700 tracking-wider">{l}</p>
                  <p className="text-xs font-extrabold text-slate-800">{v}</p>
                </div>
              ))}
            </div>
            <div className="rounded-lg border border-slate-100 px-3 py-2 mb-1.5 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold text-slate-700">Julie G. — Vacances</p>
                <p className="text-[9px] text-slate-400">2 au 6 septembre · 5 jours</p>
              </div>
              <span className="text-[8px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Approuvée</span>
            </div>
            <div className="rounded-lg border border-slate-100 px-3 py-2 mb-2 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold text-slate-700">Karim B. — Congé mobile</p>
                <p className="text-[9px] text-slate-400">15 août · 1 jour</p>
              </div>
              <span className="text-[8px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">En attente</span>
            </div>
            <div
              className="rounded-lg border border-dashed border-amber-300 px-3 py-1.5 text-[9px] font-semibold text-amber-700 flex items-center gap-1.5"
              style={{ backgroundImage: 'repeating-linear-gradient(45deg, rgba(217,119,6,0.10) 0 6px, transparent 6px 12px)' }}
            >
              <TreePalm className="w-3 h-3" /> Affiché en filigrane sur l'horaire — planification bloquée
            </div>
          </div>
        </Window>
        <FloatCard className="right-0 sm:-right-2 -bottom-4 px-3.5 py-2.5">
          <p className="text-[9px] font-bold text-slate-700 flex items-center gap-1.5">
            <CheckCheck className="w-3 h-3 text-emerald-600" /> Report automatique : +5 j reportés au 1ᵉʳ janvier
          </p>
        </FloatCard>
      </div>
    </MockRoot>
  );
}

export function MockBenefits(): JSX.Element {
  const items = [
    { t: 'Assurance dentaire familiale', s: 'Couverture 80 % — tous les postes', c: 'from-emerald-400 to-emerald-600' },
    { t: 'Rabais employé 20 %', s: 'Produits de la pharmacie', c: 'from-bronze-400 to-bronze-600' },
    { t: 'REER collectif', s: 'Cotisation égalée jusqu\'à 3 %', c: 'from-sky-400 to-sky-600' },
  ];
  return (
    <MockRoot>
      <div className="px-2 sm:px-8 pt-6 pb-14">
        <Window title="Avantages sociaux — 8 publiés">
          <div className="p-4 space-y-2">
            {items.map((b) => (
              <div key={b.t} className="rounded-lg border border-slate-100 px-3 py-2 flex items-center gap-3">
                <span className={`w-8 h-8 rounded-lg bg-gradient-to-br ${b.c} flex items-center justify-center shrink-0`}>
                  <HeartHandshake className="w-3.5 h-3.5 text-white" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-bold text-slate-700 truncate">{b.t}</p>
                  <p className="text-[9px] text-slate-400 truncate">{b.s}</p>
                </div>
                <span className="text-[8px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 shrink-0">Publié</span>
              </div>
            ))}
          </div>
        </Window>
        <FloatCard className="left-0 sm:-left-2 -bottom-4 px-3.5 py-2.5">
          <p className="text-[9px] font-bold text-slate-700 flex items-center gap-1.5">
            <Sparkles className="w-3 h-3 text-violet-600" /> PDF d'assureur importé → 8 avantages illustrés par l'IA
          </p>
        </FloatCard>
      </div>
    </MockRoot>
  );
}

export function MockTeam(): JSX.Element {
  return (
    <MockRoot>
      <div className="px-2 sm:px-8 pt-6 pb-14">
        <Window title="Équipe — sondages, kudos et quarts ouverts">
          <div className="p-4">
            <p className="text-[10px] font-bold text-slate-700 mb-1.5">Party des fêtes : quelle date ? <span className="text-[8px] font-semibold text-slate-400">· 8 votes</span></p>
            {[['Samedi 12 décembre', 62], ['Samedi 19 décembre', 38]].map(([label, pct]) => (
              <div key={String(label)} className="mb-1.5">
                <div className="flex justify-between text-[9px] font-semibold text-slate-500 mb-0.5">
                  <span>{label}</span><span>{pct} %</span>
                </div>
                <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <span className="block h-full bg-emerald-500" style={{ width: `${pct}%` }} />
                </div>
              </div>
            ))}
            <div className="mt-3 rounded-lg bg-bronze-50 border border-bronze-100 px-3 py-2 flex items-center gap-2">
              <PartyPopper className="w-3.5 h-3.5 text-bronze-600 shrink-0" />
              <p className="text-[9px] text-slate-600 min-w-0"><b>Kudos à Julie</b> — « Merci pour le coup de main au labo ! »</p>
              <span className="ml-auto text-[9px] font-bold text-bronze-700 shrink-0 flex items-center gap-1"><Hand className="w-3 h-3" /> 8</span>
            </div>
          </div>
        </Window>
        <FloatCard className="right-0 sm:-right-2 -bottom-4 px-3.5 py-2.5">
          <p className="text-[9px] font-bold text-slate-700 flex items-center gap-1.5">
            <Flame className="w-3 h-3 text-red-500" /> Quart ouvert sam. 9 h–17 h — réclamé en 41 secondes
          </p>
        </FloatCard>
      </div>
    </MockRoot>
  );
}

export function MockBudgets(): JSX.Element {
  const rows = [
    { d: 'Laboratoire', cost: '2 340 $', max: '2 500 $', pct: 94, over: false },
    { d: 'Plancher', cost: '1 940 $', max: '1 800 $', pct: 100, over: true },
    { d: 'Livraison', cost: '620 $', max: '900 $', pct: 69, over: false },
  ];
  return (
    <MockRoot>
      <div className="px-2 sm:px-8 pt-6 pb-14">
        <Window title="Budgets — semaine du 3 août">
          <div className="p-4">
            <div className="flex gap-2 mb-3">
              {['Centre-Ville', 'Plateau'].map((b) => (
                <span key={b} className="inline-flex items-center gap-1 text-[9px] font-bold text-slate-600 bg-slate-100 rounded-full px-2.5 py-1">
                  <Building2 className="w-2.5 h-2.5 text-emerald-600" /> {b}
                </span>
              ))}
            </div>
            {rows.map((r) => (
              <div key={r.d} className="mb-2">
                <div className="flex justify-between text-[9px] font-semibold mb-0.5">
                  <span className="text-slate-600">{r.d}</span>
                  <span className={r.over ? 'text-red-600 font-bold' : 'text-slate-500'}>{r.cost} / {r.max}</span>
                </div>
                <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <span className={`block h-full ${r.over ? 'bg-red-500' : 'bg-emerald-500'}`} style={{ width: `${r.pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Window>
        <FloatCard className="left-0 sm:-left-2 -bottom-4 px-3.5 py-2.5">
          <p className="text-[9px] font-bold text-slate-700 flex items-center gap-1.5">
            <Mail className="w-3 h-3 text-emerald-600" /> Rapport budget mensuel envoyé le 1ᵉʳ à 7 h 30
          </p>
        </FloatCard>
      </div>
    </MockRoot>
  );
}
