import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import { User, Product, Order, Inventory, Production, OrderFile, AuditLog } from '../server/db.js';
import { generateToken, requireAuth, requireAdmin } from '../server/middleware/auth.js';

let mongoServer;

export async function setupTestDB() {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);
  return uri;
}

export async function teardownTestDB() {
  await mongoose.disconnect();
  await mongoServer.stop();
}

export async function clearTestDB() {
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
