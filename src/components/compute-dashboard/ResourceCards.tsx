import {
  Monitor,
  Cpu,
  MemoryStick,
  Thermometer,
  Zap,
} from 'lucide-react';
import type { GpuInfo, CpuInfo, MonitorData } from './types';

export function UtilBar({ percent, color }: { percent: number; color: string }) {
  return (
    <div className="w-full h-2 rounded-full bg-muted/60 overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-500 ${color}`}
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
    </div>
  );
}

export function utilColor(percent: number): string {
  if (percent < 40) return 'bg-emerald-500';
  if (percent < 70) return 'bg-amber-500';
  return 'bg-red-500';
}

export function utilTextColor(percent: number): string {
  if (percent < 40) return 'text-emerald-600 dark:text-emerald-400';
  if (percent < 70) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

export function formatMB(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb} MB`;
}

export function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-full font-medium ${
        active
          ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
          : 'bg-muted text-muted-foreground'
      }`}
    >
      {active ? 'In Use' : 'Idle'}
    </span>
  );
}

export function GpuCard({ gpu }: { gpu: GpuInfo }) {
  const inUse = gpu.gpuUtil > 5 || gpu.memUtil > 5;

  return (
    <div className="rounded-xl border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Monitor className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">GPU {gpu.index}</span>
        </div>
        <StatusBadge active={inUse} />
      </div>

      <p className="text-xs text-muted-foreground truncate">{gpu.name}</p>

      <div className="space-y-2">
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted-foreground">GPU Utilization</span>
            <span className={`text-xs font-semibold ${utilTextColor(gpu.gpuUtil)}`}>
              {gpu.gpuUtil}%
            </span>
          </div>
          <UtilBar percent={gpu.gpuUtil} color={utilColor(gpu.gpuUtil)} />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted-foreground">VRAM</span>
            <span className="text-xs text-muted-foreground">
              {formatMB(gpu.memUsedMB)} / {formatMB(gpu.memTotalMB)}
            </span>
          </div>
          <UtilBar percent={gpu.memUtil} color={utilColor(gpu.memUtil)} />
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs text-muted-foreground pt-1">
        <span className="flex items-center gap-1">
          <Thermometer className="h-3 w-3" />
          {gpu.tempC}°C
        </span>
        <span className="flex items-center gap-1">
          <Zap className="h-3 w-3" />
          {gpu.powerW > 0 ? `${gpu.powerW} W` : 'N/A'}
        </span>
      </div>
    </div>
  );
}

export function CpuCard({ cpu }: { cpu: CpuInfo }) {
  const inUse = cpu.utilPercent > 10;

  return (
    <div className="rounded-xl border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Cpu className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">CPU</span>
          <span className="text-xs text-muted-foreground">({cpu.cores} cores)</span>
        </div>
        <StatusBadge active={inUse} />
      </div>

      {cpu.model && (
        <p className="text-xs text-muted-foreground truncate">{cpu.model}</p>
      )}

      <div className="space-y-2">
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted-foreground">CPU Load</span>
            <span className={`text-xs font-semibold ${utilTextColor(cpu.utilPercent)}`}>
              {cpu.utilPercent}%
            </span>
          </div>
          <UtilBar percent={cpu.utilPercent} color={utilColor(cpu.utilPercent)} />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <MemoryStick className="h-3 w-3" />
              System Memory
            </span>
            <span className="text-xs text-muted-foreground">
              {formatMB(cpu.memUsedMB)} / {formatMB(cpu.memTotalMB)}
            </span>
          </div>
          <UtilBar percent={cpu.memUtilPercent} color={utilColor(cpu.memUtilPercent)} />
        </div>
      </div>

      <div className="text-xs text-muted-foreground pt-1">
        Load average: {cpu.loadAvg.toFixed(2)}
      </div>
    </div>
  );
}

export function ResourceCards({ monitor }: { monitor: MonitorData }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
      {monitor.cpu && <CpuCard cpu={monitor.cpu} />}
      {monitor.gpus.map((gpu) => (
        <GpuCard key={gpu.index} gpu={gpu} />
      ))}
    </div>
  );
}

export function SummaryCard({
  label,
  value,
  sublabel,
}: {
  label: string;
  value: string | number;
  sublabel?: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className="text-xl font-bold">
        {value}
        {sublabel && (
          <span className="text-xs font-normal text-muted-foreground ml-1">{sublabel}</span>
        )}
      </p>
    </div>
  );
}
