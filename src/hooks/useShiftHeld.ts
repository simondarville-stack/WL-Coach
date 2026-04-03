import { useState, useEffect } from 'react';

export function useShiftHeld(): boolean {
  const [shiftHeld, setShiftHeld] = useState(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === 'Delete') setShiftHeld(true); };
    const up = (e: KeyboardEvent) => { if (e.key === 'Delete') setShiftHeld(false); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);
  return shiftHeld;
}
