import { jsPDF } from 'jspdf';
import { Employee, PayrollEntry } from '@/types';
import { getLogoDataUrl } from '@/lib/logoData';

const money = (n: number): string =>
  n.toLocaleString('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' $';

export const downloadPayStub = async (
  employee: Employee,
  entry: PayrollEntry,
  pharmacyName: string,
  allEntries: PayrollEntry[] = []
): Promise<void> => {
  const ytd = (allEntries.length > 0 ? allEntries : [entry]).filter(
    (e) => e.employeeId === employee.id && e.periodStart <= entry.periodStart
  );
  const ytdHours = ytd.reduce((s, e) => s + e.hoursWorked, 0);
  const ytdGross = ytd.reduce((s, e) => s + e.grossPay, 0);
  const ytdDeductions = ytd.reduce((s, e) => s + e.deductions, 0);
  const ytdNet = ytd.reduce((s, e) => s + e.netPay, 0);
  const doc = new jsPDF();
  const line = (y: number): void => {
    doc.setDrawColor(226, 232, 240);
    doc.line(20, y, 190, y);
  };

  try {
    const logoData = await getLogoDataUrl();
    doc.addImage(logoData, 'JPEG', 20, 5, 34, 18.5);
  } catch {
    doc.setTextColor(5, 150, 105);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Arrière Plan', 20, 16);
  }
  doc.setTextColor(5, 150, 105);
  doc.setFontSize(17);
  doc.setFont('helvetica', 'bold');
  doc.text('Relevé de paie', 190, 17, { align: 'right' });
  doc.setFillColor(195, 96, 48);
  doc.rect(0, 28, 210, 1.2, 'F');

  doc.setTextColor(15, 23, 42);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text(pharmacyName, 20, 40);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(100, 116, 139);
  doc.text(`Période : ${entry.period}  ·  Généré le ${new Date().toLocaleDateString('fr-CA')}`, 20, 46);

  doc.setTextColor(15, 23, 42);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text(`${employee.firstName} ${employee.lastName}`, 20, 60);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`${employee.position}  ·  Taux horaire : ${money(employee.hourlyRate)}`, 20, 66);
  line(72);

  doc.setFont('helvetica', 'bold');
  doc.text('Gains', 20, 82);
  doc.setFont('helvetica', 'normal');
  const regularHours = entry.hoursWorked - entry.overtimeHours;
  doc.text(`Heures normales (${regularHours} h × ${money(employee.hourlyRate)})`, 25, 90);
  doc.text(money(regularHours * employee.hourlyRate), 190, 90, { align: 'right' });
  doc.text(`Temps supplémentaire (${entry.overtimeHours} h × ${money(employee.hourlyRate * 1.5)})`, 25, 97);
  doc.text(money(entry.overtimeHours * employee.hourlyRate * 1.5), 190, 97, { align: 'right' });
  doc.setFont('helvetica', 'bold');
  doc.text('Salaire brut', 25, 106);
  doc.text(money(entry.grossPay), 190, 106, { align: 'right' });
  line(112);

  doc.text('Déductions', 20, 122);
  doc.setFont('helvetica', 'normal');
  const deductions: Array<[string, number]> = [
    ['Impôt fédéral', entry.deductions * 0.38],
    ['Impôt provincial (Québec)', entry.deductions * 0.34],
    ['RRQ', entry.deductions * 0.13],
    ['Assurance-emploi (AE)', entry.deductions * 0.09],
    ['RQAP', entry.deductions * 0.06],
  ];
  let y = 130;
  deductions.forEach(([label, amount]) => {
    doc.text(label, 25, y);
    doc.text(`- ${money(amount)}`, 190, y, { align: 'right' });
    y += 7;
  });
  doc.setFont('helvetica', 'bold');
  doc.text('Total des déductions', 25, y + 2);
  doc.text(`- ${money(entry.deductions)}`, 190, y + 2, { align: 'right' });
  line(y + 8);

  doc.setFillColor(240, 253, 244);
  doc.rect(20, y + 14, 170, 14, 'F');
  doc.setFontSize(12);
  doc.setTextColor(5, 150, 105);
  doc.text('SALAIRE NET', 25, y + 23);
  doc.text(money(entry.netPay), 185, y + 23, { align: 'right' });

  doc.setTextColor(15, 23, 42);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text(`Cumulatifs annuels (${entry.periodStart.slice(0, 4)})`, 20, y + 42);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const cumuls: Array<[string, string]> = [
    ['Heures cumulées', `${ytdHours} h`],
    ['Salaire brut cumulé', money(ytdGross)],
    ['Déductions cumulées', money(ytdDeductions)],
    ['Salaire net cumulé', money(ytdNet)],
  ];
  let cy = y + 50;
  cumuls.forEach(([label, value]) => {
    doc.text(label, 25, cy);
    doc.text(value, 190, cy, { align: 'right' });
    cy += 7;
  });
  line(cy);

  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.setFont('helvetica', 'normal');
  doc.text(`Document généré par Arrière Plan. Cumulatifs calculés sur ${ytd.length} période(s) de paie. Déductions réparties à titre indicatif.`, 20, cy + 8);

  doc.save(`releve-paie-${employee.lastName.toLowerCase()}-${entry.period.replace(/\s+/g, '-').toLowerCase()}.pdf`);
};
