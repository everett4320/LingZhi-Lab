import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronRight,
  Compass,
  Download,
  Edit3,
  FolderTree,
  Layers,
  Loader2,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../utils/api';

type SkillNode = {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: SkillNode[];
};

type SkillTagType = 'intent' | 'capability' | 'domain' | 'status' | 'source' | 'stage' | 'meta';

type SkillTag = {
  label: string;
  type: SkillTagType;
};

type LocaleKey = 'zh' | 'en' | 'ko';

type LocalizedLabel = {
  zh: string;
  en: string;
  ko?: string;
};

type SkillTagMappingFile = {
  stageOverrides?: Record<string, LocalizedLabel>;
  domainOverrides?: Record<string, LocalizedLabel>;
  platformNativeSkills?: string[];
};

type SkillTagMapping = {
  stageOverrides: Record<string, LocalizedLabel>;
  domainOverrides: Record<string, LocalizedLabel>;
  platformNativeSkills: Set<string>;
};

type SkillSummary = {
  name: string;
  dirPath: string;
  summary: string;
  fullDescription: string;
  tags: SkillTag[];
  hasSkillMd: boolean;
  taxonomy: SkillTaxonomyRecord | null;
};

type FacetOption = {
  key: string;
  label: string;
  count: number;
};

type SkillRelation = {
  dirPath: string;
  name: string;
  reason: string;
  score: number;
};

type SkillExplorerSeed = SkillSummary & {
  primaryIntentKey: string;
  primaryIntentLabel: string;
  intentLabels: string[];
  capabilityKeys: string[];
  capabilityLabels: string[];
  domainKeys: string[];
  domainLabels: string[];
  keywordLabels: string[];
  primaryDomainKey: string;
  primaryDomainLabel: string;
  sourceKey: string;
  sourceLabel: string;
  statusKey: string;
  statusLabel: string;
  owner?: string;
  legacyCollectionLabel: string;
  legacyGroupLabel: string;
  searchText: string;
  relatedSkillNames: string[];
};

type SkillExplorerItem = SkillExplorerSeed & {
  relatedSkills: SkillRelation[];
};

type SkillCatalogV2Record = {
  name: string;
  primaryIntent: string;
  intents: string[];
  capabilities: string[];
  domains: string[];
  keywords?: string[];
  source: string;
  status: string;
  summary: string;
  relatedSkills?: string[];
  owner?: string;
  legacy?: {
    dirPath?: string;
    skillFile?: string;
    topLevelGroup?: string;
    collection?: string;
    domain?: string;
  };
};

type SkillCatalogV2File = {
  skills?: SkillCatalogV2Record[];
};

type SkillTaxonomyFacet = {
  key: string;
  label: string;
};

type SkillTaxonomyRecord = {
  primaryIntent: SkillTaxonomyFacet;
  intents: SkillTaxonomyFacet[];
  capabilities: SkillTaxonomyFacet[];
  domains: SkillTaxonomyFacet[];
  keywords: string[];
  source: SkillTaxonomyFacet;
  status: SkillTaxonomyFacet;
  relatedSkillNames: string[];
  owner?: string;
  legacyCollectionLabel?: string;
  legacyGroupLabel?: string;
};

const STAGE_RULES: Array<{ test: RegExp; tag: LocalizedLabel }> = [
  { test: /(orchestrator|route|planning|planner)/i, tag: { zh: '阶段: 编排', en: 'Stage: Orchestration', ko: '단계: 오케스트레이션' } },
  { test: /(prepare|resource|bootstrap|setup|collect)/i, tag: { zh: '阶段: 资源准备', en: 'Stage: Resource Prep', ko: '단계: 리소스 준비' } },
  { test: /(idea|brainstorm|hypothesis)/i, tag: { zh: '阶段: Idea生成', en: 'Stage: Idea Generation', ko: '단계: 아이디어 생성' } },
  { test: /(idea eval|evaluation|quality gate|meta-review)/i, tag: { zh: '阶段: Idea评估', en: 'Stage: Idea Evaluation', ko: '단계: 아이디어 평가' } },
  { test: /(survey|reference|literature|search)/i, tag: { zh: '阶段: 调研', en: 'Stage: Survey', ko: '단계: 조사' } },
  { test: /(experiment|develop|training|implementation|run)/i, tag: { zh: '阶段: 实验开发', en: 'Stage: Experiment Dev', ko: '단계: 실험 개발' } },
  { test: /(analysis|evaluate|benchmark|metric)/i, tag: { zh: '阶段: 实验分析', en: 'Stage: Analysis', ko: '단계: 분석' } },
  { test: /(paper|write|publication|report)/i, tag: { zh: '阶段: 论文撰写', en: 'Stage: Paper Writing', ko: '단계: 논문 작성' } },
  { test: /(reviewer|peer review|manuscript review)/i, tag: { zh: '阶段: 论文评审', en: 'Stage: Paper Review', ko: '단계: 논문 심사' } },
  { test: /(overleaf|rclone|sync)/i, tag: { zh: '阶段: 发布同步', en: 'Stage: Publication Sync', ko: '단계: 배포 동기화' } },
];

const DOMAIN_RULES: Array<{ test: RegExp; tag: LocalizedLabel }> = [
  { test: /(medical|med|clinical|health|biomed)/i, tag: { zh: '领域: 医疗', en: 'Domain: Medical', ko: '영역: 의료' } },
  { test: /(vision|image|cv|segmentation|detection)/i, tag: { zh: '领域: 视觉', en: 'Domain: Vision', ko: '영역: 비전' } },
  { test: /(nlp|language|text|llm)/i, tag: { zh: '领域: NLP', en: 'Domain: NLP', ko: '영역: NLP' } },
  { test: /(dataset|benchmark|corpus|data discovery)/i, tag: { zh: '领域: 数据', en: 'Domain: Data', ko: '영역: 데이터' } },
  { test: /(mcp|orchestrator|workflow|tool[- ]?use|automation|multi-agent)/i, tag: { zh: '领域: Agent', en: 'Domain: Agent', ko: '영역: 에이전트' } },
];

const EMPTY_TAG_MAPPING: SkillTagMapping = {
  stageOverrides: {},
  domainOverrides: {},
  platformNativeSkills: new Set<string>(),
};

const INTENT_LABELS: Record<string, LocalizedLabel> = {
  research: { zh: '调研', en: 'Research', ko: 'Research' },
  ideation: { zh: '想法生成', en: 'Ideation', ko: 'Ideation' },
  data: { zh: '数据处理', en: 'Data', ko: 'Data' },
  experiment: { zh: '实验开发', en: 'Experiment', ko: 'Experiment' },
  training: { zh: '模型训练', en: 'Training', ko: 'Training' },
  evaluation: { zh: '评测分析', en: 'Evaluation', ko: 'Evaluation' },
  writing: { zh: '论文与汇报', en: 'Writing', ko: 'Writing' },
  deployment: { zh: '部署集成', en: 'Deployment', ko: 'Deployment' },
};

const CAPABILITY_LABELS: Record<string, LocalizedLabel> = {
  'search-retrieval': { zh: '检索搜索', en: 'Search & Retrieval', ko: 'Search & Retrieval' },
  'research-planning': { zh: '研究规划', en: 'Research Planning', ko: 'Research Planning' },
  'agent-workflow': { zh: 'Agent 工作流', en: 'Agent Workflow', ko: 'Agent Workflow' },
  'data-processing': { zh: '数据处理', en: 'Data Processing', ko: 'Data Processing' },
  'training-tuning': { zh: '训练与调优', en: 'Training & Tuning', ko: 'Training & Tuning' },
  'inference-serving': { zh: '推理与服务', en: 'Inference & Serving', ko: 'Inference & Serving' },
  'evaluation-benchmarking': { zh: '评测与基准', en: 'Evaluation & Benchmarking', ko: 'Evaluation & Benchmarking' },
  'prompt-structured-output': { zh: '提示与结构化输出', en: 'Prompt & Structured Output', ko: 'Prompt & Structured Output' },
  multimodal: { zh: '多模态', en: 'Multimodal', ko: 'Multimodal' },
  interpretability: { zh: '可解释性', en: 'Interpretability', ko: 'Interpretability' },
  'safety-alignment': { zh: '安全与对齐', en: 'Safety & Alignment', ko: 'Safety & Alignment' },
  'infrastructure-ops': { zh: '基础设施与运维', en: 'Infrastructure & Ops', ko: 'Infrastructure & Ops' },
  'visualization-reporting': { zh: '可视化与汇报', en: 'Visualization & Reporting', ko: 'Visualization & Reporting' },
};

const TAXONOMY_DOMAIN_LABELS: Record<string, LocalizedLabel> = {
  general: { zh: '通用', en: 'General', ko: 'General' },
  'cs-ai': { zh: 'CS / AI', en: 'CS / AI', ko: 'CS / AI' },
  bioinformatics: { zh: '生物信息学', en: 'Bioinformatics', ko: 'Bioinformatics' },
  medical: { zh: '医疗', en: 'Medical', ko: 'Medical' },
  vision: { zh: '视觉', en: 'Vision', ko: 'Vision' },
  nlp: { zh: 'NLP', en: 'NLP', ko: 'NLP' },
  'data-engineering': { zh: '数据工程', en: 'Data Engineering', ko: 'Data Engineering' },
};

const STATUS_LABELS: Record<string, LocalizedLabel> = {
  candidate: { zh: '待校正', en: 'Candidate', ko: 'Candidate' },
  verified: { zh: '已校正', en: 'Verified', ko: 'Verified' },
  experimental: { zh: '实验中', en: 'Experimental', ko: 'Experimental' },
  deprecated: { zh: '已废弃', en: 'Deprecated', ko: 'Deprecated' },
};

const PATH_GROUP_LABELS: Record<string, string> = {
  agents: 'Agent Frameworks',
  'data-processing': 'Data Processing',
  'distributed-training': 'Distributed Training',
  'emerging-techniques': 'Emerging Techniques',
  evaluation: 'Evaluation',
  'fine-tuning': 'Fine-Tuning',
  'inference-serving': 'Inference Serving',
  infrastructure: 'Infrastructure',
  'mechanistic-interpretability': 'Mechanistic Interpretability',
  mlops: 'MLOps',
  'model-architecture': 'Model Architecture',
  multimodal: 'Multimodal',
  observability: 'Observability',
  optimization: 'Optimization',
  'post-training': 'Post-Training',
  'prompt-engineering': 'Prompt Engineering',
  rag: 'RAG',
  'research-ideation': 'Research Ideation',
  'safety-alignment': 'Safety & Alignment',
  tokenization: 'Tokenization',
};

const SLUG_WORD_LABELS: Record<string, string> = {
  ai: 'AI',
  cv: 'CV',
  fsdp: 'FSDP',
  llm: 'LLM',
  mlops: 'MLOps',
  nlp: 'NLP',
  rag: 'RAG',
  rl: 'RL',
};

const NON_SKILL_DIRECTORY_NAMES = new Set([
  '__pycache__',
  'asset',
  'assets',
  'scripts',
  'script',
  'references',
  'reference',
  'prompts',
  'prompt',
  'resources',
  'resource',
  'examples',
  'example',
  'templates',
  'template',
  'tests',
  'test',
]);

const FACET_PREFIX_PATTERN = /^(Domain|Stage|Category|Source|领域|阶段|类别|来源|영역|단계|카테고리):\s*/i;
const SOURCE_PLATFORM_PATTERN = /^(来源: 平台自研|Source: Dr\. Claw)$/i;

const UI_TEXT: Record<LocaleKey, Record<string, string>> = {
  zh: {
    loading: '加载技能中...',
    title: '技能导航',
    subtitle: '按主意图、技术能力、领域和治理状态浏览 100+ 技能，而不是把工作流阶段和技术类别混在一起。',
    refresh: '刷新',
    noRoots: '当前项目中未找到技能目录。',
    notFoundRoots: '当前工作区未检测到可用技能。',
    noSkills: '暂未检测到技能。创建或关联技能后点击刷新。',
    searchPlaceholder: '搜索技能名、意图、能力、领域或标签...',
    clearSearch: '清除搜索',
    allTags: '全部标签',
    noFilterResult: '当前筛选条件下没有技能，尝试清空搜索词或切换筛选。',
    clickForMore: '点击查看完整描述',
    detailTitle: '技能详情',
    fallbackDesc: 'Skill available, but description could not be extracted from SKILL.md.',
    fallbackNoSkillMd: 'No SKILL.md detected at the root. Contains {{count}} files (likely script- or workflow-based skill).',
    defaultDomain: '领域: 通用',
    sourcePlatform: '来源: 平台自研',
    sourcePlatformShort: 'Dr. Claw',
    sourceImportedShort: '导入',
    headerCount: '{{shown}}/{{total}} skills',
    summaryIntents: '{{count}} 个主意图',
    summaryCapabilities: '{{count}} 个技术能力',
    summaryDomains: '{{count}} 个领域',
    summaryVerified: '{{count}} 个已校正技能',
    quickViews: '快速视图',
    allSkills: '全部技能',
    nativeSkills: '平台自研',
    communitySkills: '外部导入',
    verifiedSkills: '已校正',
    intents: '主意图',
    capabilities: '技术能力',
    domains: '领域',
    statuses: '状态',
    allIntents: '全部主意图',
    allCapabilities: '全部技术能力',
    allDomains: '全部领域',
    allStatuses: '全部状态',
    clearFilters: '清空筛选',
    results: '结果',
    resultsSummary: '当前显示 {{shown}} 个技能',
    overview: '概览',
    relatedSkills: '相关技能',
    emptySelection: '选择一个技能以查看详情、标签和相关技能。',
    pathField: '路径',
    primaryIntentField: '主意图',
    intentsField: '意图',
    capabilitiesField: '能力',
    domainField: '领域',
    sourceField: '来源',
    statusField: '状态',
    ownerField: '维护者',
    legacyField: '旧分类',
    keywordsField: '关键词',
    rawTagsField: '原始标签',
    standaloneGroup: '独立技能',
    noSkillFile: '根目录未检测到 SKILL.md',
    discardChanges: '放弃未保存的修改？',
    importLocal: '导入本地技能',
    importModalTitle: '从本地目录导入技能',
    scan: '扫描',
    scanning: '扫描中...',
    importSelected: '导入选中',
    importing: '导入中...',
    importSuccess: '成功导入 {{count}} 个技能',
    importSkipped: '已跳过 {{count}} 个已存在的技能',
    noSkillsFound: '未在该目录中发现技能。',
    alreadyImported: '已导入',
    pathLabel: '技能目录路径',
    editSkill: '编辑',
    deleteSkill: '删除',
    saveSkill: '保存',
    cancelEdit: '取消',
    confirmDeleteSkill: '确定要删除技能 "{{name}}" 吗？此操作不可撤销。',
    skillDeleted: '技能 "{{name}}" 已删除',
    skillSaved: '技能 "{{name}}" 已保存',
    saving: '保存中...',
    deleting: '删除中...',
  },
  en: {
    loading: 'Loading skills...',
    title: 'Skill Explorer',
    subtitle: 'Browse 100+ skills by primary intent, capability, domain, and governance state instead of mixing workflow stage with technical type.',
    refresh: 'Refresh',
    noRoots: 'No skill directories found in this project.',
    notFoundRoots: 'No skills are currently available in this workspace.',
    noSkills: 'No skills detected yet. Click Refresh after creating or linking skills.',
    searchPlaceholder: 'Search skills, intents, capabilities, domains, or tags...',
    clearSearch: 'Clear search',
    allTags: 'All Tags',
    noFilterResult: 'No skills match the current filters. Try clearing search or switching filters.',
    clickForMore: 'Click to view full description',
    detailTitle: 'Skill details',
    fallbackDesc: 'Skill available, but description could not be extracted from SKILL.md.',
    fallbackNoSkillMd: 'No SKILL.md detected at the root. Contains {{count}} files (likely script- or workflow-based skill).',
    defaultDomain: 'Domain: General',
    sourcePlatform: 'Source: Dr. Claw',
    sourcePlatformShort: 'Dr. Claw',
    sourceImportedShort: 'Imported',
    headerCount: '{{shown}}/{{total}} skills',
    summaryIntents: '{{count}} primary intents',
    summaryCapabilities: '{{count}} capabilities',
    summaryDomains: '{{count}} domains',
    summaryVerified: '{{count}} verified skills',
    quickViews: 'Quick Views',
    allSkills: 'All Skills',
    nativeSkills: 'Dr. Claw',
    communitySkills: 'Imported',
    verifiedSkills: 'Verified',
    intents: 'Primary Intent',
    capabilities: 'Capabilities',
    domains: 'Domains',
    statuses: 'Status',
    allIntents: 'All Intents',
    allCapabilities: 'All Capabilities',
    allDomains: 'All Domains',
    allStatuses: 'All Statuses',
    clearFilters: 'Clear Filters',
    results: 'Results',
    resultsSummary: '{{shown}} skills shown',
    overview: 'Overview',
    relatedSkills: 'Related Skills',
    emptySelection: 'Select a skill to inspect its details, tags, and nearby skills.',
    pathField: 'Path',
    primaryIntentField: 'Primary Intent',
    intentsField: 'Intents',
    capabilitiesField: 'Capabilities',
    domainField: 'Domain',
    sourceField: 'Source',
    statusField: 'Status',
    ownerField: 'Owner',
    legacyField: 'Legacy',
    keywordsField: 'Keywords',
    rawTagsField: 'Raw Tags',
    standaloneGroup: 'Standalone',
    noSkillFile: 'No root SKILL.md found',
    discardChanges: 'Discard unsaved changes?',
    importLocal: 'Import Local Skills',
    importModalTitle: 'Import skills from local directory',
    scan: 'Scan',
    scanning: 'Scanning...',
    importSelected: 'Import Selected',
    importing: 'Importing...',
    importSuccess: 'Successfully imported {{count}} skills',
    importSkipped: 'Skipped {{count}} already-imported skills',
    noSkillsFound: 'No skills found in this directory.',
    alreadyImported: 'Already imported',
    pathLabel: 'Skills directory path',
    editSkill: 'Edit',
    deleteSkill: 'Delete',
    saveSkill: 'Save',
    cancelEdit: 'Cancel',
    confirmDeleteSkill: 'Delete skill "{{name}}"? This cannot be undone.',
    skillDeleted: '"{{name}}" deleted',
    skillSaved: '"{{name}}" saved',
    saving: 'Saving...',
    deleting: 'Deleting...',
  },
  ko: {
    loading: 'Loading skills...',
    title: 'Skill Explorer',
    subtitle: 'Browse 100+ skills by primary intent, capability, domain, and governance state instead of mixing workflow stage with technical type.',
    refresh: 'Refresh',
    noRoots: 'No skill directories found in this project.',
    notFoundRoots: 'No skills are currently available in this workspace.',
    noSkills: 'No skills detected yet. Click Refresh after creating or linking skills.',
    searchPlaceholder: 'Search skills, intents, capabilities, domains, or tags...',
    clearSearch: 'Clear search',
    allTags: 'All Tags',
    noFilterResult: 'No skills match the current filters. Try clearing search or switching filters.',
    clickForMore: 'Click to view full description',
    detailTitle: 'Skill details',
    fallbackDesc: 'Skill available, but description could not be extracted from SKILL.md.',
    fallbackNoSkillMd: 'No SKILL.md detected at the root. Contains {{count}} files (likely script- or workflow-based skill).',
    defaultDomain: 'Domain: General',
    sourcePlatform: 'Source: Dr. Claw',
    sourcePlatformShort: 'Dr. Claw',
    sourceImportedShort: 'Imported',
    headerCount: '{{shown}}/{{total}} skills',
    summaryIntents: '{{count}} primary intents',
    summaryCapabilities: '{{count}} capabilities',
    summaryDomains: '{{count}} domains',
    summaryVerified: '{{count}} verified skills',
    quickViews: 'Quick Views',
    allSkills: 'All Skills',
    nativeSkills: 'Dr. Claw',
    communitySkills: 'Imported',
    verifiedSkills: 'Verified',
    intents: 'Primary Intent',
    capabilities: 'Capabilities',
    domains: 'Domains',
    statuses: 'Status',
    allIntents: 'All Intents',
    allCapabilities: 'All Capabilities',
    allDomains: 'All Domains',
    allStatuses: 'All Statuses',
    clearFilters: 'Clear Filters',
    results: 'Results',
    resultsSummary: '{{shown}} skills shown',
    overview: 'Overview',
    relatedSkills: 'Related Skills',
    emptySelection: 'Select a skill to inspect its details, tags, and nearby skills.',
    pathField: 'Path',
    primaryIntentField: 'Primary Intent',
    intentsField: 'Intents',
    capabilitiesField: 'Capabilities',
    domainField: 'Domain',
    sourceField: 'Source',
    statusField: 'Status',
    ownerField: 'Owner',
    legacyField: 'Legacy',
    keywordsField: 'Keywords',
    rawTagsField: 'Raw Tags',
    standaloneGroup: 'Standalone',
    noSkillFile: 'No root SKILL.md found',
    discardChanges: 'Discard unsaved changes?',
    importLocal: 'Import Local Skills',
    importModalTitle: 'Import skills from local directory',
    scan: 'Scan',
    scanning: 'Scanning...',
    importSelected: 'Import Selected',
    importing: 'Importing...',
    importSuccess: 'Successfully imported {{count}} skills',
    importSkipped: 'Skipped {{count}} already-imported skills',
    noSkillsFound: 'No skills found in this directory.',
    alreadyImported: 'Already imported',
    pathLabel: 'Skills directory path',
    editSkill: 'Edit',
    deleteSkill: 'Delete',
    saveSkill: 'Save',
    cancelEdit: 'Cancel',
    confirmDeleteSkill: 'Delete skill "{{name}}"? This cannot be undone.',
    skillDeleted: '"{{name}}" deleted',
    skillSaved: '"{{name}}" saved',
    saving: 'Saving...',
    deleting: 'Deleting...',
  },
};

function resolveLocaleKey(language: string): LocaleKey {
  const normalized = language.toLowerCase();
  if (normalized.startsWith('zh')) return 'zh';
  if (normalized.startsWith('ko')) return 'ko';
  return 'en';
}

function localize(label: LocalizedLabel, localeKey: LocaleKey): string {
  return label[localeKey] ?? label.en;
}

function getPrefix(type: 'domain' | 'stage', localeKey: LocaleKey): string {
  if (type === 'domain') {
    if (localeKey === 'zh') return '领域:';
    if (localeKey === 'ko') return '영역:';
    return 'Domain:';
  }

  if (localeKey === 'zh') return '阶段:';
  if (localeKey === 'ko') return '단계:';
  return 'Stage:';
}

function compactText(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

function normalizeSkillKey(input: string): string {
  return compactText(input).toLowerCase();
}

function parseTagMappingFile(payload: unknown): SkillTagMapping {
  if (!payload || typeof payload !== 'object') {
    return EMPTY_TAG_MAPPING;
  }

  const parsed = payload as SkillTagMappingFile;
  const stageOverrides = Object.fromEntries(
    Object.entries(parsed.stageOverrides ?? {}).map(([key, value]) => [normalizeSkillKey(key), value])
  );
  const domainOverrides = Object.fromEntries(
    Object.entries(parsed.domainOverrides ?? {}).map(([key, value]) => [normalizeSkillKey(key), value])
  );
  const platformNativeSkills = new Set((parsed.platformNativeSkills ?? []).map((name) => normalizeSkillKey(name)));

  return {
    stageOverrides,
    domainOverrides,
    platformNativeSkills,
  };
}

function localizeTaxonomyValue(
  type: 'intent' | 'capability' | 'domain' | 'status',
  key: string,
  localeKey: LocaleKey
): string {
  const source =
    type === 'intent'
      ? INTENT_LABELS
      : type === 'capability'
        ? CAPABILITY_LABELS
        : type === 'domain'
          ? TAXONOMY_DOMAIN_LABELS
          : STATUS_LABELS;

  const label = source[key];
  if (label) {
    return localize(label, localeKey);
  }

  return humanizeSlug(key);
}

function buildTaxonomyTags(taxonomy: SkillTaxonomyRecord, metaTags: string[]): SkillTag[] {
  const tags: SkillTag[] = [];
  const pushTag = (label: string, type: SkillTagType) => {
    if (!tags.some((tag) => tag.label === label && tag.type === type)) {
      tags.push({ label, type });
    }
  };

  pushTag(taxonomy.primaryIntent.label, 'intent');
  taxonomy.capabilities.forEach((facet) => pushTag(facet.label, 'capability'));
  taxonomy.domains.forEach((facet) => pushTag(facet.label, 'domain'));
  pushTag(taxonomy.status.label, 'status');
  pushTag(taxonomy.source.label, 'source');
  [...taxonomy.keywords, ...metaTags].slice(0, 4).forEach((label) => pushTag(label, 'meta'));

  return tags;
}

function parseSkillCatalogV2(payload: unknown, localeKey: LocaleKey, text: Record<string, string>): Map<string, SkillTaxonomyRecord> {
  const catalog = payload as SkillCatalogV2File;
  const records = Array.isArray(catalog?.skills) ? catalog.skills : [];
  const result = new Map<string, SkillTaxonomyRecord>();

  for (const record of records) {
    const taxonomy: SkillTaxonomyRecord = {
      primaryIntent: {
        key: record.primaryIntent,
        label: localizeTaxonomyValue('intent', record.primaryIntent, localeKey),
      },
      intents: (record.intents?.length ? record.intents : [record.primaryIntent]).map((value) => ({
        key: value,
        label: localizeTaxonomyValue('intent', value, localeKey),
      })),
      capabilities: (record.capabilities ?? []).map((value) => ({
        key: value,
        label: localizeTaxonomyValue('capability', value, localeKey),
      })),
      domains: (record.domains ?? []).map((value) => ({
        key: value,
        label: localizeTaxonomyValue('domain', value, localeKey),
      })),
      keywords: Array.isArray(record.keywords) ? record.keywords.map((value) => compactText(String(value))).filter(Boolean) : [],
      source: {
        key: record.source,
        label: record.source === 'vibelab' ? text.sourcePlatformShort : text.sourceImportedShort,
      },
      status: {
        key: record.status,
        label: localizeTaxonomyValue('status', record.status, localeKey),
      },
      relatedSkillNames: Array.isArray(record.relatedSkills) ? record.relatedSkills : [],
      owner: record.owner,
      legacyCollectionLabel: record.legacy?.collection,
      legacyGroupLabel: record.legacy?.topLevelGroup,
    };

    const legacyDirPath = compactText(record.legacy?.dirPath ?? '');
    if (legacyDirPath) {
      result.set(legacyDirPath, taxonomy);
    }

    result.set(record.name, taxonomy);
  }

  return result;
}

function countFiles(node: SkillNode): number {
  if (node.type === 'file') {
    return 1;
  }

  return (node.children ?? []).reduce((acc, child) => acc + countFiles(child), 0);
}

function findDirectFilePathByName(node: SkillNode, fileName: string): string | null {
  if (node.type !== 'directory') {
    return null;
  }

  const directFile = (node.children ?? []).find(
    (child) => child.type === 'file' && child.name === fileName
  );

  return directFile?.path ?? null;
}

function isLikelyNonSkillDirectory(node: SkillNode): boolean {
  return NON_SKILL_DIRECTORY_NAMES.has(node.name.toLowerCase());
}

function collectSkillDirectories(nodes: SkillNode[]): SkillNode[] {
  const results: SkillNode[] = [];
  const seenPaths = new Set<string>();

  const push = (node: SkillNode) => {
    if (node.type !== 'directory') return;
    if (isLikelyNonSkillDirectory(node)) return;
    if (seenPaths.has(node.path)) return;
    seenPaths.add(node.path);
    results.push(node);
  };

  const visit = (node: SkillNode, depthFromRoot: number): boolean => {
    if (node.type !== 'directory') {
      return false;
    }

    if (findDirectFilePathByName(node, 'SKILL.md')) {
      push(node);
      return true;
    }

    const childDirs = (node.children ?? []).filter((child) => child.type === 'directory');
    let foundDescendantSkill = false;

    for (const childDir of childDirs) {
      if (visit(childDir, depthFromRoot + 1)) {
        foundDescendantSkill = true;
      }
    }

    if (!foundDescendantSkill && depthFromRoot === 0 && childDirs.length === 0) {
      push(node);
      return true;
    }

    return foundDescendantSkill;
  };

  for (const node of nodes) {
    if (node.type === 'directory') {
      visit(node, 0);
    }
  }

  return results;
}

function clampText(input: string, maxLength = 240): string {
  const text = compactText(input);
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 1).trim()}...`;
}

function parseYamlInlineArray(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
    return [];
  }

  return trimmed
    .slice(1, -1)
    .split(',')
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

function parseFrontmatterTags(lines: string[], localeKey: LocaleKey): SkillTag[] {
  const tags: SkillTag[] = [];
  const pushTag = (label: string, type: SkillTagType = 'meta') => {
    const normalized = compactText(label);
    if (normalized) {
      tags.push({ label: normalized, type });
    }
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const keyMatch = line.match(/^\s*([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!keyMatch) continue;

    const key = keyMatch[1].toLowerCase();
    const rawValue = keyMatch[2].trim();

    if (key === 'tags') {
      if (!rawValue) {
        for (let j = i + 1; j < lines.length; j += 1) {
          const listMatch = lines[j].match(/^\s*[-*]\s*(.+)$/);
          if (!listMatch) break;
          pushTag(listMatch[1], 'meta');
          i = j;
        }
      } else {
        const inlineArray = parseYamlInlineArray(rawValue);
        if (inlineArray.length > 0) {
          inlineArray.forEach((tag) => pushTag(tag, 'meta'));
        } else {
          rawValue.split(',').forEach((tag) => pushTag(tag, 'meta'));
        }
      }
    }

    if (key === 'domain') {
      rawValue.split(',').forEach((tag) => pushTag(`${getPrefix('domain', localeKey)} ${tag.trim()}`, 'domain'));
    }

    if (key === 'stage') {
      rawValue.split(',').forEach((tag) => pushTag(`${getPrefix('stage', localeKey)} ${tag.trim()}`, 'stage'));
    }
  }

  return tags;
}

function parseDescriptionFromFrontmatter(lines: string[]): string | null {
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const keyMatch = line.match(/^\s*([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!keyMatch) continue;

    const key = keyMatch[1];
    const rawValue = keyMatch[2].trim();
    if (key !== 'description') continue;

    if (/^(>|>-|\||\|-)$/.test(rawValue)) {
      const blockLines: string[] = [];
      for (let j = i + 1; j < lines.length; j += 1) {
        const candidate = lines[j];
        if (/^[A-Za-z0-9_-]+\s*:/.test(candidate)) {
          break;
        }
        const cleaned = candidate.replace(/^\s+/, '');
        if (cleaned) blockLines.push(cleaned);
      }
      const blockSummary = compactText(blockLines.join(' '));
      if (blockSummary) {
        return blockSummary;
      }
    } else if (rawValue) {
      const inlineSummary = compactText(rawValue.replace(/^['"]|['"]$/g, ''));
      if (inlineSummary) {
        return inlineSummary;
      }
    }

    break;
  }

  return null;
}

function extractBodyDescription(content: string): string {
  const body = content.replace(/^---\n[\s\S]*?\n---\n?/, '');
  const lines = body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => Boolean(line) && !line.startsWith('#'));

  return lines.join('\n').replace(/^[\-*+]\s+/gm, '').trim();
}

function inferTags(
  skillName: string,
  summary: string,
  explicitTags: SkillTag[],
  localeKey: LocaleKey,
  mapping: SkillTagMapping
): SkillTag[] {
  const inferred: SkillTag[] = [...explicitTags];
  const push = (label: string, type: SkillTagType) => {
    if (!inferred.some((tag) => tag.label === label)) {
      inferred.push({ label, type });
    }
  };

  const signal = `${skillName} ${summary}`;
  const normalizedSkillName = normalizeSkillKey(skillName);
  const hasStage = inferred.some((tag) => tag.type === 'stage');
  const hasDomain = inferred.some((tag) => tag.type === 'domain');
  const nativeSkillSet = mapping.platformNativeSkills;

  if (!hasStage) {
    const stageOverride = mapping.stageOverrides[normalizedSkillName];
    if (stageOverride) {
      push(localize(stageOverride, localeKey), 'stage');
    } else if (nativeSkillSet.has(normalizedSkillName)) {
      for (const rule of STAGE_RULES) {
        if (rule.test.test(signal)) {
          push(localize(rule.tag, localeKey), 'stage');
          break;
        }
      }
    }
  }

  if (!hasDomain) {
    const domainOverride = mapping.domainOverrides[normalizedSkillName];
    if (domainOverride) {
      push(localize(domainOverride, localeKey), 'domain');
    } else {
      for (const rule of DOMAIN_RULES) {
        if (rule.test.test(signal)) {
          push(localize(rule.tag, localeKey), 'domain');
        }
      }
    }
  }

  if (!inferred.some((tag) => tag.type === 'domain')) {
    push(UI_TEXT[localeKey].defaultDomain, 'domain');
  }

  if (nativeSkillSet.has(normalizedSkillName)) {
    push(UI_TEXT[localeKey].sourcePlatform, 'meta');
  }

  return inferred;
}

function extractSkillMetadata(
  content: string,
  localeKey: LocaleKey
): { summary: string | null; fullDescription: string | null; tags: SkillTag[] } {
  const normalized = content.replace(/\r\n/g, '\n');
  const frontmatterMatch = normalized.match(/^---\n([\s\S]*?)\n---/);
  const frontmatterLines = frontmatterMatch ? frontmatterMatch[1].split('\n') : [];

  const fmDescription = parseDescriptionFromFrontmatter(frontmatterLines);
  const bodyDescription = extractBodyDescription(normalized);
  const fullDescription = fmDescription || bodyDescription || null;
  const summary = fullDescription ? clampText(fullDescription) : null;
  const tags = parseFrontmatterTags(frontmatterLines, localeKey);

  return { summary, fullDescription, tags };
}

function isSourcePlatformTag(label: string): boolean {
  return SOURCE_PLATFORM_PATTERN.test(label);
}

function stripFacetPrefix(label: string): string {
  return label.replace(FACET_PREFIX_PATTERN, '').trim();
}

function humanizeSlug(value: string): string {
  return value
    .split('-')
    .filter(Boolean)
    .map((part) => SLUG_WORD_LABELS[part.toLowerCase()] ?? `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function getTopLevelGroup(dirPath: string, standaloneLabel: string): { key: string; label: string } {
  const segments = dirPath.split('/').filter(Boolean);
  if (segments.length <= 1) {
    return { key: 'standalone', label: standaloneLabel };
  }

  const key = segments[0];
  return {
    key,
    label: PATH_GROUP_LABELS[key] ?? humanizeSlug(key),
  };
}

function buildFacetOptions(
  items: SkillExplorerItem[],
  pickFacet: (item: SkillExplorerItem) => { key: string; label: string }
): FacetOption[] {
  const counts = new Map<string, FacetOption>();

  for (const item of items) {
    const facet = pickFacet(item);
    const current = counts.get(facet.key);
    if (current) {
      current.count += 1;
    } else {
      counts.set(facet.key, { ...facet, count: 1 });
    }
  }

  return Array.from(counts.values()).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function buildMultiFacetOptions(
  items: SkillExplorerItem[],
  pickFacets: (item: SkillExplorerItem) => Array<{ key: string; label: string }>
): FacetOption[] {
  const counts = new Map<string, FacetOption>();

  for (const item of items) {
    for (const facet of pickFacets(item)) {
      const current = counts.get(facet.key);
      if (current) {
        current.count += 1;
      } else {
        counts.set(facet.key, { ...facet, count: 1 });
      }
    }
  }

  return Array.from(counts.values()).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function tagStyleClass(type: SkillTagType, label?: string): string {
  if (type === 'source' || (label && isSourcePlatformTag(label))) {
    return 'border-amber-300/80 bg-amber-50 text-amber-800 shadow-sm dark:border-amber-500/60 dark:bg-amber-900/30 dark:text-amber-200';
  }
  if (type === 'intent') {
    return 'border-sky-300/60 bg-sky-50 text-sky-700 dark:border-sky-600/60 dark:bg-sky-950/40 dark:text-sky-200';
  }
  if (type === 'capability') {
    return 'border-violet-300/60 bg-violet-50 text-violet-700 dark:border-violet-600/60 dark:bg-violet-950/40 dark:text-violet-200';
  }
  if (type === 'stage') {
    if (label && /^(Category:|类别:|카테고리:)/.test(label)) {
      return 'border-violet-300/60 bg-violet-50 text-violet-700 dark:border-violet-600/60 dark:bg-violet-950/40 dark:text-violet-200';
    }
    return 'border-cyan-300/60 bg-cyan-50 text-cyan-700 dark:border-cyan-600/60 dark:bg-cyan-950/40 dark:text-cyan-200';
  }
  if (type === 'domain') {
    return 'border-emerald-300/60 bg-emerald-50 text-emerald-700 dark:border-emerald-600/60 dark:bg-emerald-950/40 dark:text-emerald-200';
  }
  if (type === 'status') {
    return 'border-rose-300/60 bg-rose-50 text-rose-700 dark:border-rose-600/60 dark:bg-rose-950/40 dark:text-rose-200';
  }
  return 'border-slate-300/60 bg-slate-50 text-slate-700 dark:border-slate-600/60 dark:bg-slate-900/60 dark:text-slate-200';
}

function getTagPriority(tag: SkillTag): number {
  if (isSourcePlatformTag(tag.label)) return 0;
  if (tag.type === 'intent') return 1;
  if (tag.type === 'capability') return 2;
  if (tag.type === 'domain') return 3;
  if (tag.type === 'status' || tag.type === 'source') return 4;
  if (tag.type === 'stage') return 5;
  return 6;
}

function sortSkillTags(tags: SkillTag[]): SkillTag[] {
  return [...tags].sort((a, b) => {
    const priorityDiff = getTagPriority(a) - getTagPriority(b);
    if (priorityDiff !== 0) return priorityDiff;
    return a.label.localeCompare(b.label);
  });
}

function scoreSkillMatch(skill: SkillExplorerItem, query: string): number {
  const terms = compactText(query).toLowerCase().split(' ').filter(Boolean);
  if (terms.length === 0) {
    return 0;
  }

  let score = 0;
  const name = skill.name.toLowerCase();
  const path = skill.dirPath.toLowerCase();
  const primaryIntent = skill.primaryIntentLabel.toLowerCase();
  const capabilities = skill.capabilityLabels.join(' ').toLowerCase();
  const domain = skill.primaryDomainLabel.toLowerCase();
  const status = skill.statusLabel.toLowerCase();
  const summary = skill.summary.toLowerCase();

  for (const term of terms) {
    if (name === term) score += 140;
    if (name.startsWith(term)) score += 80;
    if (name.includes(term)) score += 55;
    if (path.includes(term)) score += 35;
    if (primaryIntent.includes(term)) score += 28;
    if (capabilities.includes(term)) score += 24;
    if (domain.includes(term)) score += 18;
    if (status.includes(term)) score += 12;
    if (summary.includes(term)) score += 12;
    if (skill.tags.some((tag) => tag.label.toLowerCase().includes(term))) score += 10;
  }

  if (terms.every((term) => skill.searchText.includes(term))) {
    score += 25;
  }

  return score;
}

function sortSkillsForBrowse(items: SkillExplorerItem[]): SkillExplorerItem[] {
  return [...items].sort((a, b) =>
    a.primaryIntentLabel.localeCompare(b.primaryIntentLabel)
    || a.statusLabel.localeCompare(b.statusLabel)
    || a.name.localeCompare(b.name)
  );
}

function buildExplorerSkills(
  skills: SkillSummary[],
  options: {
    standaloneLabel: string;
    defaultDomainLabel: string;
    sourcePlatformShort: string;
    sourceImportedShort: string;
  }
): SkillExplorerItem[] {
  const seeds: SkillExplorerSeed[] = skills.map((skill) => {
    const fallbackTags = sortSkillTags(skill.tags);
    const topLevelGroup = getTopLevelGroup(skill.dirPath, options.standaloneLabel);
    const primaryStageTag = fallbackTags.find((tag) => tag.type === 'stage');
    const primaryDomainTag = fallbackTags.find((tag) => tag.type === 'domain');
    const collectionLabel = stripFacetPrefix(primaryStageTag?.label ?? topLevelGroup.label);
    const primaryDomainLabel = stripFacetPrefix(primaryDomainTag?.label ?? options.defaultDomainLabel);
    const taxonomy = skill.taxonomy;
    const fallbackSourceKey = fallbackTags.some((tag) => isSourcePlatformTag(tag.label)) ? 'vibelab' : 'imported';
    const fallbackDomainKey = primaryDomainTag ? `domain:${normalizeSkillKey(primaryDomainLabel)}` : 'domain:general';
    const fallbackCapabilities = topLevelGroup.key === 'standalone'
      ? []
      : [{ key: `legacy:${topLevelGroup.key}`, label: topLevelGroup.label }];
    const intentLabel = taxonomy?.primaryIntent.label ?? collectionLabel;
    const sourceLabel = taxonomy?.source.label ?? (fallbackSourceKey === 'vibelab' ? options.sourcePlatformShort : options.sourceImportedShort);
    const statusKey = taxonomy?.status.key ?? (fallbackSourceKey === 'vibelab' ? 'verified' : 'candidate');
    const statusLabel = taxonomy?.status.label ?? humanizeSlug(statusKey);
    const domains = taxonomy?.domains ?? [{ key: fallbackDomainKey, label: primaryDomainLabel }];
    const capabilities = taxonomy?.capabilities ?? fallbackCapabilities;
    const tags = taxonomy
      ? sortSkillTags(buildTaxonomyTags(taxonomy, fallbackTags.filter((tag) => tag.type === 'meta').map((tag) => tag.label)))
      : fallbackTags;

    return {
      ...skill,
      tags,
      primaryIntentKey: taxonomy?.primaryIntent.key ?? `legacy:${normalizeSkillKey(collectionLabel)}`,
      primaryIntentLabel: intentLabel,
      intentLabels: (taxonomy?.intents ?? [{ key: `legacy:${normalizeSkillKey(collectionLabel)}`, label: collectionLabel }]).map((facet) => facet.label),
      capabilityKeys: capabilities.map((facet) => facet.key),
      capabilityLabels: capabilities.map((facet) => facet.label),
      domainKeys: domains.map((facet) => facet.key),
      domainLabels: domains.map((facet) => facet.label),
      keywordLabels: taxonomy?.keywords ?? fallbackTags.filter((tag) => tag.type === 'meta').map((tag) => tag.label),
      primaryDomainKey: domains[0]?.key ?? fallbackDomainKey,
      primaryDomainLabel: domains[0]?.label ?? primaryDomainLabel,
      sourceKey: taxonomy?.source.key ?? fallbackSourceKey,
      sourceLabel,
      statusKey,
      statusLabel,
      owner: taxonomy?.owner,
      legacyCollectionLabel: taxonomy?.legacyCollectionLabel ?? collectionLabel,
      legacyGroupLabel: taxonomy?.legacyGroupLabel ?? topLevelGroup.label,
      relatedSkillNames: taxonomy?.relatedSkillNames ?? [],
      searchText: compactText([
        skill.name,
        skill.dirPath,
        skill.summary,
        intentLabel,
        capabilities.map((facet) => facet.label).join(' '),
        domains.map((facet) => facet.label).join(' '),
        sourceLabel,
        statusLabel,
        ...tags.map((tag) => tag.label),
      ].join(' ')).toLowerCase(),
    };
  });

  const seedByName = new Map(seeds.map((skill) => [skill.name, skill]));

  return seeds.map((skill) => {
    const inferReason = (other: SkillExplorerSeed): string => {
      const sharedCapability = skill.capabilityLabels.find((label) => other.capabilityLabels.includes(label));
      if (sharedCapability) return sharedCapability;
      const sharedDomain = skill.domainLabels.find((label) => other.domainLabels.includes(label));
      if (sharedDomain) return sharedDomain;
      const sharedIntent = skill.intentLabels.find((label) => other.intentLabels.includes(label));
      if (sharedIntent) return sharedIntent;
      if (skill.sourceKey === other.sourceKey) return skill.sourceLabel;
      return other.primaryIntentLabel;
    };

    const explicitRelated = skill.relatedSkillNames
      .map((name, index) => {
        const other = seedByName.get(name);
        if (!other || other.dirPath === skill.dirPath) {
          return null;
        }

        return {
          dirPath: other.dirPath,
          name: other.name,
          reason: inferReason(other),
          score: 100 - index,
        };
      })
      .filter((relation): relation is SkillRelation => relation !== null);

    const heuristicRelated = seeds
      .filter((other) => other.dirPath !== skill.dirPath)
      .map((other) => {
        let score = 0;
        let reason = '';

        if (skill.primaryIntentKey === other.primaryIntentKey) {
          score += 6;
          reason = skill.primaryIntentLabel;
        }

        const sharedCapabilities = skill.capabilityLabels.filter((label) => other.capabilityLabels.includes(label));
        if (sharedCapabilities.length > 0) {
          score += 4;
          if (!reason) {
            reason = sharedCapabilities[0];
          }
        }

        const sharedDomains = skill.domainLabels.filter((label) => other.domainLabels.includes(label));
        if (sharedDomains.length > 0) {
          score += 3;
          if (!reason) {
            reason = sharedDomains[0];
          }
        }

        const sharedMetaTags = skill.tags.filter(
          (tag) => tag.type === 'meta' && other.tags.some((otherTag) => otherTag.label === tag.label)
        );
        if (sharedMetaTags.length > 0) {
          score += Math.min(sharedMetaTags.length, 2);
          if (!reason) {
            reason = sharedMetaTags[0].label;
          }
        }

        if (score === 0 && skill.sourceKey === other.sourceKey) {
          score = 1;
          reason = skill.sourceLabel;
        }

        if (score === 0) {
          return null;
        }

        return {
          dirPath: other.dirPath,
          name: other.name,
          reason,
          score,
        };
      })
      .filter((relation): relation is SkillRelation => relation !== null)
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .slice(0, 6);

    const relatedSkills = explicitRelated.length > 0
      ? explicitRelated
      : heuristicRelated;

    return {
      ...skill,
      relatedSkills,
    };
  });
}

function facetButtonClass(active: boolean): string {
  return `flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm transition ${
    active
      ? 'border-sky-400/70 bg-sky-50 text-sky-700 shadow-sm dark:border-sky-500/60 dark:bg-sky-950/40 dark:text-sky-200'
      : 'border-border/70 bg-background text-foreground hover:bg-muted/60'
  }`;
}

function DetailChipSection({
  title,
  values,
  type = 'meta',
}: {
  title: string;
  values: string[];
  type?: SkillTagType;
}) {
  if (values.length === 0) {
    return null;
  }

  return (
    <div>
      <h4 className="text-sm font-semibold text-foreground">{title}</h4>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {values.map((value) => (
          <span
            key={`${title}-${value}`}
            className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium ${tagStyleClass(type, value)}`}
          >
            {value}
          </span>
        ))}
      </div>
    </div>
  );
}

function buildSkillCardTagSummary(skill: SkillExplorerItem): { tags: Array<{ label: string; type: SkillTagType }>; hiddenCount: number } {
  const tags: Array<{ label: string; type: SkillTagType }> = [
    { label: skill.primaryIntentLabel, type: 'intent' },
    ...skill.capabilityLabels.slice(0, 2).map((label) => ({ label, type: 'capability' as SkillTagType })),
    ...skill.domainLabels.slice(0, 1).map((label) => ({ label, type: 'domain' as SkillTagType })),
    { label: skill.statusLabel, type: 'status' },
  ];

  const hiddenCount = Math.max(skill.intentLabels.length - 1, 0)
    + Math.max(skill.capabilityLabels.length - 2, 0)
    + Math.max(skill.domainLabels.length - 1, 0);

  return { tags, hiddenCount };
}

export default function SkillsDashboard() {
  const { i18n } = useTranslation();
  const localeKey = useMemo(() => resolveLocaleKey(i18n.language || 'en'), [i18n.language]);
  const text = UI_TEXT[localeKey];

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [hasSkillRoots, setHasSkillRoots] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeIntent, setActiveIntent] = useState('all');
  const [activeCapability, setActiveCapability] = useState('all');
  const [activeDomain, setActiveDomain] = useState('all');
  const [activeSource, setActiveSource] = useState<'all' | 'vibelab' | 'imported'>('all');
  const [activeStatus, setActiveStatus] = useState('all');
  const [focusedSkill, setFocusedSkill] = useState<SkillExplorerItem | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importPath, setImportPath] = useState('~/.claude/skills');
  const [scanLoading, setScanLoading] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [scannedSkills, setScannedSkills] = useState<Array<{ name: string; hasSkillMd: boolean; alreadyImported: boolean }>>([]);
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set());
  const [importMessage, setImportMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [hasScanned, setHasScanned] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [editLoading, setEditLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [modalMessage, setModalMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadSkills = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      let tagMapping = EMPTY_TAG_MAPPING;
      try {
        const mappingResponse = await api.readGlobalSkillFile('skill-tag-mapping.json');
        if (mappingResponse.ok) {
          const mappingPayload = await mappingResponse.json();
          const mappingContent = mappingPayload?.content ?? '';
          tagMapping = parseTagMappingFile(JSON.parse(mappingContent));
        }
      } catch {
        tagMapping = EMPTY_TAG_MAPPING;
      }

      let taxonomyMap = new Map<string, SkillTaxonomyRecord>();
      let catalogRecordMap = new Map<string, SkillCatalogV2Record>();
      try {
        const catalogResponse = await api.readGlobalSkillFile('skills-catalog-v2.json');
        if (catalogResponse.ok) {
          const catalogPayload = await catalogResponse.json();
          const catalogContent = catalogPayload?.content ?? '';
          const catalog = JSON.parse(catalogContent || '{}') as SkillCatalogV2File;
          taxonomyMap = parseSkillCatalogV2(catalog, localeKey, text);
          for (const record of catalog.skills ?? []) {
            if (record.legacy?.dirPath) {
              catalogRecordMap.set(record.legacy.dirPath, record);
            }
            catalogRecordMap.set(record.name, record);
          }
        }
      } catch {
        taxonomyMap = new Map<string, SkillTaxonomyRecord>();
        catalogRecordMap = new Map<string, SkillCatalogV2Record>();
      }

      const treeResponse = await api.getGlobalSkills();
      if (!treeResponse.ok) {
        if (treeResponse.status === 404) {
          setHasSkillRoots(false);
          setSkills([]);
          return;
        }
        throw new Error(`Failed to load global skills (${treeResponse.status})`);
      }

      const responseContentType = treeResponse.headers.get('content-type') || '';
      if (!responseContentType.includes('application/json')) {
        throw new Error('Skills API returned non-JSON response. Please restart the backend and try again.');
      }

      const treeNodes = (await treeResponse.json()) as SkillNode[];
      const skillDirs = collectSkillDirectories(treeNodes);
      const skillsRoot = treeNodes.length > 0 && treeNodes[0].path
        ? treeNodes[0].path.replace(/[/\\][^/\\]+$/, '')
        : '';
      const normalizedSkillsRoot = skillsRoot.replace(/\\/g, '/');

      const extractedSkills = await Promise.all(
        skillDirs.map(async (node) => {
          const hasSkillMd = Boolean(findDirectFilePathByName(node, 'SKILL.md'));
          const skillName = node.name;
          const normalizedNodePath = node.path.replace(/\\/g, '/');

          let dirPath = skillName;
          if (normalizedSkillsRoot && normalizedNodePath.startsWith(`${normalizedSkillsRoot}/`)) {
            dirPath = normalizedNodePath.slice(normalizedSkillsRoot.length + 1);
          }

          let summary = '';
          let fullDescription = '';
          let tags: SkillTag[] = [];
          let taxonomy: SkillTaxonomyRecord | null = null;

          taxonomy = taxonomyMap.get(dirPath) ?? taxonomyMap.get(skillName) ?? null;

          if (hasSkillMd) {
            try {
              const fileResponse = await api.readGlobalSkillFile(`${dirPath}/SKILL.md`);
              if (fileResponse.ok) {
                const payload = await fileResponse.json();
                const parsed = extractSkillMetadata(payload.content || '', localeKey);
                summary = parsed.summary || '';
                fullDescription = parsed.fullDescription || '';
                tags = parsed.tags;
              }
            } catch {
              // Fallback summary below.
            }
          }

          if (!summary) {
            const catalogRecord = catalogRecordMap.get(dirPath) ?? catalogRecordMap.get(skillName);
            if (catalogRecord?.summary) {
              summary = catalogRecord.summary;
              fullDescription = catalogRecord.summary;
            }
          }

          if (!summary) {
            const fileCount = countFiles(node);
            summary = hasSkillMd
              ? text.fallbackDesc
              : text.fallbackNoSkillMd.replace('{{count}}', String(fileCount));
          }

          if (!fullDescription) {
            fullDescription = summary;
          }

          if (taxonomy) {
            tags = buildTaxonomyTags(taxonomy, tags.filter((tag) => tag.type === 'meta').map((tag) => tag.label));
          } else {
            tags = inferTags(skillName, summary, tags, localeKey, tagMapping);
          }

          return {
            name: skillName,
            dirPath,
            summary,
            fullDescription,
            tags,
            hasSkillMd,
            taxonomy,
          };
        })
      );

      setHasSkillRoots(skillDirs.length > 0);
      setSkills(extractedSkills.sort((a, b) => a.name.localeCompare(b.name)));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load skills';
      setError(message);
      setHasSkillRoots(false);
      setSkills([]);
    } finally {
      setLoading(false);
    }
  }, [localeKey, text, text.fallbackDesc, text.fallbackNoSkillMd]);

  const handleScanLocal = useCallback(async () => {
    setScanLoading(true);
    setImportMessage(null);
    setScannedSkills([]);
    setSelectedSkills(new Set());
    setHasScanned(false);

    try {
      const response = await api.scanLocalSkills(importPath);
      if (!response.ok) {
        const err = await response.json();
        setImportMessage({ type: 'error', text: err.error || 'Scan failed' });
        return;
      }

      const data = await response.json();
      setScannedSkills(data.skills || []);
      setHasScanned(true);

      const nextSelected = new Set<string>();
      for (const skill of data.skills || []) {
        if (!skill.alreadyImported) {
          nextSelected.add(skill.name);
        }
      }
      setSelectedSkills(nextSelected);
    } catch (err) {
      setImportMessage({ type: 'error', text: err instanceof Error ? err.message : 'Scan failed' });
    } finally {
      setScanLoading(false);
    }
  }, [importPath]);

  const handleImportSelected = useCallback(async () => {
    if (selectedSkills.size === 0) return;

    setImportLoading(true);
    setImportMessage(null);

    try {
      const response = await api.importLocalSkills(importPath, Array.from(selectedSkills));
      if (!response.ok) {
        const err = await response.json();
        setImportMessage({ type: 'error', text: err.error || 'Import failed' });
        return;
      }

      const data = await response.json();
      const messages: string[] = [];
      if (data.imported?.length > 0) {
        messages.push(text.importSuccess.replace('{{count}}', String(data.imported.length)));
      }
      if (data.skipped?.length > 0) {
        messages.push(text.importSkipped.replace('{{count}}', String(data.skipped.length)));
      }
      if (data.errors?.length > 0) {
        messages.push(`Errors: ${data.errors.join(', ')}`);
      }

      setImportMessage({
        type: data.errors?.length ? 'error' : 'success',
        text: messages.join('. '),
      });

      if (data.imported?.length > 0) {
        const rescan = await api.scanLocalSkills(importPath);
        if (rescan.ok) {
          const rescanData = await rescan.json();
          setScannedSkills(rescanData.skills || []);
          setSelectedSkills(new Set());
        }
        await loadSkills();
      }
    } catch (err) {
      setImportMessage({ type: 'error', text: err instanceof Error ? err.message : 'Import failed' });
    } finally {
      setImportLoading(false);
    }
  }, [importPath, loadSkills, selectedSkills, text.importSkipped, text.importSuccess]);

  const openImportModal = useCallback(() => {
    setShowImportModal(true);
    setScannedSkills([]);
    setSelectedSkills(new Set());
    setImportMessage(null);
    setHasScanned(false);
  }, []);

  const handleStartEdit = useCallback(async () => {
    if (!focusedSkill || !focusedSkill.hasSkillMd) return;

    setEditLoading(true);
    setModalMessage(null);
    try {
      const response = await api.readGlobalSkillFile(`${focusedSkill.dirPath}/SKILL.md`);
      if (response.ok) {
        const payload = await response.json();
        setEditContent(payload.content || '');
        setIsEditing(true);
      } else {
        const errBody = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        setModalMessage({ type: 'error', text: errBody.error || `Could not load SKILL.md (${response.status})` });
      }
    } catch (err) {
      setModalMessage({ type: 'error', text: err instanceof Error ? err.message : 'Load failed' });
    } finally {
      setEditLoading(false);
    }
  }, [focusedSkill]);

  const handleSaveEdit = useCallback(async () => {
    if (!focusedSkill || !focusedSkill.hasSkillMd) return;

    setEditLoading(true);
    setModalMessage(null);
    try {
      const response = await api.saveGlobalSkillFile(`${focusedSkill.dirPath}/SKILL.md`, editContent);
      if (response.ok) {
        setModalMessage({ type: 'success', text: text.skillSaved.replace('{{name}}', focusedSkill.name) });
        setIsEditing(false);
        await loadSkills();
      } else {
        const err = await response.json();
        setModalMessage({ type: 'error', text: err.error || 'Save failed' });
      }
    } catch (err) {
      setModalMessage({ type: 'error', text: err instanceof Error ? err.message : 'Save failed' });
    } finally {
      setEditLoading(false);
    }
  }, [editContent, focusedSkill, loadSkills, text.skillSaved]);

  const handleCancelEdit = useCallback(() => {
    setIsEditing(false);
    setEditContent('');
    setModalMessage(null);
  }, []);

  const handleDeleteSkill = useCallback(async () => {
    if (!focusedSkill) return;
    if (!confirm(text.confirmDeleteSkill.replace('{{name}}', focusedSkill.name))) return;

    setDeleteLoading(true);
    setModalMessage(null);
    try {
      const response = await api.deleteGlobalSkill(focusedSkill.dirPath);
      if (response.ok) {
        setIsEditing(false);
        setEditContent('');
        setModalMessage({ type: 'success', text: text.skillDeleted.replace('{{name}}', focusedSkill.name) });
        await loadSkills();
      } else {
        const err = await response.json();
        setModalMessage({ type: 'error', text: err.error || 'Delete failed' });
      }
    } catch (err) {
      setModalMessage({ type: 'error', text: err instanceof Error ? err.message : 'Delete failed' });
    } finally {
      setDeleteLoading(false);
    }
  }, [focusedSkill, loadSkills, text.confirmDeleteSkill, text.skillDeleted]);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  useEffect(() => {
    setActiveIntent('all');
    setActiveCapability('all');
    setActiveDomain('all');
    setActiveStatus('all');
  }, [localeKey]);

  const explorerSkills = useMemo(
    () => buildExplorerSkills(skills, {
      standaloneLabel: text.standaloneGroup,
      defaultDomainLabel: text.defaultDomain,
      sourcePlatformShort: text.sourcePlatformShort,
      sourceImportedShort: text.sourceImportedShort,
    }),
    [skills, text.defaultDomain, text.sourceImportedShort, text.sourcePlatformShort, text.standaloneGroup]
  );

  const skillLookup = useMemo(
    () => new Map(explorerSkills.map((skill) => [skill.dirPath, skill])),
    [explorerSkills]
  );

  const allCollectionOptions = useMemo(
    () => buildFacetOptions(explorerSkills, (skill) => ({ key: skill.primaryIntentKey, label: skill.primaryIntentLabel })),
    [explorerSkills]
  );
  const allGroupOptions = useMemo(
    () => buildMultiFacetOptions(explorerSkills, (skill) => skill.capabilityKeys.map((key, index) => ({ key, label: skill.capabilityLabels[index] }))),
    [explorerSkills]
  );
  const allDomainOptions = useMemo(
    () => buildMultiFacetOptions(explorerSkills, (skill) => skill.domainKeys.map((key, index) => ({ key, label: skill.domainLabels[index] }))),
    [explorerSkills]
  );
  const allStatusOptions = useMemo(
    () => buildFacetOptions(explorerSkills, (skill) => ({ key: skill.statusKey, label: skill.statusLabel })),
    [explorerSkills]
  );

  const collectionLookup = useMemo(
    () => new Map(allCollectionOptions.map((option) => [option.key, option.label])),
    [allCollectionOptions]
  );
  const groupLookup = useMemo(
    () => new Map(allGroupOptions.map((option) => [option.key, option.label])),
    [allGroupOptions]
  );
  const domainLookup = useMemo(
    () => new Map(allDomainOptions.map((option) => [option.key, option.label])),
    [allDomainOptions]
  );
  const statusLookup = useMemo(
    () => new Map(allStatusOptions.map((option) => [option.key, option.label])),
    [allStatusOptions]
  );

  const searchFilteredSkills = useMemo(() => {
    const query = searchQuery.trim();
    if (!query) {
      return sortSkillsForBrowse(explorerSkills);
    }

    return explorerSkills
      .map((skill) => ({ skill, score: scoreSkillMatch(skill, query) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name))
      .map((entry) => entry.skill);
  }, [explorerSkills, searchQuery]);

  const collectionOptions = useMemo(
    () => buildFacetOptions(searchFilteredSkills, (skill) => ({ key: skill.primaryIntentKey, label: skill.primaryIntentLabel })),
    [searchFilteredSkills]
  );
  const groupOptions = useMemo(
    () => buildMultiFacetOptions(searchFilteredSkills, (skill) => skill.capabilityKeys.map((key, index) => ({ key, label: skill.capabilityLabels[index] }))),
    [searchFilteredSkills]
  );
  const domainOptions = useMemo(
    () => buildMultiFacetOptions(searchFilteredSkills, (skill) => skill.domainKeys.map((key, index) => ({ key, label: skill.domainLabels[index] }))),
    [searchFilteredSkills]
  );
  const statusOptions = useMemo(
    () => buildFacetOptions(searchFilteredSkills, (skill) => ({ key: skill.statusKey, label: skill.statusLabel })),
    [searchFilteredSkills]
  );

  const filteredSkills = useMemo(() => {
    return searchFilteredSkills.filter((skill) => {
      if (activeSource !== 'all' && skill.sourceKey !== activeSource) return false;
      if (activeIntent !== 'all' && skill.primaryIntentKey !== activeIntent) return false;
      if (activeCapability !== 'all' && !skill.capabilityKeys.includes(activeCapability)) return false;
      if (activeDomain !== 'all' && !skill.domainKeys.includes(activeDomain)) return false;
      if (activeStatus !== 'all' && skill.statusKey !== activeStatus) return false;
      return true;
    });
  }, [activeCapability, activeDomain, activeIntent, activeSource, activeStatus, searchFilteredSkills]);

  const verifiedCount = useMemo(
    () => explorerSkills.filter((skill) => skill.statusKey === 'verified').length,
    [explorerSkills]
  );

  const hasActiveFilters = Boolean(searchQuery.trim())
    || activeSource !== 'all'
    || activeIntent !== 'all'
    || activeCapability !== 'all'
    || activeDomain !== 'all'
    || activeStatus !== 'all';

  const activeFilterLabels = useMemo(() => {
    const labels: string[] = [];

    if (activeSource === 'vibelab') {
      labels.push(`${text.sourceField}: ${text.sourcePlatformShort}`);
    }
    if (activeSource === 'imported') {
      labels.push(`${text.sourceField}: ${text.sourceImportedShort}`);
    }
    if (activeIntent !== 'all') {
      labels.push(`${text.primaryIntentField}: ${collectionLookup.get(activeIntent) ?? activeIntent}`);
    }
    if (activeCapability !== 'all') {
      labels.push(`${text.capabilitiesField}: ${groupLookup.get(activeCapability) ?? activeCapability}`);
    }
    if (activeDomain !== 'all') {
      labels.push(`${text.domainField}: ${domainLookup.get(activeDomain) ?? activeDomain}`);
    }
    if (activeStatus !== 'all') {
      labels.push(`${text.statusField}: ${statusLookup.get(activeStatus) ?? activeStatus}`);
    }

    return labels;
  }, [
    activeCapability,
    activeDomain,
    activeIntent,
    activeSource,
    activeStatus,
    domainLookup,
    groupLookup,
    collectionLookup,
    statusLookup,
    text.capabilitiesField,
    text.domainField,
    text.primaryIntentField,
    text.statusField,
    text.sourceField,
    text.sourceImportedShort,
    text.sourcePlatformShort,
  ]);

  const headerSummary = useMemo(() => {
    if (!hasSkillRoots) return text.noRoots;
    return text.headerCount
      .replace('{{shown}}', String(filteredSkills.length))
      .replace('{{total}}', String(skills.length));
  }, [filteredSkills.length, hasSkillRoots, skills.length, text.headerCount, text.noRoots]);

  useEffect(() => {
    setFocusedSkill((current) => {
      if (explorerSkills.length === 0) {
        return null;
      }

      const refreshedCurrent = current ? skillLookup.get(current.dirPath) ?? null : null;
      if (refreshedCurrent) {
        if (isEditing) {
          return refreshedCurrent;
        }
        if (filteredSkills.some((skill) => skill.dirPath === refreshedCurrent.dirPath)) {
          return refreshedCurrent;
        }
        return filteredSkills[0] ?? refreshedCurrent;
      }

      return filteredSkills[0] ?? explorerSkills[0] ?? null;
    });
  }, [explorerSkills, filteredSkills, isEditing, skillLookup]);

  const handleSelectSkill = useCallback((skill: SkillExplorerItem) => {
    if (isEditing && focusedSkill && focusedSkill.dirPath !== skill.dirPath) {
      if (!confirm(text.discardChanges)) {
        return;
      }
    }
    setFocusedSkill(skill);
    setIsEditing(false);
    setEditContent('');
    setModalMessage(null);
  }, [focusedSkill, isEditing, text.discardChanges]);

  const clearAllFilters = useCallback(() => {
    setSearchQuery('');
    setActiveSource('all');
    setActiveIntent('all');
    setActiveCapability('all');
    setActiveDomain('all');
    setActiveStatus('all');
  }, []);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {text.loading}
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto bg-background">
      <div className="mx-auto max-w-[1600px] p-4 sm:p-6">
        <div className="relative mb-5 overflow-hidden rounded-[28px] border border-border/80 bg-[radial-gradient(circle_at_top_left,_rgba(125,211,252,0.24),_transparent_36%),linear-gradient(135deg,_rgba(248,250,252,0.95),_rgba(240,249,255,0.9))] p-5 shadow-sm dark:bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.18),_transparent_34%),linear-gradient(135deg,_rgba(2,6,23,0.96),_rgba(15,23,42,0.92))]">
          <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-sky-200/50 blur-3xl dark:bg-sky-500/20" />
          <div className="absolute bottom-0 right-20 h-24 w-24 rounded-full bg-emerald-200/40 blur-2xl dark:bg-emerald-500/10" />

          <div className="relative flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0 flex-1">
              <div className="inline-flex items-center gap-2 rounded-full border border-sky-200/70 bg-white/80 px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] text-sky-700 shadow-sm dark:border-sky-800/60 dark:bg-slate-950/60 dark:text-sky-200">
                <Sparkles className="h-3.5 w-3.5" />
                {text.title}
              </div>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
                {text.subtitle}
              </p>
              <p className="mt-3 text-sm font-medium text-foreground">{headerSummary}</p>

              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-white/80 bg-white/80 p-4 shadow-sm backdrop-blur dark:border-white/10 dark:bg-slate-950/50">
                  <p className="text-xl font-semibold text-foreground">{skills.length}</p>
                  <p className="mt-1 text-xs uppercase tracking-[0.2em] text-muted-foreground">{text.allSkills}</p>
                </div>
                <div className="rounded-2xl border border-white/80 bg-white/80 p-4 shadow-sm backdrop-blur dark:border-white/10 dark:bg-slate-950/50">
                  <p className="text-xl font-semibold text-foreground">{allCollectionOptions.length}</p>
                  <p className="mt-1 text-xs uppercase tracking-[0.2em] text-muted-foreground">
                    {text.summaryIntents.replace('{{count}}', String(allCollectionOptions.length))}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/80 bg-white/80 p-4 shadow-sm backdrop-blur dark:border-white/10 dark:bg-slate-950/50">
                  <p className="text-xl font-semibold text-foreground">{allGroupOptions.length}</p>
                  <p className="mt-1 text-xs uppercase tracking-[0.2em] text-muted-foreground">
                    {text.summaryCapabilities.replace('{{count}}', String(allGroupOptions.length))}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/80 bg-white/80 p-4 shadow-sm backdrop-blur dark:border-white/10 dark:bg-slate-950/50">
                  <p className="text-xl font-semibold text-foreground">{verifiedCount}</p>
                  <p className="mt-1 text-xs uppercase tracking-[0.2em] text-muted-foreground">
                    {text.summaryVerified.replace('{{count}}', String(verifiedCount))}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <button
                onClick={openImportModal}
                className="inline-flex items-center gap-2 rounded-xl border border-border bg-background/85 px-4 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted"
              >
                <Download className="h-4 w-4" />
                {text.importLocal}
              </button>
              <button
                onClick={loadSkills}
                className="inline-flex items-center gap-2 rounded-xl border border-border bg-background/85 px-4 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted"
              >
                <RefreshCw className="h-4 w-4" />
                {text.refresh}
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-red-300/60 bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
            {error}
          </div>
        )}

        {!hasSkillRoots && !error && (
          <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            {text.notFoundRoots}
          </div>
        )}

        {hasSkillRoots && skills.length === 0 && !error && (
          <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            {text.noSkills}
          </div>
        )}

        {skills.length > 0 && (
          <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)_420px]">
            <aside className="space-y-4 xl:sticky xl:top-6 xl:max-h-[calc(100vh-3rem)] xl:self-start xl:overflow-y-auto xl:pr-1">
              <div className="rounded-2xl border border-border/80 bg-card/95 p-4 shadow-sm">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={text.searchPlaceholder}
                    className="w-full rounded-xl border border-border bg-background pl-9 pr-9 py-2.5 text-sm text-foreground outline-none transition focus:ring-2 focus:ring-sky-300/70 dark:focus:ring-sky-700/70"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-muted"
                      aria-label={text.clearSearch}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={clearAllFilters}
                    className="mt-3 inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    {text.clearFilters}
                  </button>
                )}
              </div>

              <div className="rounded-2xl border border-border/80 bg-card/95 p-4 shadow-sm">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Layers className="h-4 w-4 text-sky-600" />
                  {text.quickViews}
                </div>
                <div className="space-y-2">
                  {[
                    {
                      key: 'all',
                      label: text.allSkills,
                      count: searchFilteredSkills.length,
                      active: activeSource === 'all' && activeIntent === 'all' && activeCapability === 'all' && activeDomain === 'all' && activeStatus === 'all',
                      onClick: () => {
                        setActiveSource('all');
                        setActiveIntent('all');
                        setActiveCapability('all');
                        setActiveDomain('all');
                        setActiveStatus('all');
                      },
                    },
                    {
                      key: 'verified',
                      label: text.verifiedSkills,
                      count: searchFilteredSkills.filter((skill) => skill.statusKey === 'verified').length,
                      active: activeStatus === 'verified' && activeSource === 'all' && activeIntent === 'all' && activeCapability === 'all' && activeDomain === 'all',
                      onClick: () => {
                        setActiveSource('all');
                        setActiveIntent('all');
                        setActiveCapability('all');
                        setActiveDomain('all');
                        setActiveStatus('verified');
                      },
                    },
                    {
                      key: 'community',
                      label: text.communitySkills,
                      count: searchFilteredSkills.filter((skill) => skill.sourceKey === 'imported').length,
                      active: activeSource === 'imported' && activeIntent === 'all' && activeCapability === 'all' && activeDomain === 'all' && activeStatus === 'all',
                      onClick: () => {
                        setActiveSource('imported');
                        setActiveIntent('all');
                        setActiveCapability('all');
                        setActiveDomain('all');
                        setActiveStatus('all');
                      },
                    },
                    {
                      key: 'native',
                      label: text.nativeSkills,
                      count: searchFilteredSkills.filter((skill) => skill.sourceKey === 'vibelab').length,
                      active: activeSource === 'vibelab' && activeIntent === 'all' && activeCapability === 'all' && activeDomain === 'all' && activeStatus === 'all',
                      onClick: () => {
                        setActiveSource('vibelab');
                        setActiveIntent('all');
                        setActiveCapability('all');
                        setActiveDomain('all');
                        setActiveStatus('all');
                      },
                    },
                  ].map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={item.onClick}
                      className={facetButtonClass(item.active)}
                    >
                      <span>{item.label}</span>
                      <span className="text-xs text-muted-foreground">{item.count}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-border/80 bg-card/95 p-4 shadow-sm">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Sparkles className="h-4 w-4 text-amber-600" />
                  {text.intents}
                </div>
                <div className="max-h-[320px] space-y-2 overflow-auto pr-1">
                  <button
                    type="button"
                    onClick={() => setActiveIntent('all')}
                    className={facetButtonClass(activeIntent === 'all')}
                  >
                    <span>{text.allIntents}</span>
                    <span className="text-xs text-muted-foreground">{searchFilteredSkills.length}</span>
                  </button>
                  {collectionOptions.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => setActiveIntent(option.key)}
                      className={facetButtonClass(activeIntent === option.key)}
                    >
                      <span className="min-w-0 truncate">{option.label}</span>
                      <span className="text-xs text-muted-foreground">{option.count}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-border/80 bg-card/95 p-4 shadow-sm">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                  <FolderTree className="h-4 w-4 text-emerald-600" />
                  {text.capabilities}
                </div>
                <div className="max-h-[320px] space-y-2 overflow-auto pr-1">
                  <button
                    type="button"
                    onClick={() => setActiveCapability('all')}
                    className={facetButtonClass(activeCapability === 'all')}
                  >
                    <span>{text.allCapabilities}</span>
                    <span className="text-xs text-muted-foreground">{searchFilteredSkills.length}</span>
                  </button>
                  {groupOptions.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => setActiveCapability(option.key)}
                      className={facetButtonClass(activeCapability === option.key)}
                    >
                      <span className="min-w-0 truncate">{option.label}</span>
                      <span className="text-xs text-muted-foreground">{option.count}</span>
                    </button>
                  ))}
                </div>
              </div>

              {domainOptions.length > 1 && (
                <div className="rounded-2xl border border-border/80 bg-card/95 p-4 shadow-sm">
                  <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Compass className="h-4 w-4 text-violet-600" />
                    {text.domains}
                  </div>
                  <div className="max-h-[260px] space-y-2 overflow-auto pr-1">
                    <button
                      type="button"
                      onClick={() => setActiveDomain('all')}
                      className={facetButtonClass(activeDomain === 'all')}
                    >
                      <span>{text.allDomains}</span>
                      <span className="text-xs text-muted-foreground">{searchFilteredSkills.length}</span>
                    </button>
                    {domainOptions.map((option) => (
                      <button
                        key={option.key}
                        type="button"
                        onClick={() => setActiveDomain(option.key)}
                        className={facetButtonClass(activeDomain === option.key)}
                      >
                        <span className="min-w-0 truncate">{option.label}</span>
                        <span className="text-xs text-muted-foreground">{option.count}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {statusOptions.length > 1 && (
                <div className="rounded-2xl border border-border/80 bg-card/95 p-4 shadow-sm">
                  <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Check className="h-4 w-4 text-rose-600" />
                    {text.statuses}
                  </div>
                  <div className="max-h-[220px] space-y-2 overflow-auto pr-1">
                    <button
                      type="button"
                      onClick={() => setActiveStatus('all')}
                      className={facetButtonClass(activeStatus === 'all')}
                    >
                      <span>{text.allStatuses}</span>
                      <span className="text-xs text-muted-foreground">{searchFilteredSkills.length}</span>
                    </button>
                    {statusOptions.map((option) => (
                      <button
                        key={option.key}
                        type="button"
                        onClick={() => setActiveStatus(option.key)}
                        className={facetButtonClass(activeStatus === option.key)}
                      >
                        <span className="min-w-0 truncate">{option.label}</span>
                        <span className="text-xs text-muted-foreground">{option.count}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </aside>

            <section className="min-w-0 space-y-4">
              <div className="rounded-2xl border border-border/80 bg-card/95 p-4 shadow-sm">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-[0.24em] text-sky-600 dark:text-sky-300">{text.results}</p>
                    <h3 className="mt-1 text-xl font-semibold text-foreground">{headerSummary}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {text.resultsSummary.replace('{{shown}}', String(filteredSkills.length))}
                    </p>
                  </div>

                  {activeFilterLabels.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {activeFilterLabels.map((label) => (
                        <span
                          key={label}
                          className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700 dark:border-sky-900/80 dark:bg-sky-950/50 dark:text-sky-200"
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {filteredSkills.length === 0 && (
                <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground shadow-sm">
                  {text.noFilterResult}
                </div>
              )}

              {filteredSkills.length > 0 && (
                <div className="overflow-hidden rounded-2xl border border-border/80 bg-card/95 shadow-sm">
                  <div className="divide-y divide-border/60">
                    {filteredSkills.map((skill) => {
                      const isFocused = focusedSkill?.dirPath === skill.dirPath;
                      const { tags: cardTags, hiddenCount } = buildSkillCardTagSummary(skill);
                      return (
                        <button
                          key={skill.dirPath}
                          type="button"
                          onClick={() => handleSelectSkill(skill)}
                          className={`flex w-full items-start justify-between gap-4 px-4 py-4 text-left transition ${
                            isFocused
                              ? 'bg-sky-50/80 dark:bg-sky-950/25'
                              : 'hover:bg-slate-50 dark:hover:bg-slate-900/40'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h4 className="break-all text-sm font-semibold text-foreground">{skill.name}</h4>
                              {cardTags.map((tag) => (
                                <span
                                  key={`${skill.dirPath}-${tag.type}-${tag.label}`}
                                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${tagStyleClass(tag.type, tag.label)}`}
                                >
                                  {tag.label}
                                </span>
                              ))}
                              {hiddenCount > 0 && (
                                <span className="inline-flex items-center rounded-full border border-border/70 bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                                  +{hiddenCount}
                                </span>
                              )}
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">{`skills/${skill.dirPath}`}</p>
                            <p
                              className="mt-3 text-sm leading-6 text-muted-foreground"
                              style={{
                                display: '-webkit-box',
                                WebkitLineClamp: 3,
                                WebkitBoxOrient: 'vertical',
                                overflow: 'hidden',
                              }}
                            >
                              {skill.summary}
                            </p>
                          </div>
                          <ChevronRight className={`mt-1 h-4 w-4 shrink-0 ${isFocused ? 'text-sky-600 dark:text-sky-300' : 'text-muted-foreground'}`} />
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>

            <aside className="min-w-0 xl:sticky xl:top-6 xl:max-h-[calc(100vh-3rem)] xl:self-start xl:overflow-y-auto xl:pr-1">
              <div className="overflow-hidden rounded-2xl border border-border/80 bg-card/95 shadow-sm">
                {!focusedSkill && (
                  <div className="p-6 text-sm text-muted-foreground">{text.emptySelection}</div>
                )}

                {focusedSkill && (
                  <>
                    <div className="border-b border-border/60 p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-medium uppercase tracking-[0.24em] text-sky-600 dark:text-sky-300">{text.detailTitle}</p>
                          <h3 className="mt-2 break-all text-xl font-semibold text-foreground">{focusedSkill.name}</h3>
                          <p className="mt-2 text-sm leading-6 text-muted-foreground">{focusedSkill.summary}</p>
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium ${tagStyleClass('intent', focusedSkill.primaryIntentLabel)}`}>
                              {focusedSkill.primaryIntentLabel}
                            </span>
                            <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium ${tagStyleClass('status', focusedSkill.statusLabel)}`}>
                              {focusedSkill.statusLabel}
                            </span>
                            <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium ${tagStyleClass('source', focusedSkill.sourceLabel)}`}>
                              {focusedSkill.sourceLabel}
                            </span>
                          </div>
                        </div>
                        <div className="flex flex-wrap justify-end gap-2">
                          {!isEditing && (
                            <>
                              <button
                                type="button"
                                onClick={handleStartEdit}
                                disabled={editLoading || !focusedSkill.hasSkillMd}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                                title={focusedSkill.hasSkillMd ? text.editSkill : text.noSkillFile}
                              >
                                {editLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Edit3 className="h-3.5 w-3.5" />}
                                {text.editSkill}
                              </button>
                              <button
                                type="button"
                                onClick={handleDeleteSkill}
                                disabled={deleteLoading}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-2 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/30 disabled:opacity-50"
                              >
                                {deleteLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                                {text.deleteSkill}
                              </button>
                            </>
                          )}
                          {isEditing && (
                            <>
                              <button
                                type="button"
                                onClick={handleSaveEdit}
                                disabled={editLoading}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-sky-700 disabled:opacity-50"
                              >
                                {editLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                                {editLoading ? text.saving : text.saveSkill}
                              </button>
                              <button
                                type="button"
                                onClick={handleCancelEdit}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                              >
                                {text.cancelEdit}
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-5 p-5">
                      {modalMessage && (
                        <div className={`rounded-md border px-3 py-2 text-sm ${modalMessage.type === 'success' ? 'border-green-300/60 bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300' : 'border-red-300/60 bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'}`}>
                          {modalMessage.text}
                        </div>
                      )}

                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="rounded-xl border border-border/70 bg-muted/30 p-3">
                          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{text.primaryIntentField}</p>
                          <p className="mt-1 text-sm font-medium text-foreground">{focusedSkill.primaryIntentLabel}</p>
                        </div>
                        <div className="rounded-xl border border-border/70 bg-muted/30 p-3">
                          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{text.intentsField}</p>
                          <p className="mt-1 text-sm font-medium text-foreground">{focusedSkill.intentLabels.join(', ')}</p>
                        </div>
                        <div className="rounded-xl border border-border/70 bg-muted/30 p-3">
                          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{text.statusField}</p>
                          <p className="mt-1 text-sm font-medium text-foreground">{focusedSkill.statusLabel}</p>
                        </div>
                        <div className="rounded-xl border border-border/70 bg-muted/30 p-3">
                          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{text.domainField}</p>
                          <p className="mt-1 text-sm font-medium text-foreground">{focusedSkill.domainLabels.join(', ')}</p>
                        </div>
                        <div className="rounded-xl border border-border/70 bg-muted/30 p-3">
                          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{text.sourceField}</p>
                          <p className="mt-1 text-sm font-medium text-foreground">{focusedSkill.sourceLabel}</p>
                        </div>
                        <div className="rounded-xl border border-border/70 bg-muted/30 p-3 sm:col-span-2">
                          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{text.capabilitiesField}</p>
                          <p className="mt-1 text-sm font-medium text-foreground">{focusedSkill.capabilityLabels.join(', ') || '—'}</p>
                        </div>
                        {focusedSkill.owner && (
                          <div className="rounded-xl border border-border/70 bg-muted/30 p-3 sm:col-span-2">
                            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{text.ownerField}</p>
                            <p className="mt-1 text-sm font-medium text-foreground">{focusedSkill.owner}</p>
                          </div>
                        )}
                      </div>

                      <div className="rounded-xl border border-border/70 bg-muted/30 p-3">
                        <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{text.pathField}</p>
                        <p className="mt-1 break-all text-sm font-medium text-foreground">{`skills/${focusedSkill.dirPath}`}</p>
                      </div>

                      <div className="rounded-xl border border-border/70 bg-muted/30 p-3">
                        <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{text.legacyField}</p>
                        <p className="mt-1 text-sm font-medium text-foreground">
                          {`${focusedSkill.legacyCollectionLabel} / ${focusedSkill.legacyGroupLabel}`}
                        </p>
                      </div>

                      {!focusedSkill.hasSkillMd && !isEditing && (
                        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                          {text.noSkillFile}
                        </div>
                      )}

                      {isEditing ? (
                        <textarea
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          className="min-h-[360px] w-full resize-y rounded-xl border border-border/70 bg-background p-4 font-mono text-sm leading-6 text-foreground outline-none transition focus:ring-2 focus:ring-sky-300/70 dark:focus:ring-sky-700/70"
                          spellCheck={false}
                        />
                      ) : (
                        <>
                          <div className="grid gap-5">
                            <DetailChipSection
                              title={text.intentsField}
                              values={focusedSkill.intentLabels}
                              type="intent"
                            />
                            <DetailChipSection
                              title={text.capabilitiesField}
                              values={focusedSkill.capabilityLabels}
                              type="capability"
                            />
                            <DetailChipSection
                              title={text.domainField}
                              values={focusedSkill.domainLabels}
                              type="domain"
                            />
                            <DetailChipSection
                              title={text.keywordsField}
                              values={focusedSkill.keywordLabels}
                              type="meta"
                            />
                            {!focusedSkill.taxonomy && focusedSkill.tags.length > 0 && (
                              <div>
                                <h4 className="text-sm font-semibold text-foreground">{text.rawTagsField}</h4>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  {focusedSkill.tags.map((tag) => (
                                    <span
                                      key={`${focusedSkill.dirPath}-detail-${tag.label}`}
                                      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium ${tagStyleClass(tag.type, tag.label)}`}
                                    >
                                      {tag.label}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>

                          <div>
                            <h4 className="text-sm font-semibold text-foreground">{text.overview}</h4>
                            <div className="mt-2 max-h-[38vh] overflow-auto rounded-xl border border-border/70 bg-muted/30 p-4">
                              <p className="whitespace-pre-wrap text-sm leading-7 text-foreground">{focusedSkill.fullDescription}</p>
                            </div>
                          </div>

                          {focusedSkill.relatedSkills.length > 0 && (
                            <div>
                              <h4 className="text-sm font-semibold text-foreground">{text.relatedSkills}</h4>
                              <div className="mt-2 space-y-2">
                                {focusedSkill.relatedSkills.map((relation) => {
                                  const relatedSkill = skillLookup.get(relation.dirPath);
                                  if (!relatedSkill) return null;

                                  return (
                                    <button
                                      key={relation.dirPath}
                                      type="button"
                                      onClick={() => handleSelectSkill(relatedSkill)}
                                      className="flex w-full items-start justify-between gap-3 rounded-xl border border-border/70 bg-background px-3 py-3 text-left transition hover:bg-muted/60"
                                    >
                                      <div className="min-w-0">
                                        <p className="break-all text-sm font-medium text-foreground">{relatedSkill.name}</p>
                                        <p className="mt-1 text-xs text-muted-foreground">{relation.reason}</p>
                                      </div>
                                      <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            </aside>
          </div>
        )}
      </div>

      {showImportModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={() => setShowImportModal(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-border bg-card p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-foreground">{text.importModalTitle}</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="rounded-md border border-border p-1.5 text-muted-foreground hover:bg-muted"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mb-4">
              <label className="mb-1.5 block text-sm font-medium text-foreground">{text.pathLabel}</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={importPath}
                  onChange={(e) => setImportPath(e.target.value)}
                  className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:ring-2 focus:ring-sky-300/70 dark:focus:ring-sky-700/70"
                  placeholder="~/.claude/skills"
                />
                <button
                  onClick={handleScanLocal}
                  disabled={scanLoading || !importPath.trim()}
                  className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {scanLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  {scanLoading ? text.scanning : text.scan}
                </button>
              </div>
            </div>

            {importMessage && (
              <div className={`mb-4 rounded-md border px-3 py-2 text-sm ${importMessage.type === 'success' ? 'border-green-300/60 bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300' : 'border-red-300/60 bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'}`}>
                {importMessage.text}
              </div>
            )}

            {hasScanned && scannedSkills.length === 0 && (
              <div className="mb-4 rounded-md border border-border bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
                {text.noSkillsFound}
              </div>
            )}

            {scannedSkills.length > 0 && (
              <div className="mb-4 max-h-[40vh] overflow-auto rounded-lg border border-border/70">
                {scannedSkills.map((skill) => (
                  <label
                    key={skill.name}
                    className={`flex items-center gap-3 border-b border-border/50 px-3 py-2.5 last:border-b-0 transition-colors ${skill.alreadyImported ? 'opacity-60' : 'cursor-pointer hover:bg-muted/50'}`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedSkills.has(skill.name)}
                      disabled={skill.alreadyImported}
                      onChange={(e) => {
                        const next = new Set(selectedSkills);
                        if (e.target.checked) {
                          next.add(skill.name);
                        } else {
                          next.delete(skill.name);
                        }
                        setSelectedSkills(next);
                      }}
                      className="rounded border-border"
                    />
                    <div className="min-w-0 flex-1">
                      <span className="text-sm font-medium text-foreground">{skill.name}</span>
                      <div className="mt-0.5 flex items-center gap-2">
                        {skill.hasSkillMd && (
                          <span className="text-[11px] text-muted-foreground">SKILL.md</span>
                        )}
                        {skill.alreadyImported && (
                          <span className="inline-flex items-center gap-1 text-[11px] text-green-600 dark:text-green-400">
                            <Check className="h-3 w-3" />
                            {text.alreadyImported}
                          </span>
                        )}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            )}

            {scannedSkills.length > 0 && (
              <div className="flex justify-end">
                <button
                  onClick={handleImportSelected}
                  disabled={importLoading || selectedSkills.size === 0}
                  className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {importLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  {importLoading ? text.importing : `${text.importSelected} (${selectedSkills.size})`}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
