# D365 → Production Order Sync (Power Automate)

This edge function receives a webhook from Power Automate whenever a new
`ProdTable` record is created in D365 F&SC and inserts a matching row into
`public.production_orders`.

---

## 1. Deploy the function

From `lab-wi-app/`:

```powershell
supabase functions deploy ingest-d365-prod-order --no-verify-jwt
```

`--no-verify-jwt` is required because Power Automate will not present a
Supabase user JWT. The function uses its own shared-secret header instead.

## 2. Apply the migration

```powershell
supabase db push
```

Migration `023_d365_prod_sync.sql` adds `production_orders.d365_prod_id`
plus a partial-unique index for idempotency.

## 3. Configure secrets

Pick (or create) a Supabase profile that the synced orders should be
attributed to — typically your service / integration account. Copy its
`profiles.id` (UUID). Then:

```powershell
# Choose any long random string – this is the shared secret
supabase secrets set D365_INGEST_SECRET="<long-random-string>"

# UUID of an existing row in public.profiles
supabase secrets set D365_SYNC_USER_ID="<profile-uuid>"
```

The function URL will be:

```
https://<your-project-ref>.supabase.co/functions/v1/ingest-d365-prod-order
```

## 4. Build the Power Automate flow

1. **Trigger:** *Dataverse / Finance and Operations apps → When a record is
   created* — Entity name: **Production orders** (`ProdTable`) — Company:
   the legal entity that owns the orders.
2. **(Optional) Condition:** filter to only the production-order types you
   care about, e.g. `ProductionType eq 'StandardOrder'`.
3. **HTTP action:** *HTTP – HTTP*
   - Method: `POST`
   - URI: `https://<project-ref>.supabase.co/functions/v1/ingest-d365-prod-order`
   - Headers:
     - `Content-Type` : `application/json`
     - `x-webhook-secret` : *the value you set as `D365_INGEST_SECRET`*
   - Body (use the dynamic-content picker to swap in the trigger fields):
     ```json
     {
       "prod_id":       "@{triggerOutputs()?['body/ProductionOrderNumber']}",
       "item_number":   "@{triggerOutputs()?['body/ItemNumber']}",
       "product_name":  "@{triggerOutputs()?['body/ProductSearchName']}",
       "qty_scheduled": @{triggerOutputs()?['body/ProductionQuantity']},
       "unit":          "@{triggerOutputs()?['body/InventoryUnitSymbol']}",
       "required_date": "@{triggerOutputs()?['body/DeliveryDate']}",
       "notes":         "Created from D365 ProdTable"
     }
     ```
     (Field names vary by environment — open the trigger's *Show raw outputs*
     once to confirm the exact JSON paths.)
4. **(Optional) Parse JSON** action on the HTTP response to capture
   `production_order_id` for downstream steps (e.g. writing it back to
   `ProdTable.ExternalReference`).

## 5. Test

In D365, create a Production order whose item number matches an existing
**approved** work instruction in the app, then watch the Power Automate run
history.

Expected responses:

| HTTP | Body                                                          | Meaning                                                   |
|------|---------------------------------------------------------------|-----------------------------------------------------------|
| 200  | `{ success: true, status: "created", production_order_id }`   | Row inserted.                                             |
| 200  | `{ success: true, status: "duplicate", production_order_id }` | Same `prod_id` was already ingested — safe to ignore.     |
| 401  | `{ success: false, error: "Unauthorized" }`                   | `x-webhook-secret` header is missing or wrong.            |
| 422  | `{ success: false, error: "No approved work instruction…" }`  | No approved WI matches the D365 item number / product.    |
| 4xx/5xx | `{ success: false, error: "…" }`                           | Other validation / database error.                        |

## 6. Field mapping (D365 → app)

| D365 ProdTable field          | App `production_orders` column |
|-------------------------------|--------------------------------|
| `ProductionOrderNumber`       | `d365_prod_id` (+ `lot_number`)|
| `ItemNumber`                  | → resolves `work_instruction_id` via `reagent_items.item_number` |
| `ProductionQuantity`          | `batch_size`                   |
| `InventoryUnitSymbol`         | `batch_size_unit`              |
| `DeliveryDate`                | `required_by`                  |
| *(constant)*                  | `status` = `pending`           |
| *(constant)*                  | `created_by` = `D365_SYNC_USER_ID` |

The order will show up immediately on the **Unscheduled Orders** page
because `scheduled_start` is left NULL — an admin can then assign a start
time from there.
