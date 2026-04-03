import { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface RestTimerProps {
  defaultSeconds: number;
  onDismiss: () => void;
  onComplete: () => void;
}

export function RestTimer({ defaultSeconds, onDismiss, onComplete }: RestTimerProps) {
  const [remaining, setRemaining] = useState(defaultSeconds);
  const [total] = useState(defaultSeconds);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setRemaining(prev => {
        if (prev <= 1) {
          clearInterval(intervalRef.current!);
          onComplete();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [onComplete]);

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  // SVG circle progress
  const size = 120;
  const strokeWidth = 8;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = remaining / total;
  const dashOffset = circumference * (1 - progress);

  const adjustTime = (delta: number) => {
    setRemaining(prev => Math.max(0, prev + delta));
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg p-4 z-50">
      <div className="max-w-sm mx-auto">
        <div className="flex items-center gap-6">
          {/* SVG countdown circle */}
          <div className="relative flex-shrink-0">
            <svg width={size} height={size}>
              {/* Background circle */}
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke="#e5e7eb"
                strokeWidth={strokeWidth}
              />
              {/* Progress circle */}
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke="#3b82f6"
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
                style={{ transition: 'stroke-dashoffset 1s linear' }}
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-xl font-medium text-gray-900 tabular-nums">{timeStr}</span>
            </div>
          </div>

          {/* Controls */}
          <div className="flex-1 space-y-3">
            <div className="text-sm font-medium text-gray-700">Rest</div>
            <div className="flex gap-2">
              <button
                onClick={() => adjustTime(-30)}
                className="flex-1 min-h-[44px] px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition-colors"
              >
                −30s
              </button>
              <button
                onClick={() => adjustTime(30)}
                className="flex-1 min-h-[44px] px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition-colors"
              >
                +30s
              </button>
            </div>
            <button
              onClick={onDismiss}
              className="w-full min-h-[44px] px-3 py-2 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Skip rest
            </button>
          </div>

          {/* Close */}
          <button
            onClick={onDismiss}
            className="self-start p-1.5 text-gray-400 hover:text-gray-600 rounded flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
