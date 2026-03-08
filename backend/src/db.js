/**
 * Shared Prisma client for the API.
 * Keeps a single connection pool for the whole process.
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

module.exports = prisma;
