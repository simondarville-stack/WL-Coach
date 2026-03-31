import { ReactNode } from 'react';

interface ModalShellProps {
  children: ReactNode;
  maxWidth?: string;
}

export function ModalShell({ children, maxWidth = 'max-w-lg' }: ModalShellProps) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className={`bg-white rounded-lg shadow-xl w-full ${maxWidth}`}>
        {children}
      </div>
    </div>
  );
}
