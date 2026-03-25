import { parsePrescription, formatPrescription, parseFreeTextPrescription, formatFreeTextPrescription } from '../lib/prescriptionParser';

interface PrescriptionDisplayProps {
  prescription: string | null;
  unit: string | null;
  useStackedNotation: boolean;
}

export function PrescriptionDisplay({ prescription, unit, useStackedNotation }: PrescriptionDisplayProps) {
  if (!prescription || prescription.trim() === '') {
    return <span className="text-gray-500 italic">No prescription</span>;
  }

  if (unit === 'free_text' || unit === 'rpe') {
    const parsed = parseFreeTextPrescription(prescription);
    if (parsed.length === 0) {
      return <span>{prescription}</span>;
    }
    return <span>{formatFreeTextPrescription(parsed)}</span>;
  }

  const shouldUseStacked = useStackedNotation && (unit === 'absolute_kg' || unit === 'percentage');

  if (!shouldUseStacked) {
    const parsed = parsePrescription(prescription);
    if (parsed.length === 0) {
      return <span>{prescription}</span>;
    }
    return <span>{formatPrescription(parsed, unit)}</span>;
  }

  const parsed = parsePrescription(prescription);
  if (parsed.length === 0) {
    return <span>{prescription}</span>;
  }

  const getUnitSymbol = () => {
    if (unit === 'percentage') return '%';
    if (unit === 'rpe') return 'RPE';
    return '';
  };

  const unitSymbol = getUnitSymbol();

  return (
    <div className="flex flex-wrap gap-6">
      {parsed.map((line, index) => (
        <div key={index} className="flex items-center gap-2">
          <div className="inline-flex flex-col items-center">
            <div className="text-center font-semibold text-gray-900">
              {line.load}{unitSymbol}
            </div>
            <div className="border-t border-gray-400 w-full my-0.5"></div>
            <div className="text-center font-semibold text-gray-900">
              {line.reps}
            </div>
          </div>
          {line.sets > 1 && (
            <div className="flex items-center justify-center font-bold text-gray-900">
              {line.sets}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
