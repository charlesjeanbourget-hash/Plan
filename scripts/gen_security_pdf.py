from reportlab.lib.pagesizes import LETTER
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor, white
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer,
                                Table, TableStyle, Image, HRFlowable, KeepTogether)

EMERALD = HexColor("#059669")
EMERALD_DARK = HexColor("#065f46")
SLATE = HexColor("#0f172a")
SLATE_MID = HexColor("#475569")
SLATE_LIGHT = HexColor("#94a3b8")
BRONZE = HexColor("#b45309")
BG_SOFT = HexColor("#f0fdf4")
BG_CARD = HexColor("#f8fafc")
BORDER = HexColor("#e2e8f0")

OUT = "/app/frontend/public/dossier-securite-loi25.pdf"
LOGO = "/app/frontend/src/assets/logo-arriere-plan.png"

s_title = ParagraphStyle("title", fontName="Helvetica-Bold", fontSize=24, leading=29, textColor=SLATE)
s_subtitle = ParagraphStyle("subtitle", fontName="Helvetica", fontSize=11.5, leading=16, textColor=SLATE_MID)
s_h1 = ParagraphStyle("h1", fontName="Helvetica-Bold", fontSize=14.5, leading=18, textColor=EMERALD_DARK, spaceBefore=14, spaceAfter=6)
s_h2 = ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=10.5, leading=14, textColor=SLATE)
s_body = ParagraphStyle("body", fontName="Helvetica", fontSize=9.5, leading=13.5, textColor=SLATE_MID)
s_bullet = ParagraphStyle("bullet", parent=s_body, leftIndent=10, bulletIndent=2, spaceAfter=2.5)
s_cell_k = ParagraphStyle("cellk", fontName="Helvetica-Bold", fontSize=9, leading=12, textColor=SLATE)
s_cell_v = ParagraphStyle("cellv", fontName="Helvetica", fontSize=9, leading=12, textColor=SLATE_MID)
s_quote = ParagraphStyle("quote", fontName="Helvetica-Oblique", fontSize=10, leading=15, textColor=EMERALD_DARK)
s_badge = ParagraphStyle("badge", fontName="Helvetica-Bold", fontSize=8.5, leading=11, textColor=white, alignment=TA_CENTER)


def header_footer(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(EMERALD)
    canvas.rect(0, LETTER[1] - 6 * mm, LETTER[0], 6 * mm, stroke=0, fill=1)
    canvas.setFillColor(SLATE_LIGHT)
    canvas.setFont("Helvetica", 7.5)
    canvas.drawString(18 * mm, 10 * mm, "Arrière Plan — Dossier de sécurité et de conformité · Confidentiel")
    canvas.drawRightString(LETTER[0] - 18 * mm, 10 * mm, f"Page {doc.page}")
    canvas.setStrokeColor(BORDER)
    canvas.setLineWidth(0.5)
    canvas.line(18 * mm, 14 * mm, LETTER[0] - 18 * mm, 14 * mm)
    canvas.restoreState()


doc = BaseDocTemplate(OUT, pagesize=LETTER,
                      leftMargin=18 * mm, rightMargin=18 * mm, topMargin=16 * mm, bottomMargin=20 * mm,
                      title="Arrière Plan — Dossier de sécurité et de conformité Loi 25",
                      author="Arrière Plan")
frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="main")
doc.addPageTemplates([PageTemplate(id="page", frames=[frame], onPage=header_footer)])

story = []

logo = Image(LOGO, width=52 * mm, height=52 * mm * 752 / 1379)
logo.hAlign = "LEFT"
story.append(logo)
story.append(Spacer(1, 6))
story.append(Paragraph("Dossier de sécurité et de conformité", s_title))
story.append(Spacer(1, 3))
story.append(Paragraph("Protection des renseignements personnels · Conformité Loi 25 · Sécurité applicative", s_subtitle))
story.append(Spacer(1, 4))
story.append(Paragraph("Document de référence — Juin 2026 · arriereplanrh.com", ParagraphStyle("d", parent=s_subtitle, fontSize=9, textColor=SLATE_LIGHT)))
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


# 1. Loi 25
section(1, "Conformité à la Loi 25 (Québec)")
story.append(Paragraph("Consentement explicite", s_h2))
bullets(["À la première connexion, chaque utilisateur doit lire et accepter la politique de confidentialité "
         "avant d'accéder à la plateforme (consentement horodaté et conservé au dossier)."])
story.append(Spacer(1, 4))
story.append(Paragraph("Droit à l'oubli (anonymisation)", s_h2))
bullets(["Anonymisation complète d'un ancien employé en un clic : nom remplacé par un identifiant neutre, "
         "courriel désactivé, compte suspendu, notes effacées, pointages et licences anonymisés.",
         "Chaque anonymisation est elle-même inscrite au journal d'audit avec le détail des données touchées."])
story.append(Spacer(1, 4))
story.append(Paragraph("Journal d'audit inaltérable", s_h2))
bullets(["Plus de 140 points d'audit : chaque action sensible (connexion, modification de dossier, export de paie, "
         "changement de politique de sécurité, anonymisation, consultation de documents…) est enregistrée avec "
         "l'auteur, son rôle, la date et le détail de l'action.",
         "Permet de démontrer en tout temps <i>qui a fait quoi, quand</i> — exigence centrale de la Loi 25 en cas d'incident."])
story.append(Spacer(1, 4))
story.append(Paragraph("Minimisation et cloisonnement des données", s_h2))
bullets(["Chaque pharmacie ne voit que ses propres données (cloisonnement strict par organisation).",
         "Les employés n'accèdent qu'à leurs propres renseignements (libre-service « Mon espace »)."])
story.append(Spacer(1, 4))
story.append(Paragraph("Traçabilité des incidents", s_h2))
bullets(["Détection des connexions depuis une nouvelle adresse IP avec alerte automatique — identification rapide "
         "d'un accès non autorisé (obligation de notification des incidents de confidentialité)."])

# 2. Auth
section(2, "Sécurité des comptes et de l'authentification")
card_table([
    ("Mots de passe hachés (bcrypt)", "Jamais stockés en clair — même l'équipe technique ne peut pas les lire."),
    ("Vérification en 2 étapes (MFA)", "Codes TOTP compatibles Google Authenticator ; secrets MFA chiffrés en base de données."),
    ("MFA imposable", "L'administrateur peut exiger la MFA pour tous les comptes de la pharmacie."),
    ("Politique de mot de passe configurable", "Longueur minimale, majuscule / minuscule / chiffre / caractère spécial, "
     "expiration (90 j, 180 j ou 1 an) avec renouvellement forcé."),
    ("Sessions à durée limitée", "Jetons JWT expirant après 24 heures — reconnexion obligatoire."),
    ("Réinitialisation sécurisée", "Code à usage unique envoyé par courriel, valide 15 minutes, maximum 5 tentatives, haché en base."),
    ("Alertes de connexion suspecte", "Courriel automatique lors d'une connexion depuis une nouvelle adresse IP."),
    ("Borne de pointage protégée", "NIP à 4 chiffres hachés (SHA-256 + poivre secret) ; verrouillage temporaire après "
     "plusieurs NIP invalides (anti-force brute)."),
])

# 3. Chiffrement
section(3, "Chiffrement des données")
bullets([
    "<b>En transit :</b> toutes les communications passent par HTTPS/TLS (navigateur ↔ serveur).",
    "<b>Au repos :</b> les documents sensibles (certificats de licences professionnelles OPQ) sont chiffrés "
    "avec une clé Fernet (AES-128) avant stockage — un accès direct aux fichiers ne révèle rien.",
    "<b>Secrets MFA :</b> chiffrés avec la même infrastructure de clés.",
    "<b>Clés et identifiants :</b> aucun secret n'est inscrit dans le code source ; tout est stocké dans des "
    "variables d'environnement sur le serveur uniquement.",
])

# 4. Accès
section(4, "Contrôle d'accès")
bullets([
    "<b>Rôles hiérarchiques :</b> superadmin, administrateur, gestionnaire, employé — chacun ne voit que ce qui le concerne.",
    "<b>Accès par module personnalisable :</b> l'administrateur contrôle précisément quels modules chaque rôle "
    "(ou chaque personne) peut consulter.",
    "<b>Champs sensibles filtrés :</b> taux horaires, NIP et données RH ne sont jamais renvoyés aux employés non autorisés.",
])

# 5. GitHub
section(5, "GitHub — sauvegarde et intégrité du code")
story.append(Paragraph("<b>Important : GitHub n'héberge que le code source, jamais les données personnelles.</b> "
                       "Le code ne contient aucun renseignement personnel ni aucun secret.", s_body))
story.append(Spacer(1, 4))
bullets([
    "<b>Dépôt privé :</b> code visible uniquement par les collaborateurs autorisés.",
    "<b>Historique complet et inaltérable :</b> chaque modification du code est tracée (qui, quand, quoi) — "
    "retour possible à toute version antérieure.",
    "<b>Chiffrement</b> au repos et en transit ; détection automatique de secrets accidentellement exposés.",
    "<b>Standard de l'industrie :</b> utilisé par les institutions financières, gouvernements et systèmes de santé "
    "(propriété de Microsoft).",
    "<b>Continuité d'affaires :</b> en cas de panne de l'hébergeur, l'application peut être redéployée ailleurs "
    "en quelques heures à partir du dépôt.",
])

# 6. Hébergement
section(6, "Hébergement des données")
bullets([
    "<b>Situation actuelle :</b> application déployée sur une infrastructure infonuagique gérée "
    "(conteneurs isolés, HTTPS, base MongoDB dédiée).",
    "<b>Ce que la Loi 25 exige :</b> les renseignements personnels peuvent être hébergés hors Québec à condition "
    "qu'une évaluation des facteurs relatifs à la vie privée (ÉFVP) démontre une protection adéquate.",
])
story.append(Spacer(1, 4))
story.append(Paragraph("Option renforcée planifiée — hébergement 100 % québécois", s_h2))
bullets([
    "OVHcloud (Beauharnois), AWS ou Google Cloud (région Montréal) avec MongoDB Atlas région Montréal.",
    "Avantage : les données ne quittent jamais le Québec → aucune ÉFVP de transfert requise, conformité simplifiée, "
    "argument de confiance pour les pharmacies clientes.",
    "Sauvegardes automatiques et chiffrement géré inclus avec MongoDB Atlas.",
])

# 7. Complémentaires
section(7, "Mesures complémentaires")
bullets([
    "<b>Signatures électroniques</b> conservées avec horodatage au dossier de l'employé.",
    "<b>Suivi des licences professionnelles</b> (OPQ) avec certificats chiffrés et alertes d'expiration.",
    "<b>Séparation des environnements :</b> développement distinct de la production — aucun test sur les données réelles.",
    "<b>Gestion des départs :</b> suspension immédiate du compte et anonymisation possible à la fin de l'emploi.",
])

# 8. Résumé
section(8, "Résumé exécutif")
quote = Table([[Paragraph(
    "Arrière Plan applique le principe de protection dès la conception (<i>privacy by design</i>) : consentement "
    "explicite, chiffrement des données sensibles, authentification forte imposable, journal d'audit exhaustif, "
    "droit à l'oubli en un clic et cloisonnement strict par pharmacie. Le code source est sécurisé et versionné "
    "sur GitHub (sans aucune donnée personnelle), et l'architecture permet une migration vers un hébergement "
    "entièrement québécois pour une conformité Loi 25 maximale.", s_quote)]],
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

doc.build(story)
print("PDF généré :", OUT)
