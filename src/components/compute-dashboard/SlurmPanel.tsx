import { useState, useEffect, useCallback } from 'react';
import { Layers, RefreshCw, Play, Upload, X, Clock, Loader2, CheckCircle, XCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { api } from '../../utils/api';
import type { ComputeNode } from './types';

type SlurmJob = {
  jobId: string;
  name: string;
  state: string;
  elapsed: string;
};

type SlurmPartition = {
  name: string;
  gres?: string;
};

type ActionResult = {
  success: boolean;
  output?: string;
  error?: string;
  message?: string;
};

function ResultBlock({ result }: { result: ActionResult | null }) {
  if (!result) return null;
  const ok = result.success;
  return (
    <div
      className={`mt-2 p-2.5 rounded-lg text-xs border ${
        ok
          ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
          : 'bg-destructive/10 border-destructive/20 text-destructive'
      }`}
    >
      <div className="flex items-start gap-1.5">
        {ok ? (
          <CheckCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
        ) : (
          <XCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
        )}
        <pre className="whitespace-pre-wrap break-all font-mono flex-1 max-h-40 overflow-y-auto">
          {result.output || result.error || result.message || 'Done'}
        </pre>
      </div>
    </div>
  );
}

function stateColor(state: string): string {
  if (state === 'RUNNING') return 'text-emerald-600 dark:text-emerald-400';
  if (state === 'PENDING') return 'text-amber-600 dark:text-amber-400';
  return 'text-muted-foreground';
}

export default function SlurmPanel({
  node,
  projectPath,
}: {
  node: ComputeNode;
  projectPath?: string;
}) {
  const s = node.slurm || {};
  const [partitions, setPartitions] = useState<SlurmPartition[]>([]);
  const [jobs, setJobs] = useState<SlurmJob[]>([]);
  const [loading, setLoading] = useState({ info: false, queue: false, salloc: false, sbatch: false, cancel: '' });
  const [slurmForm, setSlurmForm] = useState({
    partition: s.defaultPartition || '',
    time: s.defaultTime || '00:30:00',
    gpus: String(s.defaultGpus ?? 1),
    account: s.defaultAccount || '',
    command: '',
    script: `#!/bin/bash
#SBATCH --job-name=lingzhi-lab-job
#SBATCH --partition=${s.defaultPartition || 'GPU-small'}
#SBATCH --time=${s.defaultTime || '00:30:00'}
#SBATCH --gres=gpu:${s.defaultGpus ?? 1}
${s.defaultAccount ? `#SBATCH -A ${s.defaultAccount}` : '# #SBATCH -A your-account'}
#SBATCH --output=lingzhi-lab-job-%j.out
#SBATCH --error=lingzhi-lab-job-%j.err

# Your commands below
cd ${node.workDir || '~'}
echo "Job started on $(hostname)"
# python train.py --epochs 100
`,
  });
  const [result, setResult] = useState<ActionResult | null>(null);
  const [showScript, setShowScript] = useState(false);

  const fetchSinfo = useCallback(async () => {
    setLoading((l) => ({ ...l, info: true }));
    try {
      const res = await api.compute.slurmInfo(node.id);
      const data = await res.json();
      if (data.success) setPartitions(data.partitions || []);
    } catch (err) {
      console.error('sinfo error:', err);
    } finally {
      setLoading((l) => ({ ...l, info: false }));
    }
  }, [node.id]);

  const fetchQueue = useCallback(async () => {
    setLoading((l) => ({ ...l, queue: true }));
    try {
      const res = await api.compute.slurmQueue(node.id);
      const data = await res.json();
      if (data.success) setJobs(data.jobs || []);
    } catch (err) {
      console.error('squeue error:', err);
    } finally {
      setLoading((l) => ({ ...l, queue: false }));
    }
  }, [node.id]);

  useEffect(() => {
    void fetchSinfo();
    void fetchQueue();
  }, [fetchSinfo, fetchQueue]);

  // Auto-refresh queue every 30s
  useEffect(() => {
    const timer = setInterval(() => void fetchQueue(), 30000);
    return () => clearInterval(timer);
  }, [fetchQueue]);

  const handleSalloc = async () => {
    setLoading((l) => ({ ...l, salloc: true }));
    setResult(null);
    try {
      const res = await api.compute.slurmSalloc(node.id, {
        partition: slurmForm.partition || undefined,
        time: slurmForm.time,
        gpus: parseInt(slurmForm.gpus) || 1,
        account: slurmForm.account || undefined,
        command: slurmForm.command || undefined,
      });
      const data = await res.json();
      setResult(data);
      void fetchQueue();
    } catch (err: unknown) {
      setResult({ success: false, error: err instanceof Error ? err.message : 'salloc failed' });
    } finally {
      setLoading((l) => ({ ...l, salloc: false }));
    }
  };

  const handleSbatch = async () => {
    if (!slurmForm.script.trim()) return;
    setLoading((l) => ({ ...l, sbatch: true }));
    setResult(null);
    try {
      const scriptContent = slurmForm.script.trim();
      const res = await api.compute.slurmSbatch(node.id, {
        rawScript: scriptContent,
        script: scriptContent,
      });
      const data = await res.json();
      setResult(data);
      void fetchQueue();
    } catch (err: unknown) {
      setResult({ success: false, error: err instanceof Error ? err.message : 'sbatch failed' });
    } finally {
      setLoading((l) => ({ ...l, sbatch: false }));
    }
  };

  const handleCancel = async (jobId: string) => {
    setLoading((l) => ({ ...l, cancel: jobId }));
    try {
      await api.compute.slurmCancel(node.id, jobId);
      void fetchQueue();
    } catch (err) {
      console.error('scancel error:', err);
    } finally {
      setLoading((l) => ({ ...l, cancel: '' }));
    }
  };

  // Suppress unused variable warning — projectPath reserved for future use in script template
  void projectPath;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold flex items-center gap-1.5">
          <Layers className="w-4 h-4" /> Slurm Jobs
        </h4>
        <Button variant="ghost" size="sm" className="rounded-xl" onClick={() => void fetchQueue()} disabled={loading.queue}>
          <RefreshCw className={`w-3.5 h-3.5 ${loading.queue ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* Resource selector */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Partition</label>
          <select
            className="w-full rounded-xl border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring h-9"
            value={slurmForm.partition}
            onChange={(e) => setSlurmForm({ ...slurmForm, partition: e.target.value })}
          >
            <option value="">Default</option>
            {partitions.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name} ({p.gres || 'CPU'})
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Account</label>
          <Input
            className="rounded-xl h-9"
            value={slurmForm.account}
            onChange={(e) => setSlurmForm({ ...slurmForm, account: e.target.value })}
            placeholder="account"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Time</label>
          <Input
            className="rounded-xl h-9"
            value={slurmForm.time}
            onChange={(e) => setSlurmForm({ ...slurmForm, time: e.target.value })}
            placeholder="00:30:00"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">GPUs</label>
          <Input
            className="rounded-xl h-9"
            type="number"
            min="0"
            max="8"
            value={slurmForm.gpus}
            onChange={(e) => setSlurmForm({ ...slurmForm, gpus: e.target.value })}
          />
        </div>
      </div>

      {/* salloc */}
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Interactive Command (salloc)</label>
        <div className="flex gap-2">
          <Input
            className="rounded-xl h-9"
            placeholder="python train.py (optional)"
            value={slurmForm.command}
            onChange={(e) => setSlurmForm({ ...slurmForm, command: e.target.value })}
          />
          <Button size="sm" className="rounded-xl" onClick={() => void handleSalloc()} disabled={loading.salloc}>
            {loading.salloc ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
          </Button>
        </div>
      </div>

      {/* sbatch */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs text-muted-foreground">Batch Script (sbatch)</label>
          <button
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
            onClick={() => setShowScript(!showScript)}
          >
            {showScript ? 'Hide' : 'Edit & submit script'}
          </button>
        </div>
        {showScript && (
          <>
            <p className="text-xs text-muted-foreground mb-1.5">
              Edit the full sbatch script below, including #SBATCH directives:
            </p>
            <textarea
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-xs font-mono h-52 placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              value={slurmForm.script}
              onChange={(e) => setSlurmForm({ ...slurmForm, script: e.target.value })}
            />
            <Button
              size="sm"
              className="mt-1 w-full rounded-xl"
              onClick={() => void handleSbatch()}
              disabled={loading.sbatch || !slurmForm.script.trim()}
            >
              {loading.sbatch ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : (
                <Upload className="w-3.5 h-3.5 mr-1.5" />
              )}
              Submit Job
            </Button>
          </>
        )}
      </div>

      <ResultBlock result={result} />

      {/* Job queue */}
      {jobs.length > 0 && (
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">Active Jobs ({jobs.length})</label>
          {jobs.map((job) => (
            <div
              key={job.jobId}
              className="flex items-center justify-between p-2 rounded-lg border bg-muted/30 text-xs"
            >
              <div>
                <span className="font-medium">{job.jobId}</span>
                <span className="text-muted-foreground mx-1.5">{job.name}</span>
                <span className={`font-medium ${stateColor(job.state)}`}>{job.state}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {job.elapsed}
                </span>
                <button
                  onClick={() => void handleCancel(job.jobId)}
                  disabled={loading.cancel === job.jobId}
                  className="p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                >
                  {loading.cancel === job.jobId ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <X className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {loading.info && (
        <div className="text-xs text-muted-foreground flex items-center gap-1">
          <Loader2 className="w-3 h-3 animate-spin" /> Loading partition info...
        </div>
      )}
    </div>
  );
}
