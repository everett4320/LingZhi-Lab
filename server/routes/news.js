import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { credentialsDb } from '../database/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Data directory for news config & results
const DATA_DIR = path.join(__dirname, '..', 'data');
const SKILLS_DIR = path.join(__dirname, '..', '..', 'skills');

// ---------------------------------------------------------------------------
// Source Registry
// ---------------------------------------------------------------------------
const SOURCE_REGISTRY = {
  arxiv: {
    label: 'arXiv',
    script: 'research-news/scripts/search_arxiv.py',
    configFile: 'news-config-arxiv.json',
    resultsFile: 'news-results-arxiv.json',
    defaultConfig: {
      research_domains: {
        'Large Language Models': {
          keywords: ['large language model', 'LLM', 'transformer', 'foundation model'],
          arxiv_categories: ['cs.AI', 'cs.LG', 'cs.CL'],
          priority: 5,
        },
        'Multimodal': {
          keywords: ['vision-language', 'multimodal', 'image-text', 'visual'],
          arxiv_categories: ['cs.CV', 'cs.MM', 'cs.CL'],
          priority: 4,
        },
        'AI Agents': {
          keywords: ['agent', 'multi-agent', 'orchestration', 'autonomous', 'planning'],
          arxiv_categories: ['cs.AI', 'cs.MA', 'cs.RO'],
          priority: 4,
        },
      },
      top_n: 10,
      max_results: 200,
      categories: 'cs.AI,cs.LG,cs.CL,cs.CV,cs.MM,cs.MA,cs.RO',
    },
    requiresCredentials: false,
  },
  huggingface: {
    label: 'HuggingFace',
    script: 'research-news/scripts/search_huggingface.py',
    configFile: 'news-config-huggingface.json',
    resultsFile: 'news-results-huggingface.json',
    defaultConfig: {
      research_domains: {
        'Large Language Models': {
          keywords: ['large language model', 'LLM', 'transformer', 'foundation model'],
          arxiv_categories: [],
          priority: 5,
        },
        'Multimodal': {
          keywords: ['vision-language', 'multimodal', 'image-text', 'visual'],
          arxiv_categories: [],
          priority: 4,
        },
        'AI Agents': {
          keywords: ['agent', 'multi-agent', 'orchestration', 'autonomous', 'planning'],
          arxiv_categories: [],
          priority: 4,
        },
      },
      top_n: 10,
    },
    requiresCredentials: false,
  },
  x: {
    label: 'X (Twitter)',
    script: 'research-news/scripts/search_x.py',
    configFile: 'news-config-x.json',
    resultsFile: 'news-results-x.json',
    defaultConfig: {
      research_domains: {
        'Large Language Models': {
          keywords: ['large language model', 'LLM', 'transformer', 'foundation model'],
          arxiv_categories: [],
          priority: 5,
        },
      },
      top_n: 10,
      queries: 'LLM,AI agents,foundation model',
      accounts: '',
    },
    requiresCredentials: true,
    credentialType: 'x_bearer_token',
  },
  xiaohongshu: {
    label: 'Xiaohongshu',
    script: 'research-news/scripts/search_xiaohongshu.py',
    configFile: 'news-config-xiaohongshu.json',
    resultsFile: 'news-results-xiaohongshu.json',
    defaultConfig: {
      research_domains: {
        'Large Language Models': {
          keywords: ['大模型', 'LLM', 'AI', '人工智能'],
          arxiv_categories: [],
          priority: 5,
        },
      },
      top_n: 10,
      keywords: '大模型,AI论文,人工智能',
    },
    requiresCredentials: true,
    credentialType: 'xiaohongshu_token',
  },
};

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

function getSourceEntry(source) {
  return SOURCE_REGISTRY[source] || null;
}

// ---------------------------------------------------------------------------
// GET /api/news/sources — list all sources with status
// ---------------------------------------------------------------------------
router.get('/sources', async (req, res) => {
  try {
    await ensureDataDir();
    const sources = [];
    for (const [key, entry] of Object.entries(SOURCE_REGISTRY)) {
      // Check if results file exists
      let hasResults = false;
      let lastSearchDate = null;
      try {
        const resultsPath = path.join(DATA_DIR, entry.resultsFile);
        const data = JSON.parse(await fs.readFile(resultsPath, 'utf8'));
        hasResults = (data.top_papers?.length ?? 0) > 0;
        lastSearchDate = data.search_date || null;
      } catch { /* no results yet */ }

      // Check credentials status for sources that need them
      let credentialStatus = 'not_required';
      if (entry.requiresCredentials) {
        try {
          const cred = credentialsDb.getActiveCredential(req.user.id, entry.credentialType);
          credentialStatus = cred ? 'configured' : 'missing';
        } catch {
          credentialStatus = 'missing';
        }
      }

      sources.push({
        key,
        label: entry.label,
        hasResults,
        lastSearchDate,
        requiresCredentials: entry.requiresCredentials,
        credentialType: entry.credentialType || null,
        credentialStatus,
      });
    }
    res.json({ sources });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list sources', details: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/news/config/:source — per-source config
// ---------------------------------------------------------------------------
router.get('/config/:source', async (req, res) => {
  try {
    const entry = getSourceEntry(req.params.source);
    if (!entry) return res.status(404).json({ error: `Unknown source: ${req.params.source}` });

    await ensureDataDir();
    const configPath = path.join(DATA_DIR, entry.configFile);
    const data = await fs.readFile(configPath, 'utf8');
    res.json(JSON.parse(data));
  } catch (err) {
    if (err.code === 'ENOENT') {
      const entry = getSourceEntry(req.params.source);
      res.json(entry.defaultConfig);
    } else {
      res.status(500).json({ error: 'Failed to read config', details: err.message });
    }
  }
});

// ---------------------------------------------------------------------------
// PUT /api/news/config/:source — save per-source config
// ---------------------------------------------------------------------------
router.put('/config/:source', async (req, res) => {
  try {
    const entry = getSourceEntry(req.params.source);
    if (!entry) return res.status(404).json({ error: `Unknown source: ${req.params.source}` });

    await ensureDataDir();
    const configPath = path.join(DATA_DIR, entry.configFile);
    await fs.writeFile(configPath, JSON.stringify(req.body, null, 2), 'utf8');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save config', details: err.message });
  }
});

// ---------------------------------------------------------------------------
// Search handler (shared by parameterized and legacy routes)
// ---------------------------------------------------------------------------
async function handleSearch(sourceName, req, res) {
  try {
    const entry = getSourceEntry(sourceName);
    if (!entry) return res.status(404).json({ error: `Unknown source: ${sourceName}` });

    await ensureDataDir();

    // Read current config
    const configPath = path.join(DATA_DIR, entry.configFile);
    let config;
    try {
      config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    } catch {
      config = entry.defaultConfig;
    }

    // Write JSON config for the Python script
    const tmpConfigPath = path.join(DATA_DIR, `research_interests_${sourceName}.json`);
    await fs.writeFile(tmpConfigPath, JSON.stringify(config, null, 2), 'utf8');

    const scriptPath = path.join(SKILLS_DIR, entry.script);

    // Check if script exists
    try {
      await fs.access(scriptPath);
    } catch {
      return res.status(404).json({ error: `Search script not found for source: ${sourceName}` });
    }

    const resultsPath = path.join(DATA_DIR, entry.resultsFile);
    const topN = config.top_n || 10;

    // Build args based on source
    const args = [scriptPath, '--config', tmpConfigPath, '--output', resultsPath, '--top-n', String(topN)];

    if (sourceName === 'arxiv') {
      const maxResults = config.max_results || 200;
      const categories = config.categories || 'cs.AI,cs.LG,cs.CL,cs.CV,cs.MM,cs.MA,cs.RO';
      args.push('--max-results', String(maxResults), '--categories', categories);
    }

    if (sourceName === 'x' && config.queries) {
      args.push('--queries', config.queries);
    }
    if (sourceName === 'x' && config.accounts) {
      args.push('--accounts', config.accounts);
    }
    if (sourceName === 'xiaohongshu' && config.keywords) {
      args.push('--keywords', config.keywords);
    }

    // Build env — pass credentials if required
    const env = { ...process.env };
    if (entry.requiresCredentials) {
      try {
        const credValue = credentialsDb.getActiveCredential(req.user.id, entry.credentialType);
        if (!credValue) {
          return res.status(400).json({
            error: `No active credential found for ${entry.label}. Please add your ${entry.credentialType} in settings.`,
          });
        }
        if (entry.credentialType === 'x_bearer_token') {
          env.X_BEARER_TOKEN = credValue;
        } else if (entry.credentialType === 'xiaohongshu_token') {
          env.XHS_TOKEN = credValue;
        }
      } catch (credErr) {
        return res.status(400).json({ error: 'Failed to retrieve credentials', details: credErr.message });
      }
    }

    const child = spawn('python3', args, {
      cwd: path.join(SKILLS_DIR, 'research-news'),
      env,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    child.on('close', async (code) => {
      if (code !== 0) {
        console.error(`[news][${sourceName}] script failed:`, stderr);
        return res.status(500).json({
          error: `Search failed for ${entry.label}`,
          details: stderr || stdout,
          exitCode: code,
        });
      }

      try {
        const results = JSON.parse(await fs.readFile(resultsPath, 'utf8'));
        res.json(results);
      } catch (readErr) {
        res.status(500).json({ error: 'Failed to read search results', details: readErr.message });
      }
    });

    child.on('error', (err) => {
      console.error(`[news][${sourceName}] Failed to spawn script:`, err);
      res.status(500).json({ error: 'Failed to execute search script', details: err.message });
    });
  } catch (err) {
    res.status(500).json({ error: 'Search failed', details: err.message });
  }
}

// POST /api/news/search/:source — trigger search for one source
router.post('/search/:source', (req, res) => handleSearch(req.params.source, req, res));

// ---------------------------------------------------------------------------
// GET /api/news/results/:source — cached results for one source
// ---------------------------------------------------------------------------
router.get('/results/:source', async (req, res) => {
  try {
    const entry = getSourceEntry(req.params.source);
    if (!entry) return res.status(404).json({ error: `Unknown source: ${req.params.source}` });

    const resultsPath = path.join(DATA_DIR, entry.resultsFile);
    const data = await fs.readFile(resultsPath, 'utf8');
    res.json(JSON.parse(data));
  } catch (err) {
    if (err.code === 'ENOENT') {
      res.json({ top_papers: [], total_found: 0, total_filtered: 0 });
    } else {
      res.status(500).json({ error: 'Failed to read results', details: err.message });
    }
  }
});

// ---------------------------------------------------------------------------
// Backward-compatible aliases (old routes → arxiv source)
// ---------------------------------------------------------------------------
router.get('/config', async (req, res) => {
  try {
    await ensureDataDir();
    const entry = SOURCE_REGISTRY.arxiv;
    const configPath = path.join(DATA_DIR, entry.configFile);
    const data = await fs.readFile(configPath, 'utf8');
    res.json(JSON.parse(data));
  } catch (err) {
    if (err.code === 'ENOENT') {
      res.json(SOURCE_REGISTRY.arxiv.defaultConfig);
    } else {
      res.status(500).json({ error: 'Failed to read config', details: err.message });
    }
  }
});

router.put('/config', async (req, res) => {
  try {
    const entry = SOURCE_REGISTRY.arxiv;
    await ensureDataDir();
    const configPath = path.join(DATA_DIR, entry.configFile);
    await fs.writeFile(configPath, JSON.stringify(req.body, null, 2), 'utf8');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save config', details: err.message });
  }
});

router.post('/search', (req, res) => handleSearch('arxiv', req, res));

router.get('/results', async (req, res) => {
  try {
    const entry = SOURCE_REGISTRY.arxiv;
    const resultsPath = path.join(DATA_DIR, entry.resultsFile);
    const data = await fs.readFile(resultsPath, 'utf8');
    res.json(JSON.parse(data));
  } catch (err) {
    if (err.code === 'ENOENT') {
      // Also try the legacy path for backward compat
      try {
        const legacyPath = path.join(DATA_DIR, 'news-results.json');
        const data = await fs.readFile(legacyPath, 'utf8');
        res.json(JSON.parse(data));
      } catch {
        res.json({ top_papers: [], total_found: 0, total_filtered: 0 });
      }
    } else {
      res.status(500).json({ error: 'Failed to read results', details: err.message });
    }
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function buildYamlConfig(config) {
  let yaml = '# Auto-generated from VibeLab News Dashboard config\n\n';
  yaml += 'research_domains:\n';

  const domains = config.research_domains || {};
  for (const [name, domain] of Object.entries(domains)) {
    yaml += `  "${name}":\n`;
    yaml += `    keywords:\n`;
    for (const kw of domain.keywords || []) {
      yaml += `      - "${kw}"\n`;
    }
    if (domain.arxiv_categories?.length) {
      yaml += `    arxiv_categories:\n`;
      for (const cat of domain.arxiv_categories) {
        yaml += `      - "${cat}"\n`;
      }
    }
    if (domain.priority) {
      yaml += `    priority: ${domain.priority}\n`;
    }
  }

  return yaml;
}

export default router;
