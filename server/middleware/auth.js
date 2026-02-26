import jwt from 'jsonwebtoken';
import { userDb } from '../database/db.js';
import { IS_PLATFORM } from '../constants/config.js';

// Get JWT secret from environment or use default (for development)
const JWT_SECRET = process.env.JWT_SECRET || 'claude-ui-dev-secret-change-in-production';

// Optional API key middleware
const validateApiKey = (req, res, next) => {
  // Skip API key validation if not configured
  if (!process.env.API_KEY) {
    return next();
  }
  
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== process.env.API_KEY) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  next();
};

// JWT authentication middleware
// Auth wall is disabled — always use the single default user.
const authenticateToken = async (req, res, next) => {
  try {
    let user = userDb.getFirstUser();
    if (!user) {
      // Auto-create a default user on first access
      user = ensureDefaultUser();
    }
    req.user = user;
    return next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({ error: 'Failed to resolve user' });
  }
};

// Generate JWT token (never expires)
const generateToken = (user) => {
  return jwt.sign(
    { 
      userId: user.id, 
      username: user.username 
    },
    JWT_SECRET
    // No expiration - token lasts forever
  );
};

// Auto-create a default user if the database is empty
function ensureDefaultUser() {
  const placeholder = '$2b$12$placeholder.hash.not.used.for.login';
  const created = userDb.createUser('default', placeholder);
  // Mark onboarding as complete so the user goes straight to the app
  userDb.completeOnboarding(created.id);
  return userDb.getUserById(created.id);
}

// WebSocket authentication function
// Auth wall is disabled — always return the default user.
const authenticateWebSocket = (_token) => {
  try {
    let user = userDb.getFirstUser();
    if (!user) {
      user = ensureDefaultUser();
    }
    return { userId: user.id, username: user.username };
  } catch (error) {
    console.error('WebSocket auth error:', error);
    return null;
  }
};

export {
  validateApiKey,
  authenticateToken,
  generateToken,
  authenticateWebSocket,
  JWT_SECRET
};