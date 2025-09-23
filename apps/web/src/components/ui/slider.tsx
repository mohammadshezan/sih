"use client";
import * as React from "react";

export function Slider({ value, onValueChange, max = 100, step = 1, className = "" }: { value: number[]; onValueChange: (value: number[]) => void; max?: number; step?: number; className?: string }) {
  const [v, setV] = React.useState(value[0] ?? 0);
  React.useEffect(() => { setV(value[0] ?? 0); }, [value]);
  return (
    <input
      type="range"
      value={v}
      max={max}
      step={step}
      onChange={(e) => { const nv = Number(e.target.value); setV(nv); onValueChange([nv]); }}
      className={`w-full ${className}`}
    />
  );
}
