# PHASE 5: CUSTOMER PICKUP CONFIRMATION + FINAL INVENTORY DEDUCTION + STOCK MOVEMENT LOG

## Status: IMPLEMENTED

## Files Modified

### Backend
1. **server/db.js** - Added `pickedUpAt`, `releasedBy`, `releasedByName`, `receivedByName` fields to Order schema; added `'Picked Up'` to Order status enum; added `reservationStatus` field to Production reservedMaterials; added `StockMovement` schema; updated `getStatusColor` and `serialize` methods
2. **server/utils.js** - Added pickup fields to `serializeOrder` function
3. **server/routes/jobOrders.js** - Added 4 new API endpoints for Phase 5
4. **server/routes/orders.js** - Updated `serializeCustomerOrder` to include reservedMaterials
5. **server.js** - Updated import to include StockMovement; updated `serializeOrder` to include pickup fields

### Frontend
6. **shared/orderWorkflow.js** - Added `'Picked Up'` to ORDER_STATUSES; updated `nextOrderStatus` to transition from `'Ready for Pickup'` to `'Picked Up'`; updated `ORDER_ACTIONS`
7. **src/constants/products.js** - Added `"Picked Up"` to STATUS_COLORS
8. **src/components/Common/ProductionProgress.jsx** - Added "Picked Up" stage; updated to accept `orderStatus` and `pickedUpAt` props
9. **src/components/Pages/StaffOrders.jsx** - Added "Ready for Pickup" filter; added "Confirm Pickup" button; added pickup details modal with confirmation dialog; added reserved materials display
10. **src/components/Pages/AdminPanel.jsx** - Added "Ready for Pickup" sidebar tab; added pickup management view with detail modal; added inventory movements history view; added "Picked Up" to ORDER_STATUS_COLORS
11. **src/components/Pages/MyOrdersPage.jsx** - Added "Picked Up" status display with date
12. **src/components/Pages/TrackPage.jsx** - Added "Picked Up" to status flow
13. **src/components/Pages/InventoryMaterials.jsx** - Enhanced to show Reserved and Available columns with styling

## Files Created
- No new files created (all changes extend existing structures)

## Database/Schema Changes

### Order Schema
- Added: `pickedUpAt` (Date), `releasedBy` (String), `releasedByName` (String), `receivedByName` (String)
- Added: `'Picked Up'` to status enum

### Production Schema (Job Orders)
- Added: `reservationStatus` field to reservedMaterials subdocuments (enum: 'reserved', 'consumed', 'released'; default: 'reserved')

### New Collection: StockMovement
- `orderId` (String, required)
- `jobOrderId` (String, required)
- `inventoryId` (ObjectId ref Inventory, required)
- `material` (String, required)
- `materialType` (String)
- `unit` (String, default 'pcs')
- `quantity` (Number, required, min 0.001)
- `movementType` (enum: 'IN', 'OUT', required)
- `reason` (enum: 'RESTOCK', 'ORDER_PICKUP', 'ADJUSTMENT', 'OTHER', required)
- `performedBy` (String, required)
- `performedByName` (String)
- `receivedByName` (String, nullable)
- `notes` (String)
- `createdAt`, `updatedAt` (timestamps)

## New API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/orders/ready-for-pickup` | Staff/Admin | List orders with status "Ready for Pickup" |
| GET | `/api/orders/:orderId/pickup-details` | Staff/Admin | Get full pickup details including reserved materials |
| POST | `/api/orders/:orderId/confirm-pickup` | Staff/Admin | Confirm pickup, deduct inventory, create stock movements |
| GET | `/api/inventory/movements` | Admin | Get stock movement history |

## How Pickup Confirmation Works

1. Staff/Admin navigates to "Ready for Pickup" section (AdminPanel tab or StaffOrders filter)
2. Clicks "Confirm Pickup" on an order
3. System fetches pickup details from `/api/orders/:orderId/pickup-details`
4. Modal displays: Order info, Payment info, Production info, Reserved materials
5. Optional: Staff/Admin can enter "Received by" name if someone other than customer collects
6. Staff/Admin clicks "Confirm Pickup" button in modal
7. Confirmation dialog warns about irreversible inventory deduction
8. System calls `POST /api/orders/:orderId/confirm-pickup`
9. Backend executes atomic MongoDB transaction:
   - Validates order status is "Ready for Pickup"
   - Validates job order exists with reserved materials
   - Validates no materials already consumed
   - For each reserved material: deducts from on-hand quantity, reduces reserved quantity, marks reservation as "consumed"
   - Creates StockMovement record for each material
   - Updates order status to "Picked Up" with timestamp and user info
10. Frontend refreshes to show updated status

## Who Is Authorized to Confirm Pickup

- **Admin**: Full access to confirm pickup, view inventory, view stock movement history
- **Staff**: Can confirm pickup (enforced by `requireOrderStaff` middleware)
- **Customer**: CANNOT confirm pickup (backend rejects with 403)

Authorization is enforced at the backend level via `requireOrderStaff` middleware, not just hidden frontend buttons.

## How Final Inventory Deduction Works

During pickup confirmation, for each reserved material:
1. Atomic `findOneAndUpdate` with `$expr: { $gte: ['$quantity', material.quantity] }` ensures sufficient stock
2. Deducts `material.quantity` from `quantity` (on-hand)
3. Deducts `material.quantity` from `reservedQuantity`
4. Creates StockMovement record with type 'OUT' and reason 'ORDER_PICKUP'
5. Marks the reservation as 'consumed' in the Production record

All operations happen within a MongoDB transaction with snapshot read concern and majority write concern.

## How Reservation Is Finalized

- Each reserved material in the Production record has a `reservationStatus` field
- During pickup, the status changes from 'reserved' to 'consumed'
- The reservation history is preserved (not deleted)
- The reserved quantity is reduced to 0
- The inventory item is NOT deleted

## How Double Deduction Is Prevented

1. **Status check**: The transaction filters for `status: 'Ready for Pickup'` - if already "Picked Up", the update returns 0 documents and fails
2. **Reservation status check**: Validates no materials have `reservationStatus === 'consumed'`
3. **Atomic inventory update**: Uses `$expr` to verify sufficient stock before deducting
4. **Frontend prevention**: Button shows loading state and is disabled during submission
5. **Optimistic concurrency**: The order update includes `status: 'Ready for Pickup'` in the filter

## How Stock Movement History Is Stored

- Each deduction creates a StockMovement document with: order ID, job order ID, inventory item ID, material name, quantity, movement type ('OUT'), reason ('ORDER_PICKUP'), timestamp, and performing user
- Admin can view all movements at the Inventory tab in AdminPanel
- Movements are sorted by date descending
- Restock movements (from stock-in) are preserved

## How Multiple Materials Are Handled

- The confirm-pickup endpoint iterates through ALL reserved materials in the job order
- Each material gets its own atomic inventory deduction
- Each material gets its own StockMovement record
- All operations happen within the same transaction
- If any material fails, the entire transaction rolls back

## How Customer My Orders/Track Order Is Updated

- **My Orders**: Shows "Picked Up" badge with pickup date; ProductionProgress shows all 5 stages complete
- **Track Order**: Status flow includes "Picked Up" as the final stage; all stages show checkmarks
- **ProductionProgress**: Accepts `orderStatus` and `pickedUpAt` props to display the final "Picked Up" stage

## Tests Executed

### Build Verification
- Frontend: `vite build` succeeded (110 modules transformed)
- Backend: All modified files pass `node --check` syntax validation

### Manual Testing Required
The following tests require a running MongoDB replica set and the application:

1. **Basic Pickup Flow**: Create order → Verify payment → Create job order → Advance to Ready for Pickup → Confirm Pickup → Verify status = "Picked Up"
2. **Inventory Deduction**: Verify on-hand decreases, reserved decreases, available stays correct
3. **Stock Movement**: Verify StockMovement record created with correct data
4. **Double Deduction Prevention**: Attempt second pickup confirmation → verify blocked
5. **Multiple Materials**: Create order with 2+ materials → confirm pickup → verify both deducted
6. **Customer View**: Login as customer → verify "Picked Up" status visible
7. **Authorization**: Attempt pickup as customer → verify 403 error

## Manual Database/Supabase Setup Required

1. **MongoDB Replica Set**: The confirm-pickup endpoint requires a MongoDB replica set for transactions. If using standalone MongoDB, the endpoint returns 503 with a clear error message.

2. **No additional Supabase setup needed**: Staff accounts already use Supabase Auth. The new endpoints use the existing `requireOrderStaff` middleware.

3. **StockMovement collection**: Automatically created by Mongoose when the first movement is created. No manual collection creation needed.

4. **Existing data migration**: Existing Production records without `reservationStatus` will default to 'reserved' when read. No migration script needed.

## Known Limitations

1. **MongoDB Replica Set Required**: Transactions require a replica set. The system gracefully returns 503 if not available.
2. **No cancellation workflow**: Cancelling an order before pickup (to release reserved inventory without consuming stock) is not implemented in Phase 5. This is a future improvement.
3. **No Phase 6 features**: Archive workflow, spreadsheet export, and reporting are explicitly out of scope.
