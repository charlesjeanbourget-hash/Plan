import { Star } from 'lucide-react';

const TESTIMONIALS = [
  {
    photo: 'https://static.prod-images.emergentagent.com/jobs/8403b6a4-9a66-4570-b8cd-0e218ae356f2/images/6e0473ad58ffe8451b7dee3b00f1096524af13575b924b7a1266e9f0ad2721fa.jpeg',
    quote: 'L\'horaire généré par l\'IA respecte mon budget salarial et les disponibilités de toute l\'équipe. Je récupère enfin mes dimanches soirs.',
    name: 'Marie-Claude Bergeron',
    role: 'Pharmacienne-propriétaire · Longueuil',
  },
  {
    photo: 'https://static.prod-images.emergentagent.com/jobs/8403b6a4-9a66-4570-b8cd-0e218ae356f2/images/d001416b69e290393fccb273881120df6b4cd142e1e79cf3b5809ffe6351fbaf.jpeg',
    quote: 'Les remplacements se règlent par courriel automatique pendant que je sers mes patients. Plus un seul appel d\'agence à faire.',
    name: 'Jean-François Caron',
    role: 'Pharmacien-propriétaire · Trois-Rivières',
  },
  {
    photo: 'https://static.prod-images.emergentagent.com/jobs/8403b6a4-9a66-4570-b8cd-0e218ae356f2/images/ec7b658ea13c85a0a17a743657dd33680d47fc95073ad93faa1172d39ae3e8c7.jpeg',
    quote: 'Le punch à NIP et l\'export vers la paie m\'économisent une journée complète de compilation à chaque quinzaine.',
    name: 'Nathalie Simard',
    role: 'Gestionnaire de pharmacie · Québec',
  },
];

export function TestimonialsSection(): JSX.Element {
  return (
    <section className="bg-white" data-testid="testimonials-section">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-24">
        <div className="text-center max-w-3xl mx-auto mb-12">
          <p className="text-xs sm:text-sm uppercase tracking-[0.18em] text-bronze-700 font-bold mb-3">Ils ont adopté Arrière Plan</p>
          <h2 className="font-heading text-2xl sm:text-3xl lg:text-4xl font-extrabold text-slate-900 leading-tight">
            Des pharmacies qui <span className="text-emerald-600">respirent mieux.</span>
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8">
          {TESTIMONIALS.map((t, i) => (
            <figure
              key={t.name}
              data-testid={`testimonial-card-${i}`}
              className="rounded-2xl bg-white border border-slate-200 p-7 shadow-[0_20px_45px_-25px_rgba(15,23,42,0.25)] hover:-translate-y-1 hover:border-bronze-300 transition-all flex flex-col"
            >
              <div className="flex gap-0.5 mb-4">
                {[1, 2, 3, 4, 5].map((s) => (
                  <Star key={s} className="w-4 h-4 text-bronze-500 fill-bronze-400" />
                ))}
              </div>
              <blockquote className="text-sm text-slate-600 leading-relaxed flex-1">« {t.quote} »</blockquote>
              <figcaption className="mt-6 flex items-center gap-3">
                <img
                  src={t.photo}
                  alt={t.name}
                  loading="lazy"
                  className="w-12 h-12 rounded-full object-cover border-2 border-bronze-200"
                />
                <div>
                  <p className="font-heading font-bold text-slate-900 text-sm">{t.name}</p>
                  <p className="text-xs text-slate-500">{t.role}</p>
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
