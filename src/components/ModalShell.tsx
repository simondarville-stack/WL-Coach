import { ReactNode } from 'react';

interface ModalShellProps {
  children: ReactNode;
  maxWidth?: string;
}

export function ModalShell({ children, maxWidth = 'max-w-lg' }: ModalShellProps) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-backdrop-in">
      <div className={`bg-white rounded-lg shadow-xl w-full ${maxWidth} animate-dialog-in`}>
        {children}
      </div>
    </div>
  );
}
