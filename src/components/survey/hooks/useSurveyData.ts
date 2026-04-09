import { useEffect, useState } from 'react';
import { api } from '../../../utils/api';
import type { Project } from '../../../types/app';

type ProjectFileNode = {
  name: string;
  type: 'file' | 'directory';
  path?: string;
  children?: ProjectFileNode[];
};

export type SurveyFileCategory = 'papers' | 'reports' | 'graphs' | 'notes';
export type SurveyPreviewKind = 'pdf' | 'markdown' | 'json' | 'text' | 'html' | 'mermaid' | 'unsupported';

export type SurveyFile = {
  id: string;
  name: string;
  absolutePath: string;
  relativePath: string;
  extension: string;
  category: SurveyFileCategory;
  previewKind: SurveyPreviewKind;
};

export type SurveyTask = {
  id: string | number;
  title: string;
  description: string;
  status: string;
  stage: string;
};

type UseSurveyDataResult = {
  papers: SurveyFile[];
  reports: SurveyFile[];
  graphs: SurveyFile[];
  notes: SurveyFile[];
  tasks: SurveyTask[];
  loading: boolean;
  error: string | null;
  refreshToken: number;
  refresh: () => void;
};

const SURVEY_ROOTS = ['Survey/', 'Research/'];
const SURVEY_REFERENCE_ROOTS = ['Survey/references/', 'Research/references/', 'Ideation/references/'];
const TEXT_EXTENSIONS = new Set(['.md', '.txt', '.yaml', '.yml', '.csv']);
const JSON_EXTENSIONS = new Set(['.json', '.jsonl']);
const HTML_EXTENSIONS = new Set(['.html', '.htm']);
const GRAPH_EXTENSIONS = new Set(['.json', '.jsonl', '.graphml', '.gml', '.cyjs', '.md', '.txt', '.mmd', '.mermaid', '.html', '.htm']);

function toRelativePath(absolutePath: string, projectRoot: string) {
  const normalizedPath = absolutePath.replace(/\\/g, '/').trim();
  const normalizedRoot = projectRoot.replace(/\\/g, '/').replace(/\/+$/, '');

  if (normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return normalizedPath.slice(normalizedRoot.length + 1);
  }

  return normalizedPath.replace(/^\/+/, '');
}

function flattenFiles(nodes: ProjectFileNode[], projectRoot: string): SurveyFile[] {
  const files: SurveyFile[] = [];

  const visit = (items: ProjectFileNode[]) => {
    items.forEach((item) => {
      if (item.type === 'directory' && Array.isArray(item.children)) {
        visit(item.children);
        return;
      }

      if (item.type !== 'file' || !item.path) {
        return;
      }

      const relativePath = toRelativePath(item.path, projectRoot);
      const normalizedRelativePath = relativePath.replace(/\\/g, '/');

      const isSurveyRoot = SURVEY_ROOTS.some((root) => normalizedRelativePath.startsWith(root));
      const isSurveyReferenceRoot = SURVEY_REFERENCE_ROOTS.some((root) => normalizedRelativePath.startsWith(root));

      if (!isSurveyRoot && !isSurveyReferenceRoot) {
        return;
      }

      const extensionMatch = item.name.match(/(\.[^.]+)$/);
      const extension = extensionMatch ? extensionMatch[1].toLowerCase() : '';
      const lowerRelativePath = normalizedRelativePath.toLowerCase();
      const isGraph = GRAPH_EXTENSIONS.has(extension)
        && /(graph|network|citation|knowledge-map|literature-map|relations|mermaid)/.test(lowerRelativePath);
      const isReferenceFolder = /\/references?\//.test(lowerRelativePath);
      const isReportFolder = /\/reports?\//.test(lowerRelativePath);

      let category: SurveyFileCategory = 'notes';
      if (isGraph) {
        category = 'graphs';
      } else if (extension === '.pdf' && (isReferenceFolder || isSurveyRoot || isSurveyReferenceRoot)) {
        category = 'papers';
      } else if (isReportFolder) {
        category = 'reports';
      } else if (JSON_EXTENSIONS.has(extension) || TEXT_EXTENSIONS.has(extension) || HTML_EXTENSIONS.has(extension) || extension === '.pdf') {
        category = 'notes';
      } else {
        return;
      }

      let previewKind: SurveyPreviewKind = 'unsupported';
      if (extension === '.pdf') {
        previewKind = 'pdf';
      } else if (HTML_EXTENSIONS.has(extension)) {
        previewKind = 'html';
      } else if (extension === '.mmd' || extension === '.mermaid') {
        previewKind = 'mermaid';
      } else if (extension === '.md') {
        previewKind = 'markdown';
      } else if (JSON_EXTENSIONS.has(extension) || extension === '.graphml' || extension === '.gml' || extension === '.cyjs') {
        previewKind = 'json';
      } else if (TEXT_EXTENSIONS.has(extension)) {
        previewKind = 'text';
      }

      files.push({
        id: normalizedRelativePath,
        name: item.name,
        absolutePath: item.path,
        relativePath: normalizedRelativePath,
        extension,
        category,
        previewKind,
      });
    });
  };

  visit(nodes);

  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function normalizeTask(rawTask: Record<string, unknown>): SurveyTask | null {
  const rawStage = String(rawTask.stage ?? rawTask.section ?? rawTask.phase ?? '').trim().toLowerCase();
  const title = String(rawTask.title ?? rawTask.name ?? '').trim();
  const description = String(rawTask.description ?? rawTask.details ?? '').trim();
  const status = String(rawTask.status ?? 'pending').trim();
  const inferredStage = rawStage
    || (/(survey|literature|reference|paper review|prior work)/i.test(`${title} ${description}`) ? 'survey' : '');

  if (!title || inferredStage !== 'survey') {
    return null;
  }

  return {
    id: String(rawTask.id ?? title),
    title,
    description,
    status,
    stage: inferredStage,
  };
}

export function useSurveyData(selectedProject: Project | null): UseSurveyDataResult {
  const [papers, setPapers] = useState<SurveyFile[]>([]);
  const [reports, setReports] = useState<SurveyFile[]>([]);
  const [graphs, setGraphs] = useState<SurveyFile[]>([]);
  const [notes, setNotes] = useState<SurveyFile[]>([]);
  const [tasks, setTasks] = useState<SurveyTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    const projectName = selectedProject?.name;
    const projectRoot = selectedProject?.path || selectedProject?.fullPath;

    if (!projectName || !projectRoot) {
      setPapers([]);
      setReports([]);
      setGraphs([]);
      setNotes([]);
      setTasks([]);
      setLoading(false);
      setError(null);
      return;
    }

    const abortController = new AbortController();

    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        const [filesResponse, tasksResponse] = await Promise.all([
          api.getFiles(projectName, { maxDepth: 10, signal: abortController.signal }),
          api.get(`/taskmaster/tasks/${encodeURIComponent(projectName)}`),
        ]);

        if (!filesResponse.ok) {
          throw new Error(`files:${filesResponse.status}`);
        }

        const projectTree = (await filesResponse.json()) as ProjectFileNode[];
        const surveyFiles = flattenFiles(projectTree, projectRoot);

        setPapers(surveyFiles.filter((file) => file.category === 'papers'));
        setReports(surveyFiles.filter((file) => file.category === 'reports'));
        setGraphs(surveyFiles.filter((file) => file.category === 'graphs'));
        setNotes(surveyFiles.filter((file) => file.category === 'notes'));

        if (tasksResponse.ok) {
          const taskPayload = await tasksResponse.json();
          const surveyTasks = Array.isArray(taskPayload?.tasks)
            ? taskPayload.tasks
                .map((task: Record<string, unknown>) => normalizeTask(task))
                .filter(Boolean) as SurveyTask[]
            : [];
          setTasks(surveyTasks);
        } else {
          setTasks([]);
        }
      } catch (loadError) {
        if ((loadError as { name?: string }).name === 'AbortError') {
          return;
        }

        console.error('Failed to load survey data:', loadError);
        setError('load-failed');
        setPapers([]);
        setReports([]);
        setGraphs([]);
        setNotes([]);
        setTasks([]);
      } finally {
        setLoading(false);
      }
    };

    void load();

    return () => {
      abortController.abort();
    };
  }, [refreshToken, selectedProject?.fullPath, selectedProject?.name, selectedProject?.path]);

  return {
    papers,
    reports,
    graphs,
    notes,
    tasks,
    loading,
    error,
    refreshToken,
    refresh: () => setRefreshToken((current) => current + 1),
  };
}
