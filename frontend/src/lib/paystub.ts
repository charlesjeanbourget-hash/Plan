import { jsPDF } from 'jspdf';
import { Employee, PayrollEntry } from '@/types';

const money = (n: number): string =>
  n.toLocaleString('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' $';

export const downloadPayStub = (employee: Employee, entry: PayrollEntry, pharmacyName: string): void => {
  const doc = new jsPDF();
  const line = (y: number): void => {
    doc.setDrawColor(226, 232, 240);
    doc.line(20, y, 190, y);
  };

  doc.setFillColor(5, 150, 105);
  doc.rect(0, 0, 210, 28, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('LuminaHR — Relevé de paie', 20, 18);

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

  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.setFont('helvetica', 'normal');
  doc.text('Document généré par LuminaHR. Les montants de déductions sont répartis à titre indicatif.', 20, y + 40);

  doc.save(`releve-paie-${employee.lastName.toLowerCase()}-${entry.period.replace(/\s+/g, '-').toLowerCase()}.pdf`);
};
