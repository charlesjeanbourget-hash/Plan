from reportlab.lib.pagesizes import LETTER
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor, white
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer,
                                Table, TableStyle, Image, HRFlowable, KeepTogether)

EMERALD = HexColor("#059669")
EMERALD_DARK = HexColor("#065f46")
SLATE = HexColor("#0f172a")
SLATE_MID = HexColor("#475569")
SLATE_LIGHT = HexColor("#94a3b8")
BG_SOFT = HexColor("#f0fdf4")
BG_CARD = HexColor("#f8fafc")
BORDER = HexColor("#e2e8f0")

OUT = "/app/frontend/public/efvp-arriere-plan.pdf"
LOGO = "/app/frontend/src/assets/logo-arriere-plan.png"

s_title = ParagraphStyle("title", fontName="Helvetica-Bold", fontSize=21, leading=26, textColor=SLATE)
s_subtitle = ParagraphStyle("subtitle", fontName="Helvetica", fontSize=11, leading=15, textColor=SLATE_MID)
s_h1 = ParagraphStyle("h1", fontName="Helvetica-Bold", fontSize=13.5, leading=17, textColor=EMERALD_DARK, spaceBefore=13, spaceAfter=5)
s_h2 = ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=10.5, leading=14, textColor=SLATE)
s_body = ParagraphStyle("body", fontName="Helvetica", fontSize=9.5, leading=13.5, textColor=SLATE_MID)
s_bullet = ParagraphStyle("bullet", parent=s_body, leftIndent=10, bulletIndent=2, spaceAfter=2.5)
s_cell_k = ParagraphStyle("cellk", fontName="Helvetica-Bold", fontSize=9, leading=12, textColor=SLATE)
s_cell_v = ParagraphStyle("cellv", fontName="Helvetica", fontSize=9, leading=12, textColor=SLATE_MID)
s_quote = ParagraphStyle("quote", fontName="Helvetica-Oblique", fontSize=10, leading=15, textColor=EMERALD_DARK)


def header_footer(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(EMERALD)
    canvas.rect(0, LETTER[1] - 6 * mm, LETTER[0], 6 * mm, stroke=0, fill=1)
    canvas.setFillColor(SLATE_LIGHT)
    canvas.setFont("Helvetica", 7.5)
    canvas.drawString(18 * mm, 10 * mm, "Arrière Plan — ÉFVP (évaluation des facteurs relatifs à la vie privée) · Confidentiel")
    canvas.drawRightString(LETTER[0] - 18 * mm, 10 * mm, f"Page {doc.page}")
    canvas.setStrokeColor(BORDER)
    canvas.setLineWidth(0.5)
    canvas.line(18 * mm, 14 * mm, LETTER[0] - 18 * mm, 14 * mm)
    canvas.restoreState()


doc = BaseDocTemplate(OUT, pagesize=LETTER,
                      leftMargin=18 * mm, rightMargin=18 * mm, topMargin=16 * mm, bottomMargin=20 * mm,
                      title="ÉFVP — Hébergement infonuagique hors Québec — Arrière Plan",
                      author="Arrière Plan")
frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="main")
doc.addPageTemplates([PageTemplate(id="page", frames=[frame], onPage=header_footer)])

story = []
logo = Image(LOGO, width=46 * mm, height=46 * mm * 752 / 1379)
logo.hAlign = "LEFT"
story.append(logo)
story.append(Spacer(1, 6))
story.append(Paragraph("Évaluation des facteurs relatifs à la vie privée (ÉFVP)", s_title))
story.append(Spacer(1, 3))
story.append(Paragraph("Communication de renseignements personnels à l'extérieur du Québec — "
                       "hébergement infonuagique de la plateforme Arrière Plan", s_subtitle))
story.append(Spacer(1, 4))
story.append(Paragraph("Réalisée en vertu de l'article 17 de la Loi 25 (Loi modernisant des dispositions législatives "
                       "en matière de protection des renseignements personnels) · 20 août 2026",
                       ParagraphStyle("d", parent=s_subtitle, fontSize=9, textColor=SLATE_LIGHT)))
story.append(Spacer(1, 8))
story.append(HRFlowable(width="100%", thickness=2, color=EMERALD))
story.append(Spacer(1, 4))


def section(num, title):
    story.append(Paragraph(f"{num}.&nbsp;&nbsp;{title}", s_h1))


def bullets(items):
    for it in items:
        story.append(Paragraph(it, s_bullet, bulletText="•"))


def card_table(rows, col1=52 * mm):
    data = [[Paragraph(k, s_cell_k), Paragraph(v, s_cell_v)] for k, v in rows]
    t = Table(data, colWidths=[col1, doc.width - col1], hAlign="LEFT")
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, -1), BG_SOFT),
        ("ROWBACKGROUNDS", (1, 0), (1, -1), [white, BG_CARD]),
        ("GRID", (0, 0), (-1, -1), 0.5, BORDER),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4.5),
    ]))
    story.append(t)


section(1, "Identification du projet")
card_table([
    ("Projet évalué", "Hébergement et exploitation de la plateforme Arrière Plan (système d'information de "
     "ressources humaines — SIRH — pour pharmacies) sur une infrastructure infonuagique située hors Québec."),
    ("Organisation", "Arrière Plan (arriereplanrh.com)"),
    ("Responsable de la protection des renseignements personnels", "Charles Jean-Bourget — charlesjeanbourget@gmail.com"),
    ("Date de l'évaluation", "20 août 2026"),
    ("Déclencheur", "Article 17 de la Loi 25 : évaluation obligatoire avant toute communication de renseignements "
     "personnels à l'extérieur du Québec."),
])

section(2, "Renseignements personnels visés")
bullets([
    "Coordonnées des employés : nom, courriel, téléphone, contact d'urgence.",
    "Données d'emploi : poste, taux horaire, matricule de paie, horaires, heures travaillées, banques de temps.",
    "Données de pointage, incluant — avec consentement explicite du navigateur — la position géographique au moment du punch.",
    "Licences et certificats professionnels (OPQ — Ordre des pharmaciens du Québec), chiffrés avant stockage.",
    "Évaluations de performance, documents signés électroniquement, messages de la messagerie interne.",
    "Candidatures reçues via le portail carrières.",
])
story.append(Paragraph("Ne sont PAS traités par la plateforme : numéros d'assurance sociale, renseignements "
                       "bancaires des employés, dossiers médicaux.", s_body))

section(3, "Destination et destinataire")
card_table([
    ("Infrastructure", "Google Cloud Platform (GCP), gérée par le fournisseur de plateforme Emergent."),
    ("Région d'hébergement", "us-central1 — Iowa, États-Unis."),
    ("Cadre juridique de destination", "Lois fédérales et étatiques américaines, incluant le CLOUD Act "
     "(accès possible des autorités américaines sur ordonnance, dans des cas encadrés)."),
    ("Sous-traitance", "Aucune communication à des tiers à des fins commerciales ; les modèles d'intelligence "
     "artificielle (IA) sont consommés par API professionnelle sans conservation ni entraînement sur les données."),
])

section(4, "Mesures de protection en place")
bullets([
    "<b>Chiffrement en transit :</b> HTTPS/TLS (Transport Layer Security) pour toutes les communications.",
    "<b>Chiffrement au repos :</b> chiffrement de l'infrastructure Google Cloud, plus chiffrement applicatif "
    "supplémentaire (Fernet/AES) des certificats professionnels et des secrets de vérification en 2 étapes.",
    "<b>Authentification :</b> mots de passe hachés (bcrypt), vérification en 2 étapes (MFA/TOTP) imposable, "
    "politique de mot de passe configurable avec expiration, sessions limitées à 24 heures (jetons JWT).",
    "<b>Contrôle d'accès :</b> rôles hiérarchiques, accès par module, cloisonnement strict par pharmacie.",
    "<b>Traçabilité :</b> journal d'audit inaltérable de plus de 140 points ; alertes de connexion depuis une "
    "nouvelle adresse IP.",
    "<b>Résilience :</b> sauvegardes horaires et quotidiennes gérées par la plateforme.",
    "<b>Exposition réseau :</b> base de données inaccessible depuis Internet — vérifié par balayage externe des "
    "ports 27017-27019 le 19 août 2026 (connexions refusées ; seul le port 443/HTTPS répond).",
])

section(5, "Analyse des risques")
risk_rows = [
    [Paragraph("<b>Risque</b>", s_cell_k), Paragraph("<b>Probabilité</b>", s_cell_k),
     Paragraph("<b>Impact</b>", s_cell_k), Paragraph("<b>Atténuation</b>", s_cell_k)],
    [Paragraph("Accès par les autorités américaines (CLOUD Act)", s_cell_v), Paragraph("Faible", s_cell_v),
     Paragraph("Moyen", s_cell_v),
     Paragraph("Données limitées (aucun NAS ni donnée médicale) ; chiffrement applicatif des documents sensibles ; "
               "migration québécoise planifiée.", s_cell_v)],
    [Paragraph("Accès non autorisé à la base de données", s_cell_v), Paragraph("Très faible", s_cell_v),
     Paragraph("Élevé", s_cell_v),
     Paragraph("Base injoignable d'Internet (testé) ; isolation réseau ; authentification forte applicative ; "
               "journal d'audit.", s_cell_v)],
    [Paragraph("Perte de données", s_cell_v), Paragraph("Très faible", s_cell_v), Paragraph("Élevé", s_cell_v),
     Paragraph("Sauvegardes horaires et quotidiennes ; code source versionné (GitHub) permettant un redéploiement rapide.", s_cell_v)],
    [Paragraph("Usage non autorisé par l'IA", s_cell_v), Paragraph("Très faible", s_cell_v), Paragraph("Moyen", s_cell_v),
     Paragraph("Minimisation des données transmises ; API sans entraînement sur les données ; validation humaine "
               "de chaque proposition ; garde-fous serveur.", s_cell_v)],
]
rt = Table(risk_rows, colWidths=[52 * mm, 22 * mm, 20 * mm, doc.width - 94 * mm], hAlign="LEFT", repeatRows=1)
rt.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), EMERALD),
    ("TEXTCOLOR", (0, 0), (-1, 0), white),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [white, BG_CARD]),
    ("GRID", (0, 0), (-1, -1), 0.5, BORDER),
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("LEFTPADDING", (0, 0), (-1, -1), 6),
    ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ("TOPPADDING", (0, 0), (-1, -1), 5),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
]))
story.append(rt)

section(6, "Transparence et droits des personnes concernées")
bullets([
    "La politique de confidentialité publiée sur le site divulgue explicitement l'hébergement à l'extérieur du "
    "Québec (Google Cloud, Iowa, États-Unis), conformément à l'obligation de transparence.",
    "Chaque utilisateur consent à la politique de confidentialité à sa première connexion (consentement horodaté).",
    "Droits d'accès, de rectification, de suppression et de retrait de consentement exerçables auprès du "
    "responsable de la protection des renseignements personnels — réponse sous 30 jours.",
    "Droit à l'oubli opérationnel : anonymisation complète en un clic, consignée au journal d'audit.",
])

section(7, "Conclusion de l'évaluation")
quote = Table([[Paragraph(
    "Compte tenu de la nature des renseignements visés, des mesures de protection techniques et organisationnelles "
    "en place (chiffrement, authentification forte, isolation réseau vérifiée par tests, journal d'audit, "
    "sauvegardes) et de la transparence assurée auprès des personnes concernées, les renseignements personnels "
    "communiqués à l'extérieur du Québec bénéficient d'une <b>protection adéquate au sens de l'article 17 de la "
    "Loi 25</b>. La communication est donc autorisée. Cette évaluation sera revue lors de tout changement "
    "d'infrastructure, et deviendra caduque (dans le bon sens) advenant la migration planifiée vers un hébergement "
    "situé au Québec (MongoDB Atlas, région Montréal).", s_quote)]],
    colWidths=[doc.width])
quote.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, -1), BG_SOFT),
    ("LINEBEFORE", (0, 0), (0, -1), 3, EMERALD),
    ("LEFTPADDING", (0, 0), (-1, -1), 12),
    ("RIGHTPADDING", (0, 0), (-1, -1), 10),
    ("TOPPADDING", (0, 0), (-1, -1), 10),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
]))
story.append(KeepTogether(quote))

section(8, "Approbation")
sig_rows = [
    ("Responsable de la protection des renseignements personnels", "Charles Jean-Bourget"),
    ("Signature", "_________________________________"),
    ("Date", "_________________________________"),
    ("Prochaine révision", "Au plus tard 12 mois après la signature, ou lors de tout changement d'hébergement."),
]
card_table(sig_rows, col1=70 * mm)

doc.build(story)
print("ÉFVP générée :", OUT)
