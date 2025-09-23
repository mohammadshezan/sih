"use client";
import * as React from "react";

export function Dialog({ open, onOpenChange, children }: { open: boolean; onOpenChange: (open: boolean) => void; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => onOpenChange(false)}>
      <div className="bg-white rounded-lg shadow-xl min-w-[300px] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export function DialogContent({ className = "", children }: React.PropsWithChildren<{ className?: string }>) {
  return <div className={`p-4 ${className}`}>{children}</div>;
}

export function DialogHeader({ children }: React.PropsWithChildren) {
  return <div className="mb-2">{children}</div>;
}

export function DialogTitle({ children }: React.PropsWithChildren) {
  return <h3 className="text-lg font-semibold">{children}</h3>;
}

export const DialogTrigger = ({ children }: React.PropsWithChildren) => <>{children}</>;
