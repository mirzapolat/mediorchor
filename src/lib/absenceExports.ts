export interface AbsenceExportRow {
  name: string;
  group: string;
  attended: number;
  excused: number;
  absent: number;
}

export interface AbsenceExportLabels {
  title: string;
  name: string;
  group: string;
  attended: string;
  excused: string;
  absent: string;
}

const csvCell = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;

export const createAbsencesCsv = (labels: AbsenceExportLabels, rows: AbsenceExportRow[]) => {
  const records = [
    [labels.name, labels.group, labels.attended, labels.excused, labels.absent],
    ...rows.map((row) => [row.name, row.group, row.attended, row.excused, row.absent]),
  ];
  return `\uFEFF${records.map((record) => record.map(csvCell).join(';')).join('\r\n')}`;
};

const truncateText = (
  text: string,
  maxWidth: number,
  getWidth: (value: string) => number,
) => {
  if (getWidth(text) <= maxWidth) return text;
  let shortened = text;
  while (shortened.length > 1 && getWidth(`${shortened}…`) > maxWidth) {
    shortened = shortened.slice(0, -1);
  }
  return `${shortened}…`;
};

export const createAbsencesPdf = async (
  labels: AbsenceExportLabels,
  rows: AbsenceExportRow[],
): Promise<Blob> => {
  const { jsPDF } = await import('jspdf');
  const document = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = 210;
  const margin = 14;
  const rowHeight = 7;
  const columns = [
    { label: labels.name, x: margin, width: 73 },
    { label: labels.group, x: 90, width: 40 },
    { label: labels.attended, x: 136, width: 17 },
    { label: labels.excused, x: 158, width: 18 },
    { label: labels.absent, x: 181, width: 15 },
  ];

  const drawHeader = (pageNumber: number) => {
    document.setTextColor(26, 26, 26);
    document.setFont('helvetica', 'bold');
    document.setFontSize(16);
    document.text(labels.title, margin, 16);
    document.setFontSize(8);
    document.setTextColor(107, 107, 107);
    document.text(String(pageNumber), pageWidth - margin, 16, { align: 'right' });
    document.setFillColor(245, 245, 245);
    document.rect(margin, 23, pageWidth - margin * 2, rowHeight, 'F');
    document.setFont('helvetica', 'bold');
    document.setFontSize(8);
    document.setTextColor(80, 80, 80);
    for (const column of columns) document.text(column.label, column.x, 27.7);
  };

  let pageNumber = 1;
  let y = 30;
  drawHeader(pageNumber);
  document.setFont('helvetica', 'normal');
  document.setFontSize(9);

  for (const row of rows) {
    if (y + rowHeight > 283) {
      document.addPage();
      pageNumber += 1;
      drawHeader(pageNumber);
      document.setFont('helvetica', 'normal');
      document.setFontSize(9);
      y = 30;
    }

    document.setDrawColor(229, 229, 229);
    document.line(margin, y + rowHeight, pageWidth - margin, y + rowHeight);
    document.setTextColor(26, 26, 26);
    document.text(truncateText(row.name, columns[0].width, (text) => document.getTextWidth(text)), columns[0].x, y + 4.7);
    document.setTextColor(90, 90, 90);
    document.text(truncateText(row.group, columns[1].width, (text) => document.getTextWidth(text)), columns[1].x, y + 4.7);
    document.text(String(row.attended), columns[2].x, y + 4.7);
    document.text(String(row.excused), columns[3].x, y + 4.7);
    document.text(String(row.absent), columns[4].x, y + 4.7);
    y += rowHeight;
  }

  return document.output('blob');
};

export const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};
