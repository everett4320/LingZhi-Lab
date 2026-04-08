#!/usr/bin/env node

/**
 * Compute Tools MCP Server
 *
 * Exposes compute node operations (run, sync, slurm) as MCP tools
 * that the AI agent can use during a chat session.
 *
 * Launched as a child process by the Claude Agent SDK via mcpServers config.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { ComputeNode, getActiveNode } from './compute-node.js';

const server = new Server(
  { name: 'compute-tools', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

// ─── Tool definitions ───

const TOOLS = [
  {
    name: 'compute_info',
    description:
      'Get information about the active remote compute node, including hostname, type, and GPU status. Use this first to check what compute resources are available.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'compute_run',
    description:
      'Run a shell command on the active remote compute node via SSH. Use this for GPU tasks, training scripts, or any command that should execute on the remote server instead of locally.',
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute on the remote node',
        },
        cwd: {
          type: 'string',
          description:
            'Local working directory. If provided and skipSync is false, code will be synced to the remote node before execution.',
        },
        skipSync: {
          type: 'boolean',
          description:
            'If true, skip syncing code before running. Default: true. Set to false if you need to sync local code first.',
          default: true,
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'compute_sync',
    description:
      'Sync project code between the local machine and the active remote compute node. Use "up" to push local code to remote, "down" to pull results back.',
    inputSchema: {
      type: 'object',
      properties: {
        direction: {
          type: 'string',
          enum: ['up', 'down'],
          description: '"up" = push local→remote, "down" = pull remote→local',
        },
        cwd: {
          type: 'string',
          description: 'Local project directory to sync',
        },
        files: {
          type: 'array',
          items: { type: 'string' },
          description:
            'For "down" direction: specific file patterns to pull (e.g., ["logs/", "checkpoints/"]). Defaults to logs/, checkpoints/, results/.',
        },
      },
      required: ['direction', 'cwd'],
    },
  },
  {
    name: 'compute_slurm_submit',
    description:
      'Submit a Slurm batch job on the active compute node. Provide a full sbatch script including #SBATCH directives. Only works on Slurm HPC nodes.',
    inputSchema: {
      type: 'object',
      properties: {
        script: {
          type: 'string',
          description:
            'Full sbatch script content including #!/bin/bash and #SBATCH directives',
        },
      },
      required: ['script'],
    },
  },
  {
    name: 'compute_slurm_queue',
    description:
      'List current Slurm jobs on the active compute node. Shows job ID, name, state, and elapsed time. Only works on Slurm HPC nodes.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

// ─── Tool handlers ───

async function requireActiveNode() {
  const node = await getActiveNode();
  if (!node) {
    throw new Error(
      'No active compute node configured. Please set one in the Compute Dashboard (click "Set as Active" on a node).',
    );
  }
  return node;
}

async function handleTool(name, args) {
  switch (name) {
    case 'compute_info': {
      const node = await requireActiveNode();
      let gpuInfo = 'Unknown';
      try {
        gpuInfo = await ComputeNode.run({
          nodeId: node.id,
          command: 'nvidia-smi --query-gpu=name,memory.total,utilization.gpu --format=csv,noheader 2>/dev/null || echo "No GPU detected"',
          skipSync: true,
        });
      } catch {
        gpuInfo = 'Could not query GPU (connection error)';
      }
      return [
        `Active Compute Node: ${node.name}`,
        `Host: ${node.user}@${node.host}${node.port && node.port !== 22 ? ':' + node.port : ''}`,
        `Type: ${node.type === 'slurm' ? 'Slurm HPC cluster' : 'Direct GPU server'}`,
        `Work Directory: ${node.workDir || '~'}`,
        `GPU Info:\n${gpuInfo}`,
      ].join('\n');
    }

    case 'compute_run': {
      const node = await requireActiveNode();
      const output = await ComputeNode.run({
        nodeId: node.id,
        command: args.command,
        cwd: args.cwd || undefined,
        skipSync: args.skipSync !== false,
      });
      return output || '(no output)';
    }

    case 'compute_sync': {
      const node = await requireActiveNode();
      const output = await ComputeNode.sync({
        nodeId: node.id,
        direction: args.direction,
        cwd: args.cwd,
        files: args.files || [],
      });
      return output || `Sync ${args.direction} completed successfully.`;
    }

    case 'compute_slurm_submit': {
      const node = await requireActiveNode();
      const output = await ComputeNode.sbatch({
        nodeId: node.id,
        rawScript: args.script,
      });
      return output || 'Job submitted.';
    }

    case 'compute_slurm_queue': {
      const node = await requireActiveNode();
      const jobs = await ComputeNode.squeue({ nodeId: node.id });
      if (jobs.length === 0) return 'No active jobs.';
      const header = 'JobID\tName\tPartition\tState\tElapsed\tTime Limit';
      const rows = jobs.map(
        (j) => `${j.jobId}\t${j.name}\t${j.partition}\t${j.state}\t${j.elapsed}\t${j.timeLimit}`,
      );
      return [header, ...rows].join('\n');
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── MCP protocol handlers ───

server.setRequestHandler(
  ListToolsRequestSchema,
  async () => ({ tools: TOOLS }),
);

server.setRequestHandler(
  CallToolRequestSchema,
  async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const result = await handleTool(name, args || {});
      return {
        content: [{ type: 'text', text: result }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  },
);

// ─── Start server ───

const transport = new StdioServerTransport();
await server.connect(transport);
