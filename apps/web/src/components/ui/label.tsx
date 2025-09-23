"use client";
import * as React from "react";

export function Label({ className = "", children }: React.PropsWithChildren<{ className?: string }>) {
  return <label className={`block text-sm font-medium text-gray-700 mb-1 ${className}`}>{children}</label>;
}
