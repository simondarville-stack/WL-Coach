/** Format a Date object as a local YYYY-MM-DD string (timezone-safe). */
export function toLocalISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Add (or subtract) weeks from an ISO date string, returning a local ISO string. */
export function addWeeks(isoDate: string, weeks: number): string {
  const d = new Date(isoDate + 'T00:00:00');
  d.setDate(d.getDate() + weeks * 7);
  return toLocalISO(d);
}

export function formatDateToDDMMYYYY(dateString: string | null | undefined): string {
  if (!dateString) return '';
  const date = new Date(dateString);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

export function formatDateShort(dateString: string): string {
  const date = new Date(dateString);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}`;
}

export function parseDDMMYYYYToISO(ddmmyyyy: string): string {
  const parts = ddmmyyyy.split('/');
  if (parts.length !== 3) return '';
  const [day, month, year] = parts;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

export function formatISOToDateInput(isoString: string | null | undefined): string {
  if (!isoString) return '';
  const date = new Date(isoString);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d;
}

export function formatDateRange(startDateStr: string, numDays: number = 7): string {
  const start = new Date(startDateStr);
  const end = new Date(start);
  end.setDate(start.getDate() + numDays - 1);

  const startDay = String(start.getDate()).padStart(2, '0');
  const startMonth = String(start.getMonth() + 1).padStart(2, '0');
  const startYear = start.getFullYear();

  const endDay = String(end.getDate()).padStart(2, '0');
  const endMonth = String(end.getMonth() + 1).padStart(2, '0');
  const endYear = end.getFullYear();

  if (startYear === endYear && startMonth === endMonth) {
    return `${startDay}-${endDay}/${startMonth}/${startYear}`;
  } else if (startYear === endYear) {
    return `${startDay}/${startMonth} - ${endDay}/${endMonth}/${startYear}`;
  } else {
    return `${startDay}/${startMonth}/${startYear} - ${endDay}/${endMonth}/${endYear}`;
  }
}
