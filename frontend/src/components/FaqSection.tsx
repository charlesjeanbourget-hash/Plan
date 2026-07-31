import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { ArrowRight } from 'lucide-react';

const FAQS = [
  {
    id: 'securite',
    q: 'Mes données et celles de mes employés sont-elles en sécurité ?',
    a: 'Oui. Arrière Plan est conçu selon les exigences de la Loi 25 du Québec : documents sensibles dans un coffre-fort numérique chiffré, accès réservé aux gestionnaires autorisés, journal d\'audit de chaque consultation et droit à l\'oubli (destruction définitive sur demande). Vos données restent les vôtres.',
  },
  {
    id: 'mise-en-place',
    q: 'Combien de temps prend la mise en place ?',
    a: 'Quelques jours, pas quelques mois. Vous créez vos employés et leurs disponibilités, et le reste suit : le premier horaire peut être généré par l\'IA dès la première semaine. Nous vous accompagnons lors de la démo pour configurer votre pharmacie (succursales, période de paie, budget salarial).',
  },
  {
    id: 'formation',
    q: 'Mes employés vont-ils s\'y retrouver facilement ?',
    a: 'L\'interface est 100 % en français et pensée pour le quotidien d\'une pharmacie. Un employé consulte son horaire, punch avec son NIP, coche ses tâches et demande ses congés sans aucune formation. Les formations internes, elles, sont même générées par l\'IA à partir de vos propres documents PDF.',
  },
  {
    id: 'paie',
    q: 'Est-ce compatible avec mon logiciel de paie (Nethris, Employeur D, ADP…) ?',
    a: 'Oui. Les heures punchées — temps supplémentaire inclus — s\'exportent en un clic dans un fichier CSV universel que Nethris, Employeur D (Desjardins), ADP, QuickBooks et les autres grands logiciels canadiens savent importer. Des connexions directes par API sont aussi possibles selon votre fournisseur — parlez-en lors de votre démo.',
  },
  {
    id: 'mobile',
    q: 'Puis-je l\'utiliser sur tablette et cellulaire ?',
    a: 'Absolument. Arrière Plan est une application web installable (PWA) : vos employés l\'ajoutent à l\'écran d\'accueil de leur téléphone pour puncher, consulter leur horaire et clavarder avec l\'équipe. Une tablette au comptoir devient une borne de punch sécurisée à NIP.',
  },
  {
    id: 'horaire-ia',
    q: 'L\'horaire généré par l\'IA — est-ce que je garde le contrôle ?',
    a: 'Toujours. L\'IA propose un horaire qui respecte les disponibilités, les rôles, votre budget salarial et l\'achalandage, puis signale elle-même les points à vérifier (absences, qualifications, dépassements de budget). Rien n\'est appliqué sans votre approbation — et chaque employé confirme ensuite son horaire.',
  },
  {
    id: 'remplacements',
    q: 'Que se passe-t-il quand un employé se désiste à la dernière minute ?',
    a: 'Vous créez une demande de remplacement en 30 secondes : vos agences partenaires reçoivent automatiquement un courriel avec un lien sécurisé, soumettent leurs candidats en ligne, et vous comparez les offres (taux, expérience, licence) avant de choisir. Le remplaçant retenu apparaît directement à l\'horaire.',
  },
  {
    id: 'engagement',
    q: 'La démo m\'engage-t-elle à quelque chose ?',
    a: 'Non. La démo dure 30 minutes, en visioconférence, sans engagement et sans carte de crédit. Nous parcourons vos vrais scénarios — horaires, punch, paie, remplacements — et vous décidez ensuite, tout simplement.',
  },
];

export function FaqSection(): JSX.Element {
  return (
    <section id="faq" className="bg-white" data-testid="faq-section">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16 sm:py-24">
        <div className="text-center mb-10">
          <p className="text-xs sm:text-sm uppercase tracking-[0.18em] text-bronze-700 font-bold mb-3">Questions fréquentes</p>
          <h2 className="font-heading text-2xl sm:text-3xl lg:text-4xl font-extrabold text-slate-900 leading-tight">
            Tout ce que les pharmaciens <span className="text-emerald-600">nous demandent.</span>
          </h2>
        </div>
        <Accordion type="single" collapsible className="bg-white rounded-2xl border border-slate-200 px-6 shadow-[0_20px_45px_-30px_rgba(15,23,42,0.25)]">
          {FAQS.map((f) => (
            <AccordionItem key={f.id} value={f.id}>
              <AccordionTrigger data-testid={`public-faq-question-${f.id}`} className="text-left font-semibold text-slate-800 text-sm sm:text-base hover:text-emerald-700">
                {f.q}
              </AccordionTrigger>
              <AccordionContent className="text-sm text-slate-600 leading-relaxed">
                {f.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
        <div className="text-center mt-8">
          <p className="text-sm text-slate-500 mb-4">Une autre question ? Posez-la-nous directement.</p>
          <button
            data-testid="faq-demo-cta"
            onClick={() => document.getElementById('demo')?.scrollIntoView({ behavior: 'smooth' })}
            className="px-7 py-3 rounded-full bg-emerald-600 text-white font-semibold text-sm hover:bg-emerald-700 transition-colors inline-flex items-center gap-2"
          >
            Réserver une démo <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </section>
  );
}
