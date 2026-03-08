/**
 * Auth routes: signup, login, GET /me (JWT-protected).
 */
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const prisma = require('../db');
const config = require('../config');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

const SALT_ROUNDS = 10;
const ROLE_VALUES = new Set(['FARM_MANAGER', 'INDUSTRY_MANAGER']);

/** POST /signup – create user, hash password */
router.post('/signup', async (req, res) => {
  try {
    const { email, password, role } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }
    const normalizedEmail = String(email).trim().toLowerCase();
    if (normalizedEmail.length < 3) {
      return res.status(400).json({ error: 'Invalid email' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const hashed_password = await bcrypt.hash(String(password), SALT_ROUNDS);
    const normalizedRole = ROLE_VALUES.has(String(role)) ? String(role) : 'FARM_MANAGER';
    const user = await prisma.user.create({
      data: { email: normalizedEmail, hashed_password, role: normalizedRole },
      select: { id: true, email: true, role: true },
    });

    const token = jwt.sign(
      { sub: user.id, email: user.email, role: user.role },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn }
    );
    return res.status(201).json({ user: { id: user.id, email: user.email, role: user.role }, token });
  } catch (err) {
    console.error('Signup error:', err);
    return res.status(500).json({ error: 'Registration failed' });
  }
});

/** POST /login – validate credentials, return JWT */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }
    const normalizedEmail = String(email).trim().toLowerCase();

    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const valid = await bcrypt.compare(String(password), user.hashed_password);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { sub: user.id, email: user.email, role: user.role },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn }
    );
    return res.json({ user: { id: user.id, email: user.email, role: user.role }, token });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Login failed' });
  }
});

/** GET /me – current user (JWT required) */
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, email: true, role: true, createdAt: true },
    });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    return res.json(user);
  } catch (err) {
    console.error('Me error:', err);
    return res.status(500).json({ error: 'Failed to fetch user' });
  }
});

module.exports = router;
