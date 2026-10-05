# BM Printing Services

A full-stack printing business management system built with React, Express, and MongoDB.

## Features

- **Customer Portal**: Browse products, place orders, track order status, leave reviews
- **Admin Panel**: Manage orders, inventory, production, customers, and reports
- **Authentication**: Supabase accounts and Google OAuth, with trusted customer/staff/admin roles; legacy MongoDB login compatibility
- **Order Management**: Full lifecycle from quote to completion with status transition validation
- **Inventory Tracking**: Stock management with low-stock alerts
- **Production Pipeline**: Track orders through manufacturing stages
- **Daily Reports**: Excel-based sales and order reports

## Tech Stack

- **Frontend**: React 18, Vite 8, styled-components
- **Backend**: Express 4, Node.js (ES Modules)
- **Database**: MongoDB with Mongoose 8
- **Auth**: Supabase Auth (legacy JWT + bcryptjs compatibility)
- **Testing**: Jest + Supertest

## Getting Started

### Prerequisites

- Node.js 22.12+ (required by the installed Vite version)
- MongoDB (local or Atlas)

### Setup

```bash
# Install dependencies
npm install --legacy-peer-deps

# Create .env from template
cp .env.example .env

# Edit .env with your MongoDB URI, Supabase public project settings and a strong JWT_SECRET

# Start the dev server (Vite frontend on :3000, Express API on :4000)
npm run dev

# If Vite is already running and only the database/API need starting:
npm run services:start
```

The local launcher reuses a reachable configured database. On this Windows machine it can start the existing MongoDB executable with persistent data in `%LOCALAPPDATA%\BMPrinting\mongodb\data`. Set `MONGOD_BINARY` if MongoDB is installed elsewhere, and `MONGODB_DATA_DIR` to reuse an existing data directory. It never substitutes a temporary database or replaces an unavailable remote database. The database/API continue running after Vite closes; run `npm run services:start` after a reboot. Use managed services for production. See [current workflow verification](CUSTOMER_STAFF_WORKFLOW_FIX.md).

### Manual payment workflow

The active order flow uses manual bank payment verification for GCash, Maya, BPI, and GoTyme. Customers choose a payment method, pay the full order total, upload proof of payment, and submit the reference number and transaction date/time for staff verification.

### Default Admin Account

The admin account is seeded automatically on first startup:

- Email: `admin@bm.com` (or set via `ADMIN_EMAIL` in `.env`)
- Password: `admin123` (or set via `ADMIN_PASSWORD` in `.env`)

Change these immediately in production.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Ensure persistent local MongoDB/API are available, then start Vite |
| `npm run services:start` | Start/check persistent local database and API |
| `npm run dev:frontend` | Start only Vite against an already managed API |
| `npm run server` | Start Express backend |
| `npm run build` | Build production frontend |
| `npm test` | Run API test suite |
| `npm run test:watch` | Run tests in watch mode |

## Project Structure

```
BMPRINTING/
├── server.js              # Express backend (all API routes)
├── server/
│   ├── db.js              # Mongoose schemas and models
│   ├── reportService.js   # ExcelJS daily report generator
│   └── middleware/
│       ├── auth.js        # JWT authentication middleware
│       └── validate.js    # Express-validator rules
├── src/
│   ├── index.jsx          # React SPA root
│   ├── main.jsx           # React entry point
│   ├── components/
│   │   ├── ErrorBoundary.jsx
│   │   ├── Pages/         # Page components
│   │   ├── Widgets/       # Reusable widgets
│   │   └── Common/        # Shared UI components
│   ├── constants/         # Colors, products, styles
│   └── utils/             # Storage helpers
├── tests/                 # Jest + Supertest API tests
├── uploads/               # Order file uploads
├── reports/               # Generated Excel reports
├── .env.example           # Environment template
└── package.json
```

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new customer
- `POST /api/auth/login` - Login (returns JWT)
- `GET /api/auth/me` - Get current user (requires token)

### Products
- `GET /api/products` - List active products
- `POST /api/products` - Create product (admin)
- `PATCH /api/products/:id` - Update product (admin)
- `DELETE /api/products/:id` - Delete product (admin)

### Orders
- `POST /api/orders` - Create order (authenticated)
- `GET /api/orders/:orderId` - Get order details
- `GET /api/customers/orders` - List customer orders
- `PATCH /api/orders/:orderId/status` - Update status (admin, with transition validation)

### Admin
- `GET /api/admin/users` - List users
- `GET /api/admin/orders` - List all orders
- `GET /api/inventory` - Inventory management
- `GET /api/security/audit-logs` - Audit trail

### Health
- `GET /api/health` - System health check

## Testing

```bash
npm test
```

Tests cover authentication (registration, login, JWT), products CRUD, order lifecycle with status transitions, and system health checks.

## Security

- Passwords hashed with bcrypt
- JWT-based authentication (stateless)
- Rate limiting on auth endpoints (20 requests / 15 minutes)
- Order status transitions validated against a state machine
- No hardcoded credentials in source code
- Admin credentials configurable via environment variables
