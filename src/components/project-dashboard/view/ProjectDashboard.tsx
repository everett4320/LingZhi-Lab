import {
  Activity,
  ArrowRight,
  FolderOpen,
  FlaskConical,
  MessageSquare,
  Terminal,
} from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { formatTimeAgo } from '../../../utils/dateUtils';
import type { AppTab, Project, ProjectSession } from '../../../types/app';

type ProjectDashboardProps = {
  projects: Project[];
  onProjectAction: (project: Project, tab: AppTab) => void;
};

type TaskmasterMetadata = {
  taskCount?: number;
  completed?: number;
  completionPercentage?: number;
  lastModified?: string;
};

function getProjectSessions(project: Project): ProjectSession[] {
  return [
    ...(project.sessions ?? []),
    ...(project.cursorSessions ?? []),
    ...(project.codexSessions ?? []),
  ];
}

function getLastActivity(project: Project) {
  const sessionDates = getProjectSessions(project)
    .map((session) => session.updated_at || session.lastActivity || session.created_at || session.createdAt)
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()))
    .sort((a, b) => b.getTime() - a.getTime());

  if (sessionDates.length > 0) {
    return sessionDates[0].toISOString();
  }

  return project.createdAt ?? null;
}

function getTaskmasterMetadata(project: Project): TaskmasterMetadata | null {
  const metadata = project.taskmaster?.metadata;

  if (!metadata || typeof metadata !== 'object') {
    return null;
  }

  return metadata as TaskmasterMetadata;
}

function getProgress(project: Project) {
  const metadata = getTaskmasterMetadata(project);

  if (typeof metadata?.completionPercentage === 'number') {
    return Math.max(0, Math.min(100, metadata.completionPercentage));
  }

  return null;
}

export default function ProjectDashboard({
  projects,
  onProjectAction,
}: ProjectDashboardProps) {
  const { t } = useTranslation('common');
  const now = new Date();

  const totals = useMemo(() => {
    const projectCount = projects.length;
    const projectsWithProgress = projects.filter((project) => getProgress(project) !== null);
    const trackedProjects = projectsWithProgress.length;
    const averageProgress = trackedProjects > 0
      ? Math.round(
          projectsWithProgress.reduce((sum, project) => sum + (getProgress(project) ?? 0), 0) / trackedProjects,
        )
      : null;
    const totalSessions = projects.reduce((sum, project) => sum + getProjectSessions(project).length, 0);

    return {
      projectCount,
      trackedProjects,
      averageProgress,
      totalSessions,
    };
  }, [projects]);

  if (projects.length === 0) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto flex h-full w-full max-w-6xl items-center px-4 py-8 sm:px-6 lg:px-8">
          <div className="w-full rounded-3xl border border-dashed border-border/70 bg-card/40 p-8 text-center sm:p-12">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <FolderOpen className="h-6 w-6" />
            </div>
            <h2 className="mt-5 text-2xl font-semibold text-foreground">
              {t('projectDashboard.emptyTitle')}
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm text-muted-foreground sm:text-base">
              {t('projectDashboard.emptyDescription')}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-3xl border border-border/60 bg-card/80 p-5 shadow-sm">
            <div className="text-sm text-muted-foreground">{t('projectDashboard.summary.projects')}</div>
            <div className="mt-2 text-3xl font-semibold text-foreground">{totals.projectCount}</div>
          </div>
          <div className="rounded-3xl border border-border/60 bg-card/80 p-5 shadow-sm">
            <div className="text-sm text-muted-foreground">{t('projectDashboard.summary.sessions')}</div>
            <div className="mt-2 text-3xl font-semibold text-foreground">{totals.totalSessions}</div>
          </div>
          <div className="rounded-3xl border border-border/60 bg-card/80 p-5 shadow-sm">
            <div className="text-sm text-muted-foreground">{t('projectDashboard.summary.progress')}</div>
            <div className="mt-2 text-3xl font-semibold text-foreground">
              {totals.averageProgress === null ? t('projectDashboard.notTrackedShort') : `${totals.averageProgress}%`}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {t('projectDashboard.summary.trackedProjects', { count: totals.trackedProjects })}
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-2">
          {projects.map((project) => {
            const sessions = getProjectSessions(project);
            const metadata = getTaskmasterMetadata(project);
            const progress = getProgress(project);
            const lastActivity = getLastActivity(project);

            return (
              <article
                key={project.name}
                className="rounded-3xl border border-border/60 bg-card/90 p-5 shadow-sm transition-colors hover:border-primary/30"
              >
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-lg font-semibold text-foreground">
                          {project.displayName}
                        </h2>
                        {progress !== null && (
                          <Badge variant="secondary" className="rounded-full">
                            {t('projectDashboard.progressBadge', { progress })}
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 break-all text-xs text-muted-foreground sm:text-sm">
                        {project.fullPath}
                      </p>
                    </div>

                    <Button
                      variant="outline"
                      size="sm"
                      className="self-start rounded-full"
                      onClick={() => onProjectAction(project, 'chat')}
                    >
                      <FolderOpen className="h-4 w-4" />
                      {t('projectDashboard.openProject')}
                    </Button>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl bg-muted/40 p-3">
                      <div className="text-xs text-muted-foreground">{t('projectDashboard.metrics.sessions')}</div>
                      <div className="mt-1 text-xl font-semibold text-foreground">{sessions.length}</div>
                    </div>
                    <div className="rounded-2xl bg-muted/40 p-3">
                      <div className="text-xs text-muted-foreground">{t('projectDashboard.metrics.tasks')}</div>
                      <div className="mt-1 text-xl font-semibold text-foreground">{metadata?.taskCount ?? '0'}</div>
                    </div>
                    <div className="rounded-2xl bg-muted/40 p-3">
                      <div className="text-xs text-muted-foreground">{t('projectDashboard.metrics.completed')}</div>
                      <div className="mt-1 text-xl font-semibold text-foreground">{metadata?.completed ?? '0'}</div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-border/50 bg-background/60 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                        <Activity className="h-4 w-4 text-primary" />
                        {t('projectDashboard.progressTitle')}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {progress === null
                          ? t('projectDashboard.notTracked')
                          : t('projectDashboard.progressValue', { progress })}
                      </div>
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-[width] duration-300"
                        style={{ width: `${progress ?? 0}%` }}
                      />
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
                      <span>
                        {lastActivity
                          ? t('projectDashboard.lastActivity', {
                              time: formatTimeAgo(lastActivity, now, t),
                            })
                          : t('projectDashboard.noRecentActivity')}
                      </span>
                      {metadata?.lastModified && (
                        <span>
                          {t('projectDashboard.pipelineUpdated', {
                            time: formatTimeAgo(metadata.lastModified, now, t),
                          })}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="default"
                      size="sm"
                      className="rounded-full"
                      onClick={() => onProjectAction(project, 'chat')}
                    >
                      <MessageSquare className="h-4 w-4" />
                      {t('projectDashboard.actions.chat')}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-full"
                      onClick={() => onProjectAction(project, 'files')}
                    >
                      <FolderOpen className="h-4 w-4" />
                      {t('projectDashboard.actions.files')}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-full"
                      onClick={() => onProjectAction(project, 'researchlab')}
                    >
                      <FlaskConical className="h-4 w-4" />
                      {t('projectDashboard.actions.researchLab')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="rounded-full"
                      onClick={() => onProjectAction(project, 'shell')}
                    >
                      <Terminal className="h-4 w-4" />
                      {t('projectDashboard.actions.shell')}
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      </div>
    </div>
  );
}
