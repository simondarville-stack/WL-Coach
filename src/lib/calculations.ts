// Pure calculation functions — no React dependencies

export function calculateAge(birthdate: string | null): number | null {
  if (!birthdate) return null;
  const today = new Date();
  const birth = new Date(birthdate);
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

export function getRawColor(avg: number | null): string {
  if (avg === null) return 'text-gray-400';
  if (avg >= 10) return 'text-green-600';
  if (avg >= 7) return 'text-yellow-600';
  return 'text-red-600';
}

export function getRawBgColor(avg: number | null): string {
  if (avg === null) return 'bg-gray-100';
  if (avg >= 10) return 'bg-green-100';
  if (avg >= 7) return 'bg-yellow-100';
  return 'bg-red-100';
}

export function getRelativeTime(date: Date | null): string {
  if (!date) return 'Never';
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 14) return '1 week ago';
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  return `${Math.floor(diffDays / 30)} months ago`;
}

export function needsAttentionCheck(lastTrainingDate: Date | null): boolean {
  if (!lastTrainingDate) return true;
  const daysSince = Math.floor(
    (new Date().getTime() - lastTrainingDate.getTime()) / (1000 * 60 * 60 * 24)
  );
  return daysSince > 7;
}

export function computeRawAverage(rawTotals: (number | null)[]): number | null {
  const valid = rawTotals.filter((r): r is number => r !== null);
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}
