/**
 * BioLoop AI – Auth module.
 * Handles login, signup, and JWT storage via backend API.
 */

import { apiFetch } from './api.js';

const JWT_KEY = 'bioloop_jwt';

function getStoredJwt() {
  return localStorage.getItem(JWT_KEY);
}

function setStoredJwt(token) {
  if (token) localStorage.setItem(JWT_KEY, token);
  else localStorage.removeItem(JWT_KEY);
}

async function login(email, password) {
  const data = await apiFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });
  return { token: data.token, user: data.user };
}

async function signup(email, password, role) {
  const data = await apiFetch('/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password, role })
  });
  return { token: data.token, user: data.user };
}

function showError(el, message) {
  if (!el) return;
  el.textContent = message || '';
  el.previousElementSibling?.querySelector('input')?.classList.toggle('error', !!message);
}

function clearErrors(container) {
  container.querySelectorAll('.form-error').forEach(el => { el.textContent = ''; });
  container.querySelectorAll('input').forEach(i => i.classList.remove('error'));
}

export function initLogin() {
  const form = document.getElementById('login-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(form);

    const email = form.querySelector('#login-email').value.trim();
    const password = form.querySelector('#login-password').value;
    const emailErr = form.querySelector('#login-email-error');
    const passwordErr = form.querySelector('#login-password-error');

    if (!email) {
      showError(emailErr, 'Email is required');
      return;
    }
    if (!password) {
      showError(passwordErr, 'Password is required');
      return;
    }

    try {
      const { token, user } = await login(email, password);
      setStoredJwt(token);
      redirectByRole(user?.role);
    } catch (err) {
      showError(passwordErr, err?.message || 'Login failed. Please try again.');
    }
  });
}

export function initSignup() {
  const form = document.getElementById('signup-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(form);

    const email = form.querySelector('#signup-email').value.trim();
    const password = form.querySelector('#signup-password').value;
    const confirm = form.querySelector('#signup-confirm').value;
    const emailErr = form.querySelector('#signup-email-error');
    const passwordErr = form.querySelector('#signup-password-error');
    const confirmErr = form.querySelector('#signup-confirm-error');
    const role = form.querySelector('#signup-role')?.value || 'FARM_MANAGER';

    if (!email) {
      showError(emailErr, 'Email is required');
      return;
    }
    if (!password) {
      showError(passwordErr, 'Password must be at least 6 characters');
      return;
    }
    if (password !== confirm) {
      showError(confirmErr, 'Passwords do not match');
      return;
    }

    try {
      const { token, user } = await signup(email, password, role);
      setStoredJwt(token);
      redirectByRole(user?.role);
    } catch (err) {
      showError(confirmErr, err?.message || 'Sign up failed. Please try again.');
    }
  });
}

/**
 * Protect dashboard: redirect to login if no JWT.
 */
export function requireAuth() {
  if (!getStoredJwt()) {
    window.location.replace('login.html');
    return false;
  }
  return true;
}

export function redirectByRole(role) {
  // Use unified dashboard for all roles
  window.location.href = 'dashboard.html';
}

export { getStoredJwt, setStoredJwt };
