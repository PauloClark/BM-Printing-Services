# Financial management

Financial Management is an Admin-only view backed by the existing MongoDB order, inventory, production, stock-movement and audit collections, plus an additive `Expense` collection. Mongoose creates that collection when an expense is first saved. The feature does not migrate or rewrite existing business records.

## Accounting definitions

- **Verified payments received** are payment submissions with `status: Verified`, a verifier identity and a verification timestamp, plus cash-payment records with a verifier identity and timestamp. A displayed order payment status by itself is not cash evidence.
- **Fulfilled sales revenue** is the stored order total for orders in `Picked Up` or `Completed` status with a recorded pickup/completion timestamp. It is recognized by fulfillment date, regardless of payment state. Cancelled orders do not contribute revenue.
- **Outstanding customer balances** are calculated from current non-cancelled order totals minus payments meeting the verification evidence above. This is a current balance, not a historical as-of-date receivables ledger.
- **Direct material cost** is counted only for recorded order-pickup stock movements with an explicit unit-cost snapshot. A movement with no known cost is excluded and makes the selected period incomplete. Cost basis is weighted average for newly recorded receipts when the existing on-hand basis is known. If there is opening stock of unknown cost, incoming purchases do not make its blended basis appear known.
- **Inventory purchases** are recorded separately from operating expenses. Invoice cost is an inventory asset purchase; only the amount actually paid contributes to cash outflow, on the recorded payment date.
- **Operating expenses** are recorded as paid or unpaid. Expense amounts are shown by incurred date; only paid expenses count as cash outflow, using their separate paid date. Partial operating-expense payments are not accepted by this UI.
- **Estimated net profit** is fulfilled sales revenue less costed direct material consumption and active operating expenses. It is explicitly marked partial when historical material cost, consumption coverage, or fulfillment dates are missing. It is not a tax or statutory accounting statement.
- **Net cash movement** is verified payments received less amounts recorded paid for inventory purchases and operating expenses. Refunds are not represented in the current data model and are not inferred.

All user-entered money is stored as integer centavos. Reports use the Asia/Manila calendar for date-range boundaries.

## Data quality and controls

No historical costs or payment confirmations are backfilled. Admins may set an audited current inventory unit-cost basis with a reason; this does not create a purchase or a cash transaction. Material consumption snapshots are recorded when an Admin/authorized pickup workflow deducts reserved stock. Corrections to consumed-material costs require a reason, update the matching movement and job snapshot, and write an audit record in the same MongoDB transaction.

Expense corrections require a reason; voiding is soft-delete only and retains the record and audit history. Inventory purchases are stored atomically with the stock quantity change in the inventory document and carry an idempotency key to prevent duplicate restocks.

The current local database was observed to be a standalone MongoDB server, not a replica set. The existing multi-document pickup workflow and material-cost correction workflow require replica-set transactions. They fail explicitly in standalone mode. Enabling those flows requires an appropriately configured MongoDB replica set; this feature does not change database topology.
