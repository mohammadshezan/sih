"use client";
import * as React from "react";

export function Button({
  children,
  className = "",
  variant = "default",
  size = "md",
  disabled,
  onClick
}: React.PropsWithChildren<{
  className?: string;
  variant?: "default" | "outline";
  size?: "sm" | "md";
  disabled?: boolean;
  onClick?: () => void;
}>) {
  const base = "inline-flex items-center justify-center rounded-md border transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none";
  const variants: Record<string, string> = {
    default: "bg-blue-600 text-white hover:bg-blue-700 border-blue-700",
    outline: "bg-white text-gray-900 border-gray-300 hover:bg-gray-50"
  };
  const sizes: Record<string, string> = {
    sm: "h-8 px-2 text-xs",
    md: "h-10 px-4 text-sm"
  };
  return (
    <button className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}
