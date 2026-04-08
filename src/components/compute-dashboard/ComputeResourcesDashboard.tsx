import { useState, useEffect, useCallback, useRef } from 'react';
import {
  RefreshCw,
  Laptop,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Plus,
  Server,
} from 'lucide-react';
import { Button } from '../ui/button';
import { api } from '../../utils/api';
import { ResourceCards, SummaryCard } from './ResourceCards';
import NodeCard from './NodeCard';
import NodeForm from './NodeForm';
import type { LocalMonitorData, MonitorData, ComputeNode, NodeWithMonitor } from './types';

const POLL_INTERVAL_MS = 15_000;

export default function ComputeResourcesDashboard() {
  // ─── State ───
  const [localData, setLocalData] = useState<LocalMonitorData | null>(null);
  const [localLoading, setLocalLoading] = useState(true);
  const [nodesData, setNodesData] = useState<NodeWithMonitor[]>([]);
  const [connectedNodeIds, setConnectedNodeIds] = useState<Set<string>>(new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── Data fetchers ───

  const fetchLocalMonitor = useCallback(async () => {
    try {
      const resp = await api.compute.monitorLocal();
      return (await resp.json()) as LocalMonitorData;
    } catch {
      return { success: false, gpus: [], cpu: null, error: 'Network error', timestamp: Date.now() } as LocalMonitorData;
    }
  }, []);

  const fetchNodes = useCallback(async () => {
    try {
      const resp = await api.compute.getNodes();
      const data = (await resp.json()) as { nodes: ComputeNode[]; activeNodeId?: string };
      return { nodes: data.nodes || [], activeNodeId: data.activeNodeId };
    } catch {
      return { nodes: [], activeNodeId: undefined };
    }
  }, []);

  const monitorNode = useCallback(async (nodeId: string): Promise<MonitorData> => {
    try {
      const resp = await api.compute.monitorNode(nodeId);
      return (await resp.json()) as MonitorData;
    } catch {
      return { success: false, gpus: [], cpu: null, error: 'Network error', timestamp: Date.now() };
    }
  }, []);

  // ─── Initial load (no auto-connect) ───

  const loadInitial = useCallback(async () => {
    setLocalLoading(true);
    const [localResult, { nodes, activeNodeId }] = await Promise.all([
      fetchLocalMonitor(),
      fetchNodes(),
    ]);
    setLocalData(localResult);
    setLocalLoading(false);
    setNodesData(
      nodes.map((node) => ({
        node,
        monitor: null,
        loading: false,
        isActive: node.id === activeNodeId,
      })),
    );
    setInitialLoad(false);
  }, [fetchLocalMonitor, fetchNodes]);

  // ─── Poll only connected nodes + local ───

  const pollConnected = useCallback(async () => {
    const localResult = await fetchLocalMonitor();
    setLocalData(localResult);

    if (connectedNodeIds.size > 0) {
      const results = await Promise.allSettled(
        Array.from(connectedNodeIds).map(async (nodeId) => {
          const monitor = await monitorNode(nodeId);
          return { nodeId, monitor };
        }),
      );
      setNodesData((prev) =>
        prev.map((item) => {
          const result = results.find(
            (r) => r.status === 'fulfilled' && r.value.nodeId === item.node.id,
          );
          if (result?.status === 'fulfilled') {
            return { ...item, monitor: result.value.monitor, loading: false };
          }
          return item;
        }),
      );
    }
  }, [connectedNodeIds, fetchLocalMonitor, monitorNode]);

  // ─── Connect / Disconnect ───

  const connectNode = useCallback(
    async (nodeId: string) => {
      setConnectedNodeIds((prev) => new Set(prev).add(nodeId));
      setNodesData((prev) =>
        prev.map((item) =>
          item.node.id === nodeId ? { ...item, loading: true } : item,
        ),
      );
      const monitor = await monitorNode(nodeId);
      setNodesData((prev) =>
        prev.map((item) =>
          item.node.id === nodeId ? { ...item, monitor, loading: false } : item,
        ),
      );
    },
    [monitorNode],
  );

  const disconnectNode = useCallback((nodeId: string) => {
    setConnectedNodeIds((prev) => {
      const next = new Set(prev);
      next.delete(nodeId);
      return next;
    });
    setNodesData((prev) =>
      prev.map((item) =>
        item.node.id === nodeId ? { ...item, monitor: null, loading: false } : item,
      ),
    );
  }, []);

  // ─── Node CRUD ───

  const reloadNodes = useCallback(async () => {
    const { nodes, activeNodeId } = await fetchNodes();
    setNodesData((prev) =>
      nodes.map((node) => {
        const existing = prev.find((d) => d.node.id === node.id);
        return {
          node,
          monitor: connectedNodeIds.has(node.id) ? (existing?.monitor ?? null) : null,
          loading: false,
          isActive: node.id === activeNodeId,
        };
      }),
    );
  }, [fetchNodes, connectedNodeIds]);

  const handleSetActive = useCallback(
    async (nodeId: string) => {
      await api.compute.setActive(nodeId);
      await reloadNodes();
    },
    [reloadNodes],
  );

  const handleDeleteNode = useCallback(
    async (nodeId: string) => {
      try {
        await api.compute.deleteNode(nodeId);
      } catch {
        // ignore
      }
      setConnectedNodeIds((prev) => {
        const next = new Set(prev);
        next.delete(nodeId);
        return next;
      });
      setNodesData((prev) => prev.filter((item) => item.node.id !== nodeId));
    },
    [],
  );

  // ─── Refresh (manual) ───

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    setLocalLoading(true);
    try {
      const localResult = await fetchLocalMonitor();
      setLocalData(localResult);
      setLocalLoading(false);
      await reloadNodes();
      // Re-poll connected nodes
      if (connectedNodeIds.size > 0) {
        const results = await Promise.allSettled(
          Array.from(connectedNodeIds).map(async (id) => {
            const monitor = await monitorNode(id);
            return { nodeId: id, monitor };
          }),
        );
        setNodesData((prev) =>
          prev.map((item) => {
            const result = results.find(
              (r) => r.status === 'fulfilled' && r.value.nodeId === item.node.id,
            );
            if (result?.status === 'fulfilled') {
              return { ...item, monitor: result.value.monitor };
            }
            return item;
          }),
        );
      }
    } finally {
      setIsRefreshing(false);
    }
  }, [connectedNodeIds, fetchLocalMonitor, monitorNode, reloadNodes]);

  // ─── Effects ───

  const loadInitialRef = useRef(loadInitial);
  loadInitialRef.current = loadInitial;

  useEffect(() => {
    void loadInitialRef.current();
  }, []);

  const pollConnectedRef = useRef(pollConnected);
  pollConnectedRef.current = pollConnected;

  useEffect(() => {
    if (initialLoad) return;
    pollRef.current = setInterval(() => {
      void pollConnectedRef.current();
    }, POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [connectedNodeIds, initialLoad]);

  // ─── Aggregated stats ───

  const allMonitors = [
    localData,
    ...nodesData.filter((d) => connectedNodeIds.has(d.node.id)).map((d) => d.monitor),
  ].filter((m): m is MonitorData => !!m && m.success);

  const totalGpus = allMonitors.reduce((n, m) => n + m.gpus.length, 0);
  const activeGpus = allMonitors.reduce(
    (n, m) => n + m.gpus.filter((g) => g.gpuUtil > 5 || g.memUtil > 5).length,
    0,
  );
  const totalCpuCores = allMonitors.reduce((n, m) => n + (m.cpu?.cores ?? 0), 0);
  const cpuMonitors = allMonitors.filter((m) => m.cpu);
  const avgCpuUtil =
    cpuMonitors.length > 0
      ? Math.round(cpuMonitors.reduce((s, m) => s + m.cpu!.utilPercent, 0) / cpuMonitors.length)
      : 0;

  const connectedCount = connectedNodeIds.size;

  // ─── Render ───

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Compute Resources</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Monitor GPU and CPU usage across your compute nodes
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl"
              onClick={() => setShowAddForm(true)}
              disabled={showAddForm}
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Add Node
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl"
              onClick={() => void handleRefresh()}
              disabled={isRefreshing}
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>

        {initialLoad ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Loading compute resources...
          </div>
        ) : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <SummaryCard
                label="Nodes"
                value={1 + nodesData.length}
                sublabel={
                  nodesData.length > 0
                    ? `(1 local + ${nodesData.length} remote${connectedCount > 0 ? `, ${connectedCount} connected` : ''})`
                    : '(local)'
                }
              />
              <SummaryCard
                label="GPUs"
                value={totalGpus > 0 ? `${activeGpus} / ${totalGpus}` : '0'}
                sublabel={totalGpus > 0 ? 'in use' : 'detected'}
              />
              <SummaryCard label="CPU Cores" value={totalCpuCores} />
              <SummaryCard label="Avg CPU Load" value={`${avgCpuUtil}%`} />
            </div>

            {/* Local machine */}
            <div className="space-y-4">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <Laptop className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-base font-semibold">
                    {localData?.hostname || 'Local Machine'}
                  </h3>
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 font-medium">
                  This Machine
                </span>
                {localData?.platform && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                    {localData.platform === 'darwin' ? 'macOS' : localData.platform === 'win32' ? 'Windows' : 'Linux'}
                  </span>
                )}
                {localLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
              </div>

              {localData && !localData.success && (
                <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">
                  <AlertCircle className="h-4 w-4 flex-shrink-0" />
                  <span>{localData.error || 'Failed to read local stats'}</span>
                </div>
              )}

              {localData?.success && (localData.cpu || localData.gpus.length > 0) && (
                <ResourceCards monitor={localData} />
              )}

              {localData?.success && !localData.cpu && localData.gpus.length === 0 && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/40 rounded-lg px-3 py-2">
                  <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                  <span>No GPU detected on this machine</span>
                </div>
              )}
            </div>

            {/* Remote nodes */}
            <div className="border-t pt-4">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
                Remote Nodes
                {nodesData.length > 0 && (
                  <span className="font-normal ml-2">
                    ({connectedCount} of {nodesData.length} connected)
                  </span>
                )}
              </h2>
            </div>

            {/* Add node form */}
            {showAddForm && (
              <NodeForm
                onSave={() => { setShowAddForm(false); void reloadNodes(); }}
                onCancel={() => setShowAddForm(false)}
              />
            )}

            {/* Node cards */}
            {nodesData.length > 0 ? (
              <div className="space-y-4">
                {nodesData.map((data) => (
                  <NodeCard
                    key={data.node.id}
                    data={data}
                    isConnected={connectedNodeIds.has(data.node.id)}
                    onConnect={() => void connectNode(data.node.id)}
                    onDisconnect={() => disconnectNode(data.node.id)}
                    onDelete={() => void handleDeleteNode(data.node.id)}
                    onNodeUpdated={() => void reloadNodes()}
                    onSetActive={() => void handleSetActive(data.node.id)}
                  />
                ))}
              </div>
            ) : (
              !showAddForm && (
                <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                  <Server className="h-8 w-8 mb-3 opacity-40" />
                  <p className="text-sm">No remote nodes configured</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-xl mt-3"
                    onClick={() => setShowAddForm(true)}
                  >
                    <Plus className="h-3.5 w-3.5 mr-1.5" />
                    Add your first node
                  </Button>
                </div>
              )
            )}

            {/* Timestamp */}
            {connectedCount > 0 && (
              <p className="text-xs text-muted-foreground text-center pt-2">
                Auto-refreshes every {POLL_INTERVAL_MS / 1000}s for connected nodes
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
