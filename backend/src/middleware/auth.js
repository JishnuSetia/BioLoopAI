/**
 * JWT authentication middleware.
 * Expects Authorization: Bearer <token> or (for browser) no header – we also accept
 * a valid JWT in the body or query for GET /optimize if needed.
 */
const jwt = require('jsonwebtoken');
const config = require('../config');

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  const token =
    (authHeader && authHeader.startsWith('Bearer ') && authHeader.slice(7)) ||
    req.body?.token ||
    req.query?.token;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    req.user = { id: decoded.sub, email: decoded.email, role: decoded.role || null };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { authMiddleware };
