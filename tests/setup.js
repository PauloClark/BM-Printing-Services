import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import { User, Product, Order, Inventory, Production, OrderFile, AuditLog, ensureEmployeeIndexes } from '../server/db.js';
import { generateToken, requireAuth, requireAdmin } from '../server/middleware/auth.js';

let mongoServer = null;

export async function setupTestDB() {
  if (mongoServer || mongoose.connection.readyState !== 0) throw new Error('Test MongoDB fixture is already active.');
  const server = await MongoMemoryServer.create();
  const uri = server.getUri();
  try {
    await mongoose.connect(uri, { dbName: 'bm_test' });
    if (mongoose.connection.name !== 'bm_test') throw new Error('Test MongoDB fixture connected to an unexpected database.');
    await ensureEmployeeIndexes();
    mongoServer = server;
    return uri;
  } catch (error) {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect().catch(() => {});
    await server.stop().catch(() => {});
    throw error;
  }
}

export async function teardownTestDB() {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (mongoServer) {
    const server = mongoServer;
    mongoServer = null;
    await server.stop();
  }
}

export async function clearTestDB() {
  if (mongoose.connection.readyState !== 1 || mongoose.connection.name !== 'bm_test') {
    throw new Error('Refusing to clear collections outside the disposable bm_test database.');
  }
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
}

export async function seedTestAdmin() {
  const hashedPassword = await bcrypt.hash('admin123', 10);
  return User.create({
    id: 'admin-test-001',
    name: 'Test Admin',
    email: 'admin@test.com',
    phone: '09123456789',
    password: hashedPassword,
    role: 'admin'
  });
}

export async function seedTestCustomer() {
  const hashedPassword = await bcrypt.hash('customer123', 10);
  return User.create({
    id: 'customer-test-001',
    name: 'Test Customer',
    email: 'customer@test.com',
    phone: '09123456789',
    password: hashedPassword,
    role: 'customer'
  });
}

export async function seedTestProduct() {
  return Product.create({
    id: 1,
    name: 'Test T-Shirt',
    price: 180,
    description: 'Test product',
    category: 'Clothing & Apparel',
    stock: 100,
    lowStockThreshold: 10,
    active: true,
    image: ''
  });
}

export function generateAdminToken(user) {
  return generateToken(user || { id: 'admin-test-001', email: 'admin@test.com', role: 'admin', name: 'Test Admin' });
}

export function generateCustomerToken(user) {
  return generateToken(user || { id: 'customer-test-001', email: 'customer@test.com', role: 'customer', name: 'Test Customer' });
}
