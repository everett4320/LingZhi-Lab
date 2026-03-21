import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ANSI color codes for terminal output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    cyan: '\x1b[36m',
    dim: '\x1b[2m',
};

const c = {
    info: (text) => `${colors.cyan}${text}${colors.reset}`,
    bright: (text) => `${colors.bright}${text}${colors.reset}`,
    dim: (text) => `${colors.dim}${text}${colors.reset}`,
};

// Use DATABASE_PATH environment variable if set, otherwise use default location
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'auth.db');
const INIT_SQL_PATH = path.join(__dirname, 'init.sql');

// Ensure database directory exists if custom path is provided
if (process.env.DATABASE_PATH) {
  const dbDir = path.dirname(DB_PATH);
  try {
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
      console.log(`Created database directory: ${dbDir}`);
    }
  } catch (error) {
    console.error(`Failed to create database directory ${dbDir}:`, error.message);
    throw error;
  }
}

// Migrate legacy local DB (repo install path) into the configured DB path.
const LEGACY_DB_PATH = path.join(__dirname, 'auth.db');
if (DB_PATH !== LEGACY_DB_PATH && !fs.existsSync(DB_PATH) && fs.existsSync(LEGACY_DB_PATH)) {
  try {
    fs.copyFileSync(LEGACY_DB_PATH, DB_PATH);
    console.log(`[MIGRATION] Copied database from ${LEGACY_DB_PATH} to ${DB_PATH}`);
    for (const suffix of ['-wal', '-shm']) {
      if (fs.existsSync(LEGACY_DB_PATH + suffix)) {
        fs.copyFileSync(LEGACY_DB_PATH + suffix, DB_PATH + suffix);
      }
    }
  } catch (err) {
    console.warn(`[MIGRATION] Could not copy legacy database: ${err.message}`);
  }
}

// Create database connection
const db = new Database(DB_PATH);

// Show app installation path prominently
const appInstallPath = path.join(__dirname, '../..');
console.log('');
console.log(c.dim('═'.repeat(60)));
console.log(`${c.info('[INFO]')} App Installation: ${c.bright(appInstallPath)}`);
console.log(`${c.info('[INFO]')} Database: ${c.dim(path.relative(appInstallPath, DB_PATH))}`);
if (process.env.DATABASE_PATH) {
  console.log(`       ${c.dim('(Using custom DATABASE_PATH from environment)')}`);
}
console.log(c.dim('═'.repeat(60)));
console.log('');

const runMigrations = () => {
  try {
    const tableInfo = db.prepare("PRAGMA table_info(users)").all();
    const columnNames = tableInfo.map(col => col.name);

    if (!columnNames.includes('git_name')) {
      console.log('Running migration: Adding git_name column');
      db.exec('ALTER TABLE users ADD COLUMN git_name TEXT');
    }

    if (!columnNames.includes('git_email')) {
      console.log('Running migration: Adding git_email column');
      db.exec('ALTER TABLE users ADD COLUMN git_email TEXT');
    }

    if (!columnNames.includes('has_completed_onboarding')) {
      console.log('Running migration: Adding has_completed_onboarding column');
      db.exec('ALTER TABLE users ADD COLUMN has_completed_onboarding BOOLEAN DEFAULT 0');
    }

    if (!columnNames.includes('notification_email')) {
      console.log('Running migration: Adding notification_email column');
      db.exec('ALTER TABLE users ADD COLUMN notification_email TEXT');
    }

    console.log('Database migrations completed successfully');
  } catch (error) {
    console.error('Error running migrations:', error.message);
    throw error;
  }
};

// Initialize database with schema
const initializeDatabase = async () => {
  try {
    const initSQL = fs.readFileSync(INIT_SQL_PATH, 'utf8');
    db.exec(initSQL);
    console.log('Database initialized successfully');
    runMigrations();
  } catch (error) {
    console.error('Error initializing database:', error.message);
    throw error;
  }
};

// User database operations
const userDb = {
  // Check if any users exist
  hasUsers: () => {
    try {
      const row = db.prepare('SELECT COUNT(*) as count FROM users').get();
      return row.count > 0;
    } catch (err) {
      throw err;
    }
  },

  // Create a new user
  createUser: (username, passwordHash, notificationEmail = null) => {
    try {
      const stmt = db.prepare('INSERT INTO users (username, password_hash, notification_email) VALUES (?, ?, ?)');
      const result = stmt.run(username, passwordHash, notificationEmail);
      return { id: result.lastInsertRowid, username, notification_email: notificationEmail };
    } catch (err) {
      throw err;
    }
  },

  // Get user by username
  getUserByUsername: (username) => {
    try {
      const row = db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(username);
      return row;
    } catch (err) {
      throw err;
    }
  },

  resetSingleUser: () => {
    try {
      db.prepare('DELETE FROM users').run();
    } catch (err) {
      throw err;
    }
  },

  // Update last login time (non-fatal)
  updateLastLogin: (userId) => {
    try {
      db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(userId);
    } catch (err) {
      console.warn('Failed to update last login:', err.message);
    }
  },

  // Get user by ID
  getUserById: (userId) => {
    try {
      const row = db.prepare('SELECT id, username, notification_email, created_at, last_login FROM users WHERE id = ? AND is_active = 1').get(userId);
      return row;
    } catch (err) {
      throw err;
    }
  },

  getFirstUser: () => {
    try {
      const row = db.prepare('SELECT id, username, notification_email, created_at, last_login FROM users WHERE is_active = 1 LIMIT 1').get();
      return row;
    } catch (err) {
      throw err;
    }
  },

  updateGitConfig: (userId, gitName, gitEmail) => {
    try {
      const stmt = db.prepare('UPDATE users SET git_name = ?, git_email = ? WHERE id = ?');
      stmt.run(gitName, gitEmail, userId);
    } catch (err) {
      throw err;
    }
  },

  getGitConfig: (userId) => {
    try {
      const row = db.prepare('SELECT git_name, git_email FROM users WHERE id = ?').get(userId);
      return row;
    } catch (err) {
      throw err;
    }
  },

  completeOnboarding: (userId) => {
    try {
      const stmt = db.prepare('UPDATE users SET has_completed_onboarding = 1 WHERE id = ?');
      stmt.run(userId);
    } catch (err) {
      throw err;
    }
  },

  hasCompletedOnboarding: (userId) => {
    try {
      const row = db.prepare('SELECT has_completed_onboarding FROM users WHERE id = ?').get(userId);
      return row?.has_completed_onboarding === 1;
    } catch (err) {
      throw err;
    }
  },

  getProfile: (userId) => {
    try {
      return db.prepare('SELECT id, username, notification_email FROM users WHERE id = ? AND is_active = 1').get(userId);
    } catch (err) {
      throw err;
    }
  },

  updateProfile: (userId, notificationEmail) => {
    try {
      db.prepare('UPDATE users SET notification_email = ? WHERE id = ?').run(notificationEmail, userId);
      return userDb.getProfile(userId);
    } catch (err) {
      throw err;
    }
  }
};

const autoResearchDb = {
  createRun: (input) => {
    try {
      db.prepare(`
        INSERT INTO auto_research_runs (
          id, user_id, project_name, project_path, provider, status, session_id,
          current_task_id, completed_tasks, total_tasks, error, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.id,
        input.userId,
        input.projectName,
        input.projectPath,
        input.provider || 'claude',
        input.status || 'queued',
        input.sessionId || null,
        input.currentTaskId || null,
        input.completedTasks || 0,
        input.totalTasks || 0,
        input.error || null,
        input.metadata ? JSON.stringify(input.metadata) : null
      );
      return autoResearchDb.getRunById(input.id);
    } catch (err) {
      throw err;
    }
  },

  getRunById: (runId) => {
    try {
      const row = db.prepare('SELECT * FROM auto_research_runs WHERE id = ?').get(runId);
      return row ? {
        ...row,
        metadata: row.metadata ? JSON.parse(row.metadata) : null,
      } : null;
    } catch (err) {
      throw err;
    }
  },

  getLatestRunForProject: (userId, projectName) => {
    try {
      const row = db.prepare(`
        SELECT * FROM auto_research_runs
        WHERE user_id = ? AND project_name = ?
        ORDER BY started_at DESC
        LIMIT 1
      `).get(userId, projectName);
      return row ? {
        ...row,
        metadata: row.metadata ? JSON.parse(row.metadata) : null,
      } : null;
    } catch (err) {
      throw err;
    }
  },

  getActiveRunForProject: (userId, projectName) => {
    try {
      const row = db.prepare(`
        SELECT * FROM auto_research_runs
        WHERE user_id = ? AND project_name = ? AND status IN ('queued', 'running', 'cancelling')
        ORDER BY started_at DESC
        LIMIT 1
      `).get(userId, projectName);
      return row ? {
        ...row,
        metadata: row.metadata ? JSON.parse(row.metadata) : null,
      } : null;
    } catch (err) {
      throw err;
    }
  },

  updateRun: (runId, updates = {}) => {
    try {
      const existing = autoResearchDb.getRunById(runId);
      if (!existing) {
        return null;
      }

      const mergedMetadata = Object.prototype.hasOwnProperty.call(updates, 'metadata')
        ? updates.metadata
        : existing.metadata;

      db.prepare(`
        UPDATE auto_research_runs
        SET
          status = ?,
          session_id = ?,
          current_task_id = ?,
          completed_tasks = ?,
          total_tasks = ?,
          error = ?,
          metadata = ?,
          finished_at = ?,
          email_sent_at = ?
        WHERE id = ?
      `).run(
        updates.status ?? existing.status,
        updates.sessionId ?? existing.session_id,
        updates.currentTaskId ?? existing.current_task_id,
        updates.completedTasks ?? existing.completed_tasks,
        updates.totalTasks ?? existing.total_tasks,
        updates.error ?? existing.error,
        mergedMetadata ? JSON.stringify(mergedMetadata) : null,
        updates.finishedAt ?? existing.finished_at,
        updates.emailSentAt ?? existing.email_sent_at,
        runId
      );

      return autoResearchDb.getRunById(runId);
    } catch (err) {
      throw err;
    }
  },
};

const appSettingsDb = {
  get: (key) => {
    try {
      const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
      return row ? row.value : null;
    } catch (err) {
      throw err;
    }
  },

  set: (key, value) => {
    try {
      db.prepare(`
        INSERT INTO app_settings (key, value, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
      `).run(key, value);
      return appSettingsDb.get(key);
    } catch (err) {
      throw err;
    }
  },
};

// API Keys database operations
const apiKeysDb = {
  // Generate a new API key
  generateApiKey: () => {
    return 'ck_' + crypto.randomBytes(32).toString('hex');
  },

  // Create a new API key
  createApiKey: (userId, keyName) => {
    try {
      const apiKey = apiKeysDb.generateApiKey();
      const stmt = db.prepare('INSERT INTO api_keys (user_id, key_name, api_key) VALUES (?, ?, ?)');
      const result = stmt.run(userId, keyName, apiKey);
      return { id: result.lastInsertRowid, keyName, apiKey };
    } catch (err) {
      throw err;
    }
  },

  // Get all API keys for a user
  getApiKeys: (userId) => {
    try {
      const rows = db.prepare('SELECT id, key_name, api_key, created_at, last_used, is_active FROM api_keys WHERE user_id = ? ORDER BY created_at DESC').all(userId);
      return rows;
    } catch (err) {
      throw err;
    }
  },

  // Validate API key and get user
  validateApiKey: (apiKey) => {
    try {
      const row = db.prepare(`
        SELECT u.id, u.username, ak.id as api_key_id
        FROM api_keys ak
        JOIN users u ON ak.user_id = u.id
        WHERE ak.api_key = ? AND ak.is_active = 1 AND u.is_active = 1
      `).get(apiKey);

      if (row) {
        // Update last_used timestamp
        db.prepare('UPDATE api_keys SET last_used = CURRENT_TIMESTAMP WHERE id = ?').run(row.api_key_id);
      }

      return row;
    } catch (err) {
      throw err;
    }
  },

  // Delete an API key
  deleteApiKey: (userId, apiKeyId) => {
    try {
      const stmt = db.prepare('DELETE FROM api_keys WHERE id = ? AND user_id = ?');
      const result = stmt.run(apiKeyId, userId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  },

  // Toggle API key active status
  toggleApiKey: (userId, apiKeyId, isActive) => {
    try {
      const stmt = db.prepare('UPDATE api_keys SET is_active = ? WHERE id = ? AND user_id = ?');
      const result = stmt.run(isActive ? 1 : 0, apiKeyId, userId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  }
};

// User credentials database operations (for GitHub tokens, GitLab tokens, etc.)
const credentialsDb = {
  // Create a new credential
  createCredential: (userId, credentialName, credentialType, credentialValue, description = null) => {
    try {
      const stmt = db.prepare('INSERT INTO user_credentials (user_id, credential_name, credential_type, credential_value, description) VALUES (?, ?, ?, ?, ?)');
      const result = stmt.run(userId, credentialName, credentialType, credentialValue, description);
      return { id: result.lastInsertRowid, credentialName, credentialType };
    } catch (err) {
      throw err;
    }
  },

  // Get all credentials for a user, optionally filtered by type
  getCredentials: (userId, credentialType = null) => {
    try {
      let query = 'SELECT id, credential_name, credential_type, description, created_at, is_active FROM user_credentials WHERE user_id = ?';
      const params = [userId];

      if (credentialType) {
        query += ' AND credential_type = ?';
        params.push(credentialType);
      }

      query += ' ORDER BY created_at DESC';

      const rows = db.prepare(query).all(...params);
      return rows;
    } catch (err) {
      throw err;
    }
  },

  // Get active credential value for a user by type (returns most recent active)
  getActiveCredential: (userId, credentialType) => {
    try {
      const row = db.prepare('SELECT credential_value FROM user_credentials WHERE user_id = ? AND credential_type = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 1').get(userId, credentialType);
      return row?.credential_value || null;
    } catch (err) {
      throw err;
    }
  },

  // Delete a credential
  deleteCredential: (userId, credentialId) => {
    try {
      const stmt = db.prepare('DELETE FROM user_credentials WHERE id = ? AND user_id = ?');
      const result = stmt.run(credentialId, userId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  },

  // Toggle credential active status
  toggleCredential: (userId, credentialId, isActive) => {
    try {
      const stmt = db.prepare('UPDATE user_credentials SET is_active = ? WHERE id = ? AND user_id = ?');
      const result = stmt.run(isActive ? 1 : 0, credentialId, userId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  }
};

// Backward compatibility - keep old names pointing to new system
const githubTokensDb = {
  createGithubToken: (userId, tokenName, githubToken, description = null) => {
    return credentialsDb.createCredential(userId, tokenName, 'github_token', githubToken, description);
  },
  getGithubTokens: (userId) => {
    return credentialsDb.getCredentials(userId, 'github_token');
  },
  getActiveGithubToken: (userId) => {
    return credentialsDb.getActiveCredential(userId, 'github_token');
  },
  deleteGithubToken: (userId, tokenId) => {
    return credentialsDb.deleteCredential(userId, tokenId);
  },
  toggleGithubToken: (userId, tokenId, isActive) => {
    return credentialsDb.toggleCredential(userId, tokenId, isActive);
  }
};

// Session metadata index operations
const sessionDb = {
  // Upsert session metadata (insert if not exists, update if exists)
  upsertSession: (id, projectName, provider, displayName, lastActivity, messageCount = 0, metadata = null) => {
    try {
      const stmt = db.prepare(`
        INSERT INTO session_metadata (id, project_name, provider, display_name, last_activity, message_count, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          display_name = COALESCE(excluded.display_name, session_metadata.display_name),
          last_activity = COALESCE(excluded.last_activity, session_metadata.last_activity),
          message_count = COALESCE(excluded.message_count, session_metadata.message_count),
          metadata = COALESCE(excluded.metadata, session_metadata.metadata)
      `);
      stmt.run(id, projectName, provider, displayName, lastActivity, messageCount, metadata ? JSON.stringify(metadata) : null);
    } catch (err) {
      console.error('Error upserting session metadata:', err.message);
    }
  },

  // Update session name ONLY (priority for manual rename)
  updateSessionName: (id, displayName) => {
    try {
      const stmt = db.prepare('UPDATE session_metadata SET display_name = ? WHERE id = ?');
      stmt.run(displayName, id);
    } catch (err) {
      console.error('Error updating session name:', err.message);
    }
  },

  // Get all metadata for sessions in a project
  getSessionsByProject: (projectName) => {
    try {
      const rows = db.prepare('SELECT * FROM session_metadata WHERE project_name = ?').all(projectName);
      return rows.map(row => ({
        ...row,
        metadata: row.metadata ? JSON.parse(row.metadata) : null
      }));
    } catch (err) {
      console.error('Error getting project sessions:', err.message);
      return [];
    }
  },

  // Get metadata for a specific session
  getSessionById: (id) => {
    try {
      const row = db.prepare('SELECT * FROM session_metadata WHERE id = ?').get(id);
      if (row && row.metadata) {
        row.metadata = JSON.parse(row.metadata);
      }
      return row;
    } catch (err) {
      console.error('Error getting session metadata:', err.message);
      return null;
    }
  },

  deleteSession: (id) => {
    try {
      db.prepare('DELETE FROM session_metadata WHERE id = ?').run(id);
    } catch (err) {
      console.error('Error deleting session metadata:', err.message);
    }
  }
};

// Project index operations
const projectDb = {
  // Upsert project (insert if not exists, update if exists)
  upsertProject: (id, userId, displayName, path, isStarred = 0, lastAccessed = null, metadata = null) => {
    try {
      const stmt = db.prepare(`
        INSERT INTO projects (id, user_id, display_name, path, is_starred, last_accessed, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          display_name = COALESCE(excluded.display_name, projects.display_name),
          path = COALESCE(excluded.path, projects.path),
          user_id = CASE WHEN projects.user_id IS NULL THEN excluded.user_id ELSE projects.user_id END,
          is_starred = COALESCE(excluded.is_starred, projects.is_starred),
          last_accessed = COALESCE(excluded.last_accessed, projects.last_accessed),
          metadata = COALESCE(excluded.metadata, projects.metadata)
      `);
      stmt.run(id, userId, displayName, path, isStarred, lastAccessed, metadata ? JSON.stringify(metadata) : null);
    } catch (err) {
      console.error('Error upserting project metadata:', err.message);
    }
  },

  // Update project name ONLY
  updateProjectName: (id, displayName) => {
    try {
      db.prepare('UPDATE projects SET display_name = ? WHERE id = ?').run(displayName, id);
    } catch (err) {
      console.error('Error updating project name:', err.message);
    }
  },

  // Get all projects (can filter by userId later)
  getAllProjects: (userId = null) => {
    try {
      const query = userId ? 'SELECT * FROM projects WHERE user_id = ?' : 'SELECT * FROM projects';
      const rows = userId ? db.prepare(query).all(userId) : db.prepare(query).all();
      return rows.map(row => ({
        ...row,
        metadata: row.metadata ? JSON.parse(row.metadata) : null
      }));
    } catch (err) {
      console.error('Error getting projects:', err.message);
      return [];
    }
  },

  // Get project by its encoded ID
  getProjectById: (id) => {
    try {
      const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
      if (row && row.metadata) {
        row.metadata = JSON.parse(row.metadata);
      }
      return row;
    } catch (err) {
      console.error('Error getting project metadata:', err.message);
      return null;
    }
  },

  toggleStar: (id, isStarred) => {
    try {
      db.prepare('UPDATE projects SET is_starred = ? WHERE id = ?').run(isStarred ? 1 : 0, id);
    } catch (err) {
      console.error('Error toggling project star:', err.message);
    }
  },

  deleteProject: (id) => {
    try {
      db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    } catch (err) {
      console.error('Error deleting project metadata:', err.message);
    }
  },

  updateProjectPath: (id, projectPath) => {
    try {
      db.prepare('UPDATE projects SET path = ? WHERE id = ?').run(projectPath, id);
    } catch (err) {
      console.error('Error updating project path:', err.message);
    }
  },

  migrateProjectIdentity: (oldId, newId, projectPath) => {
    const migrate = db.transaction(() => {
      db.prepare('UPDATE projects SET id = ?, path = ? WHERE id = ?').run(newId, projectPath, oldId);
      db.prepare('UPDATE session_metadata SET project_name = ? WHERE project_name = ?').run(newId, oldId);
    });

    try {
      migrate();
    } catch (err) {
      console.error('Error migrating project identity:', err.message);
      throw err;
    }
  }
};

// References (literature library) database operations
const referencesDb = {
  /**
   * Batch upsert references from Zotero or other sources.
   * Deduplicates by source_id for the given user.
   */
  syncFromZotero: (userId, items) => {
    const upsert = db.prepare(`
      INSERT INTO references_library (id, user_id, title, authors, year, abstract, doi, url, journal, item_type, source, source_id, keywords, citation_key, raw_data, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'zotero', ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        authors = excluded.authors,
        year = excluded.year,
        abstract = excluded.abstract,
        doi = excluded.doi,
        url = excluded.url,
        journal = excluded.journal,
        item_type = excluded.item_type,
        keywords = excluded.keywords,
        citation_key = excluded.citation_key,
        raw_data = excluded.raw_data,
        updated_at = CURRENT_TIMESTAMP
    `);

    const insertTag = db.prepare(`
      INSERT OR IGNORE INTO reference_tags (reference_id, tag) VALUES (?, ?)
    `);

    const tx = db.transaction((rows) => {
      const ids = [];
      for (const item of rows) {
        // Deterministic id: user + source_id
        const id = `zotero_${userId}_${item.sourceId}`;
        upsert.run(
          id,
          userId,
          item.title,
          JSON.stringify(item.authors || []),
          item.year,
          item.abstract,
          item.doi,
          item.url,
          item.journal,
          item.itemType || 'article',
          item.sourceId,
          JSON.stringify(item.keywords || []),
          item.citationKey,
          item.rawData ? JSON.stringify(item.rawData) : null,
        );
        // Upsert tags
        for (const tag of item.keywords || []) {
          insertTag.run(id, tag);
        }
        ids.push(id);
      }
      return ids;
    });

    try {
      return tx(items);
    } catch (err) {
      throw err;
    }
  },

  /**
   * Import references from BibTeX (or other non-Zotero sources).
   */
  importReferences: (userId, items, source = 'bibtex') => {
    const upsert = db.prepare(`
      INSERT INTO references_library (id, user_id, title, authors, year, abstract, doi, url, journal, item_type, source, source_id, keywords, citation_key, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        authors = excluded.authors,
        year = excluded.year,
        abstract = excluded.abstract,
        doi = excluded.doi,
        url = excluded.url,
        journal = excluded.journal,
        item_type = excluded.item_type,
        keywords = excluded.keywords,
        citation_key = excluded.citation_key,
        updated_at = CURRENT_TIMESTAMP
    `);

    const insertTag = db.prepare(`
      INSERT OR IGNORE INTO reference_tags (reference_id, tag) VALUES (?, ?)
    `);

    const tx = db.transaction((rows) => {
      const ids = [];
      for (const item of rows) {
        const id = `${source}_${userId}_${item.citationKey || crypto.randomUUID()}`;
        upsert.run(
          id,
          userId,
          item.title,
          JSON.stringify(item.authors || []),
          item.year,
          item.abstract,
          item.doi,
          item.url,
          item.journal,
          item.itemType || 'article',
          source,
          item.citationKey || null,
          JSON.stringify(item.keywords || []),
          item.citationKey || null,
        );
        for (const tag of item.keywords || []) {
          insertTag.run(id, tag);
        }
        ids.push(id);
      }
      return ids;
    });

    try {
      return tx(items);
    } catch (err) {
      throw err;
    }
  },

  /** List user references with optional search and pagination. */
  getUserReferences: (userId, { search, tags, limit = 50, offset = 0 } = {}) => {
    try {
      let query = 'SELECT * FROM references_library WHERE user_id = ?';
      const params = [userId];

      if (search) {
        query += ' AND (title LIKE ? OR authors LIKE ? OR journal LIKE ? OR abstract LIKE ?)';
        const term = `%${search}%`;
        params.push(term, term, term, term);
      }

      if (tags && tags.length > 0) {
        query += ` AND id IN (SELECT reference_id FROM reference_tags WHERE tag IN (${tags.map(() => '?').join(',')}))`;
        params.push(...tags);
      }

      query += ' ORDER BY updated_at DESC LIMIT ? OFFSET ?';
      params.push(limit, offset);

      const rows = db.prepare(query).all(...params);
      return rows.map((r) => ({
        ...r,
        authors: r.authors ? JSON.parse(r.authors) : [],
        keywords: r.keywords ? JSON.parse(r.keywords) : [],
        raw_data: undefined, // Don't send raw_data in list
      }));
    } catch (err) {
      throw err;
    }
  },

  /** Single reference detail. */
  getReference: (id) => {
    try {
      const row = db.prepare('SELECT * FROM references_library WHERE id = ?').get(id);
      if (!row) return null;
      return {
        ...row,
        authors: row.authors ? JSON.parse(row.authors) : [],
        keywords: row.keywords ? JSON.parse(row.keywords) : [],
        raw_data: row.raw_data ? JSON.parse(row.raw_data) : null,
      };
    } catch (err) {
      throw err;
    }
  },

  /** Get references linked to a project. */
  getProjectReferences: (projectId) => {
    try {
      const rows = db.prepare(`
        SELECT r.*, pr.added_at AS linked_at
        FROM references_library r
        JOIN project_references pr ON pr.reference_id = r.id
        WHERE pr.project_id = ?
        ORDER BY pr.added_at DESC
      `).all(projectId);
      return rows.map((r) => ({
        ...r,
        authors: r.authors ? JSON.parse(r.authors) : [],
        keywords: r.keywords ? JSON.parse(r.keywords) : [],
        raw_data: undefined,
      }));
    } catch (err) {
      throw err;
    }
  },

  /** Link a reference to a project. */
  linkToProject: (projectId, referenceId) => {
    try {
      db.prepare('INSERT OR IGNORE INTO project_references (project_id, reference_id) VALUES (?, ?)').run(projectId, referenceId);
      return true;
    } catch (err) {
      throw err;
    }
  },

  /** Unlink a reference from a project. */
  unlinkFromProject: (projectId, referenceId) => {
    try {
      const result = db.prepare('DELETE FROM project_references WHERE project_id = ? AND reference_id = ?').run(projectId, referenceId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  },

  /** Bulk-link an array of reference IDs to a project. */
  bulkLinkIds: (projectId, referenceIds) => {
    const insert = db.prepare('INSERT OR IGNORE INTO project_references (project_id, reference_id) VALUES (?, ?)');
    const tx = db.transaction((ids) => {
      let count = 0;
      for (const id of ids) {
        count += insert.run(projectId, id).changes;
      }
      return count;
    });
    return tx(referenceIds);
  },

  /** Get all unique tags for a user. */
  getTags: (userId) => {
    try {
      const rows = db.prepare(`
        SELECT DISTINCT rt.tag, COUNT(*) as count
        FROM reference_tags rt
        JOIN references_library r ON r.id = rt.reference_id
        WHERE r.user_id = ?
        GROUP BY rt.tag
        ORDER BY count DESC
      `).all(userId);
      return rows;
    } catch (err) {
      throw err;
    }
  },

  /** Mark a reference as having its PDF cached. */
  setPdfCached: (id, cached = true) => {
    try {
      db.prepare('UPDATE references_library SET pdf_cached = ? WHERE id = ?').run(cached ? 1 : 0, id);
    } catch (err) {
      throw err;
    }
  },

  /** Delete a reference. */
  deleteReference: (userId, referenceId) => {
    try {
      const result = db.prepare('DELETE FROM references_library WHERE id = ? AND user_id = ?').run(referenceId, userId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  },

  /** Bulk-delete references by id list. Returns number of deleted rows. */
  bulkDeleteReferences: (userId, referenceIds) => {
    if (!referenceIds || referenceIds.length === 0) return 0;
    const placeholders = referenceIds.map(() => '?').join(',');
    const result = db.prepare(
      `DELETE FROM references_library WHERE user_id = ? AND id IN (${placeholders})`
    ).run(userId, ...referenceIds);
    return result.changes;
  },
};

export {
  db,
  initializeDatabase,
  userDb,
  autoResearchDb,
  appSettingsDb,
  apiKeysDb,
  credentialsDb,
  githubTokensDb, // Backward compatibility
  sessionDb,
  projectDb,
  referencesDb
};
