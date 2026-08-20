from reportlab.lib.pagesizes import LETTER
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor, white
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer,
                                Table, TableStyle, Image)

EMERALD = HexColor("#059669")
EMERALD_DARK = HexColor("#065f46")
EMERALD_SOFT = HexColor("#f0fdf4")
SLATE = HexColor("#0f172a")
SLATE_MID = HexColor("#475569")
SLATE_LIGHT = HexColor("#94a3b8")
BRONZE = HexColor("#b45309")
BG_CARD = HexColor("#f8fafc")
BORDER = HexColor("#e2e8f0")

OUT = "/app/frontend/public/feuille-vente-arriere-plan.pdf"
LOGO = "/app/frontend/src/assets/logo-arriere-plan.png"

s_h1 = ParagraphStyle("h1", fontName="Helvetica-Bold", fontSize=21, leading=26, textColor=white)
s_tag = ParagraphStyle("tag", fontName="Helvetica", fontSize=10.5, leading=14, textColor=HexColor("#a7f3d0"))
s_col_t = ParagraphStyle("colt", fontName="Helvetica-Bold", fontSize=11, leading=14, textColor=EMERALD_DARK)
s_item = ParagraphStyle("item", fontName="Helvetica", fontSize=8.6, leading=12.2, textColor=SLATE_MID)
s_excl_t = ParagraphStyle("exclt", fontName="Helvetica-Bold", fontSize=9, leading=11.8, textColor=white)
s_excl_i = ParagraphStyle("excli", fontName="Helvetica", fontSize=7.9, leading=10.4, textColor=HexColor("#cbd5e1"))
s_badge = ParagraphStyle("badge", fontName="Helvetica-Bold", fontSize=8.2, leading=11, textColor=EMERALD_DARK, alignment=1)
s_stat_n = ParagraphStyle("statn", fontName="Helvetica-Bold", fontSize=20, leading=23, textColor=EMERALD_DARK, alignment=1)
s_stat_l = ParagraphStyle("statl", fontName="Helvetica", fontSize=7.8, leading=10.4, textColor=SLATE_MID, alignment=1)
s_cta = ParagraphStyle("cta", fontName="Helvetica-Bold", fontSize=12.5, leading=16, textColor=white, alignment=1)
s_cta_s = ParagraphStyle("ctas", fontName="Helvetica", fontSize=8.8, leading=12, textColor=HexColor("#a7f3d0"), alignment=1)

doc = BaseDocTemplate(OUT, pagesize=LETTER,
                      leftMargin=14 * mm, rightMargin=14 * mm, topMargin=10 * mm, bottomMargin=10 * mm,
                      title="Arrière Plan — Feuille de vente", author="Arrière Plan")
frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="main",
              leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
doc.addPageTemplates([PageTemplate(id="page", frames=[frame])])

story = []

logo = Image(LOGO, width=34 * mm, height=34 * mm * 752 / 1379)
hero_inner = Table([
    [logo, Paragraph("Le premier SIRH conçu exclusivement<br/>pour les pharmacies du Québec", s_h1)],
    ["", Paragraph("Horaires IA · Paie · RH · Conformité Loi 25 — Moins de paperasse, plus de temps pour ce qui rapporte.", s_tag)],
], colWidths=[40 * mm, doc.width - 52 * mm])
hero_inner.setStyle(TableStyle([
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("SPAN", (0, 0), (0, 1)),
    ("LEFTPADDING", (0, 0), (-1, -1), 0),
    ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ("TOPPADDING", (0, 0), (-1, -1), 1),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
]))
hero = Table([[hero_inner]], colWidths=[doc.width])
hero.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, -1), SLATE),
    ("LEFTPADDING", (0, 0), (-1, -1), 16),
    ("RIGHTPADDING", (0, 0), (-1, -1), 16),
    ("TOPPADDING", (0, 0), (-1, -1), 16),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 16),
]))
story.append(hero)
story.append(Spacer(1, 12))


def feature_col(title, items):
    cells = [[Paragraph(title, s_col_t)]] + [[Paragraph(f"•  {i}", s_item)] for i in items]
    t = Table(cells, colWidths=[(doc.width - 12) / 3])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), BG_CARD),
        ("BOX", (0, 0), (-1, -1), 0.7, BORDER),
        ("LINEBELOW", (0, 0), (0, 0), 1.2, EMERALD),
        ("LEFTPADDING", (0, 0), (-1, -1), 9),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (0, 0), 9),
        ("BOTTOMPADDING", (0, 0), (0, 0), 6),
        ("TOPPADDING", (0, 1), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 1), (-1, -1), 3),
        ("BOTTOMPADDING", (0, -1), (-1, -1), 9),
    ]))
    return t


cols = Table([[
    feature_col("Horaires intelligents", [
        "Générés par IA : budgets, achalandage et disponibilités respectés",
        "Postes de labo natifs : Dispill, comptage, robot, plancher",
        "Multi-succursales : coûts imputés à la bonne succursale",
        "Trous de couverture détectés et comblés en un clic",
        "Météo intégrée, échanges de quarts, rappels automatiques",
        "Synchronisation Google / Apple / Outlook Calendar",
    ]),
    feature_col("Temps et paie", [
        "Borne de punch par NIP avec géolocalisation",
        "Pauses automatiques et règles d'arrondi configurables",
        "Exports paie : Employeur D, Nethris, ADP",
        "Budgets de paie par succursale (2 semaines / mensuel)",
        "Banques de temps suivies employé par employé",
        "Relevés PDF avec cumulatifs annuels",
    ]),
    feature_col("RH complète", [
        "Recrutement, onboarding, évaluations de performance",
        "Documents et signatures électroniques intégrés",
        "Formations générées par IA à partir d'un PDF + examens",
        "Santé et sécurité au travail (SST / CNESST)",
        "Suivi des licences OPQ avec certificats chiffrés",
        "Messagerie, annonces, sondages et kudos d'équipe",
    ]),
]], colWidths=[(doc.width - 12) / 3 + 4] * 3)
cols.setStyle(TableStyle([
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("LEFTPADDING", (0, 0), (-1, -1), 0),
    ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ("RIGHTPADDING", (-1, 0), (-1, -1), 0),
    ("TOPPADDING", (0, 0), (-1, -1), 0),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
]))
story.append(cols)
story.append(Spacer(1, 12))

excl_items = [
    ("Remplacements automatisés", "Courriels aux agences, offres comparées, choix en un clic."),
    ("Livraisons optimisées", "Tournées calculées, preuves de livraison, suivi du livreur."),
    ("Formations IA + examens", "Déposez un PDF : parcours et examen créés en secondes."),
    ("Incompatibilités d'employés", "L'IA ne planifie jamais ensemble deux employés incompatibles."),
]
excl_cells = [[Paragraph("EXCLUSIVITÉS PHARMACIE — CE QU'AUCUN CONCURRENT N'OFFRE",
                         ParagraphStyle("et", fontName="Helvetica-Bold", fontSize=8.5, leading=11,
                                        textColor=HexColor("#6ee7b7")))]]
row = []
for t, d in excl_items:
    row.append(Table([[Paragraph(t, s_excl_t)], [Paragraph(d, s_excl_i)]],
                     colWidths=[(doc.width - 28 - 18) / 4],
                     style=TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0),
                                       ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                                       ("TOPPADDING", (0, 0), (-1, -1), 1),
                                       ("BOTTOMPADDING", (0, 0), (-1, -1), 1)])))
inner = Table([row], colWidths=[(doc.width - 28) / 4] * 4)
inner.setStyle(TableStyle([
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("LEFTPADDING", (0, 0), (-1, -1), 0),
    ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ("TOPPADDING", (0, 0), (-1, -1), 0),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
]))
excl = Table(excl_cells + [[inner]], colWidths=[doc.width])
excl.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, -1), SLATE),
    ("LEFTPADDING", (0, 0), (-1, -1), 14),
    ("RIGHTPADDING", (0, 0), (-1, -1), 14),
    ("TOPPADDING", (0, 0), (0, 0), 12),
    ("BOTTOMPADDING", (0, 0), (0, 0), 6),
    ("TOPPADDING", (0, 1), (0, 1), 3),
    ("BOTTOMPADDING", (0, 1), (0, 1), 13),
]))
story.append(excl)
story.append(Spacer(1, 12))

stats = Table([[
    Table([[Paragraph("23/23", s_stat_n)], [Paragraph("fonctionnalités clés couvertes<br/>vs 11/23 chez Agendrix", s_stat_l)]],
          colWidths=[(doc.width - 18) / 4]),
    Table([[Paragraph("5 h+", s_stat_n)], [Paragraph("de gestion économisées<br/>par semaine", s_stat_l)]],
          colWidths=[(doc.width - 18) / 4]),
    Table([[Paragraph("Loi 25", s_stat_n)], [Paragraph("conformité intégrée : audit,<br/>droit à l'oubli, ÉFVP, MFA", s_stat_l)]],
          colWidths=[(doc.width - 18) / 4]),
    Table([[Paragraph("9", s_stat_n)], [Paragraph("exclusivités pharmacie<br/>introuvables ailleurs", s_stat_l)]],
          colWidths=[(doc.width - 18) / 4]),
]], colWidths=[(doc.width - 18) / 4 + 6] * 4)
stats.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, -1), EMERALD_SOFT),
    ("BOX", (0, 0), (-1, -1), 0.7, HexColor("#a7f3d0")),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("TOPPADDING", (0, 0), (-1, -1), 13),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 13),
]))
story.append(stats)
story.append(Spacer(1, 12))

sec_badges = ["MFA imposable", "Chiffrement AES/TLS", "Journal d'audit 140+ points",
              "Base injoignable d'Internet (testé)", "Sauvegardes horaires", "Hébergement divulgué + ÉFVP"]
badge_row = [Paragraph(b, s_badge) for b in sec_badges]
badges = Table([badge_row], colWidths=[doc.width / 6] * 6)
badges.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, -1), white),
    ("GRID", (0, 0), (-1, -1), 0.6, BORDER),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("TOPPADDING", (0, 0), (-1, -1), 10),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
    ("LEFTPADDING", (0, 0), (-1, -1), 4),
    ("RIGHTPADDING", (0, 0), (-1, -1), 4),
]))
story.append(badges)
story.append(Spacer(1, 13))

cta = Table([
    [Paragraph("Voyez la différence en démo — sans engagement", s_cta)],
    [Paragraph("arriereplanrh.com  ·  Démo personnalisée avec les scénarios réels de votre pharmacie", s_cta_s)],
], colWidths=[doc.width])
cta.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, -1), EMERALD),
    ("TOPPADDING", (0, 0), (0, 0), 15),
    ("BOTTOMPADDING", (0, 0), (0, 0), 3),
    ("TOPPADDING", (0, 1), (0, 1), 3),
    ("BOTTOMPADDING", (0, 1), (0, 1), 15),
]))
story.append(cta)

doc.build(story)
print("Feuille de vente générée :", OUT)
