// Central TypeScript types matching the Supabase schema

export type UserRole = 'admin' | 'author' | 'approver' | 'operator' | 'lab';

export type ReagentOrderStatus = 'pending' | 'in_progress' | 'fulfilled' | 'cancelled';
export type TransferOrderStatus = 'pending' | 'created' | 'failed' | 'skipped';

export interface ReagentOrderItem {
  id: string;
  order_id: string;
  line_number: number;
  reagent_item_id: string;
  quantity: number;
  unit: string;
  // Delivery details — populated when the line is delivered to the requesting lab.
  delivered_quantity?: number | null;
  from_location?: string | null;   // scanned source bin at the REAGENT lab
  to_location?: string | null;     // scanned bin at the destination lab
  lot_number?: string | null;
  delivered_at?: string | null;
  delivery_comment?: string | null;   // note specific to this line
  created_at: string;
  reagent_item?: ReagentItem;
}

export interface ReagentOrder {
  id: string;
  order_number: string;
  // Legacy single-item columns — present on orders created before
  // migration 020. New orders leave these NULL and use `items`.
  reagent_item_id?: string | null;
  quantity?: number | null;
  unit?: string | null;
  lab_id: string;
  requested_for_date: string;
  notes?: string | null;
  high_priority: boolean;
  /** Demo flag set at order creation — surfaces the order on the planner
   *  "Insufficient Stock" dashboard tile so a production order can be raised. */
  insufficient_stock?: boolean;
  status: ReagentOrderStatus;
  created_by: string;
  requested_by: string;
  created_at: string;
  updated_at: string;
  transfer_order_number?: string | null;
  transfer_order_status?: TransferOrderStatus | null;
  transfer_order_error?: string | null;
  transfer_order_created_at?: string | null;
  delivery_comment?: string | null;   // note applied to all of a lab's delivered orders
  reagent_item?: ReagentItem;
  lab?: Lab;
  creator?: Profile;
  requester?: Profile;
  items?: ReagentOrderItem[];
}

/** One weekday's status in a user's weekly working pattern. */
export type WorkDayState = 'work' | 'off' | 'pto';

export interface Profile {
  id: string;
  full_name: string;
  email?: string;
  role: UserRole;
  default_lab_id?: string | null;
  /** 7 entries indexed by weekday (0=Sun..6=Sat); null = all working days. */
  work_schedule?: WorkDayState[] | null;
  created_at: string;
}

export interface Lab {
  id: string;
  warehouse_id: string;
  name: string;
  description?: string | null;
  site_id?: string | null;
  default_container_type?: string | null;
  d365_company?: string | null;
  d365_synced_at?: string | null;
  is_active: boolean;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Material {
  id: string;
  name: string;
  description?: string;
  unit: string;
  cas_number?: string;
  created_at: string;
  created_by?: string;
}

export type StepType =
  | 'gather_inputs'     // legacy — keep for existing saved WIs
  | 'gather_equipment'  // free-text lab equipment list
  | 'gather_reagents'   // catalog-linked reagent list
  | 'weigh'             // measure a solid mass to a target within tolerance
  | 'dispense'          // measure a liquid volume to a target within tolerance (weigh for liquids)
  | 'mix'               // timed mixing on a stir plate
  | 'agitate'           // stir / vortex / invert (distinct from timed mix)
  | 'transfer'          // move material between vessels (pour/aliquot/decant/elute/filter)
  | 'bring_to_volume'   // Q.S. / dilute to a final volume
  | 'ph_adjust'
  | 'heat'
  | 'cool'
  | 'freeze'            // freeze / frozen storage
  | 'thaw'              // thaw from frozen
  | 'overnight'         // an overnight hold / incubation
  | 'observe'
  | 'notes'             // free-text notes about the order up to this step
  | 'production_break'  // divider marking the boundary between parts of a run
  | 'print_labels'
  | 'cap'               // cap / seal / parafilm the container
  | 'package'           // package / box / store / deliver to destination
  | 'attachment'        // attach supporting documents (PDF, image, …) to the order
  | 'possible_deviation' // flag a possible deviation; capture impacted qty + notify supervisor
  | 'user_defined'      // author-built template; fields defined in parameter_schema
  | 'custom';

export interface ParameterFieldDef {
  type: 'string' | 'number' | 'boolean';
  label: string;
  options?: (string | number)[];
  default?: string | number | boolean;
  required?: boolean;
}

export type ParameterSchema = Record<string, ParameterFieldDef | { type: 'array'; label: string; items: Record<string, ParameterFieldDef> }>;

export interface StepTemplate {
  id: string;
  name: string;
  description?: string;
  step_type: StepType;
  parameter_schema: ParameterSchema;
  is_system: boolean;
  created_at: string;
  created_by?: string;
}

export type WIStatus = 'draft' | 'pending_review' | 'approved' | 'rejected';

export interface WorkInstruction {
  id: string;
  title: string;
  description?: string;
  product_name: string;
  reagent_item_id?: string;
  target_molarity?: number;
  /** Expected duration of one production run, in minutes. Used to
   *  pre-fill scheduled_end on a new production order and to block
   *  time on the dashboard gantt. */
  scheduled_minutes?: number | null;
  version: number;
  status: WIStatus;
  created_by: string;
  approved_by?: string;
  approved_at?: string;
  created_at: string;
  updated_at: string;
  creator?: Profile;
}

export type WIStepParameters = Record<string, unknown>;

export interface WIStep {
  id: string;
  work_instruction_id: string;
  step_template_id?: string;
  /** Lineage token: id of this step's earliest ancestor across WI versions.
   *  Carried through clones/re-saves so the version diff survives renames. */
  source_step_id?: string | null;
  step_order: number;
  name: string;
  description?: string;
  parameters: WIStepParameters;
  created_at: string;
  template?: StepTemplate;
}

export type ApprovalAction = 'submitted' | 'approved' | 'rejected' | 'revision_requested';

export interface WIApproval {
  id: string;
  work_instruction_id: string;
  reviewer_id: string;
  action: ApprovalAction;
  comment?: string;
  created_at: string;
  reviewer?: Profile;
}

export type POStatus = 'pending' | 'in_progress' | 'awaiting_qc' | 'completed' | 'failed' | 'cancelled';

export interface ProductionOrder {
  id: string;
  work_instruction_id: string;
  wi_version?: number;
  /** Production order number — D365 ProdId for ingested orders, "MAN######" for UI-created ones. */
  production_order_number: string;
  /** The originating D365 ProdId, present only for orders ingested from D365. */
  d365_prod_id?: string | null;
  lot_number: string;
  batch_size?: number;
  batch_size_unit?: string;
  status: POStatus;
  notes?: string;
  created_by: string;
  assigned_to?: string;
  /** Date the finished product is required by (separate from scheduled_start). */
  required_by?: string | null;
  /** Planned start time for this run (drives the gantt block). */
  scheduled_start?: string | null;
  /** Planned end time, normally scheduled_start + WI.scheduled_minutes. */
  scheduled_end?: string | null;
  started_at?: string;
  completed_at?: string;
  /** D365 ProdProductionOrderStart message tracking (set when the order is started). */
  d365_start_status?: 'pending' | 'sent' | 'failed' | 'skipped' | null;
  d365_start_error?: string | null;
  d365_start_sent_at?: string | null;
  /** Reagent order this production order was raised from (planner flow). */
  source_reagent_order_id?: string | null;
  /** D365 OData ProductionOrderHeaders create tracking. */
  d365_create_status?: 'pending' | 'sent' | 'failed' | 'skipped' | null;
  d365_create_error?: string | null;
  created_at: string;
  work_instruction?: WorkInstruction;
  creator?: Profile;
  assignee?: Profile;
}

/** D365 product classification: finished good, raw material, packaging. */
export type ItemType = 'FG' | 'RM' | 'PKG';

export interface ReagentItem {
  id: string;
  item_number: string;
  d365_product_id?: string;
  d365_synced_at?: string;
  item_type: ItemType;
  product_name: string;
  search_name?: string;
  cas_number?: string;
  molecular_formula?: string;
  molecular_weight?: number;
  purity_grade?: string;
  unit_of_measure: string;
  min_order_qty?: number;
  vendor?: string;
  storage_conditions?: string;
  hazard_class?: string;
  ghs_pictograms?: string[];
  sds_url?: string;
  is_active: boolean;
  lot_controlled: boolean;
  notes?: string;
  created_at: string;
  updated_at: string;
  created_by?: string;
  updated_by?: string;
}

// ── On-hand inventory (D365 Finance & Supply Chain style) ───
export interface InventoryOnHand {
  id: string;
  reagent_item_id: string;
  lab_id: string;
  physical_inventory: number;
  physical_reserved: number;
  ordered_in: number;
  on_order: number;
  d365_synced_at: string;
  created_at: string;
  updated_at: string;
  reagent_item?: ReagentItem;
  lab?: Lab;
}

export type POStepStatus = 'pending' | 'in_progress' | 'completed' | 'skipped';

// ── Scales ──────────────────────────────────────────────────
export type ScaleConnectionType = 'http_rest' | 'websocket' | 'modbus_tcp' | 'opc_ua';
export type ScaleStatus = 'active' | 'inactive' | 'maintenance';
/** What kind of instrument an equipment row is — drives which step can use it
 *  (balances → Weigh, pH meters → Adjust pH). */
export type EquipmentType = 'balance' | 'ph_meter' | 'osmometer' | 'other';

export interface ScaleConnConfig {
  // http_rest / websocket
  url?: string;
  auth_token?: string;
  polling_interval_ms?: number;
  // modbus_tcp
  host?: string;
  port?: number;
  unit_id?: number;
  register_address?: number;
  // opc_ua
  endpoint_url?: string;
  node_id?: string;
  username?: string;
  password?: string;
}

export interface Scale {
  id: string;
  name: string;
  barcode?: string | null;
  // B4: flag-for-calibration (set from Quality Trends, cleared on Scales page)
  calibration_flagged_at?: string | null;
  calibration_flagged_by?: string | null;
  calibration_flag_reason?: string | null;
  last_calibrated_at?: string | null;
  calibration_flagger?: Pick<Profile, 'id' | 'full_name'> | null;
  model?: string;
  manufacturer?: string;
  serial_number?: string;
  location?: string;
  notes?: string;
  status: ScaleStatus;
  equipment_type: EquipmentType;
  conn_a_type: ScaleConnectionType;
  conn_a_label: string;
  conn_a_config: ScaleConnConfig;
  conn_b_type?: ScaleConnectionType | null;
  conn_b_label: string;
  conn_b_config: ScaleConnConfig;
  preferred_conn: 1 | 2;
  created_at: string;
  updated_at: string;
}
// ────────────────────────────────────────────────────────────

export interface POStep {
  id: string;
  production_order_id: string;
  wi_step_id: string;
  step_order: number;
  status: POStepStatus;
  actual_values: Record<string, unknown>;
  notes?: string;
  operator_id?: string;
  started_at?: string;
  completed_at?: string;
  created_at: string;
  wi_step?: WIStep;
}

// ── Quality Control ─────────────────────────────────────────
export type QCResultType = 'numeric' | 'text' | 'passfail';

/** A QC test specification defined on a reagent item (the panel that
 *  every production order of that item is tested against). */
export interface QCTest {
  id: string;
  reagent_item_id: string;
  test_order: number;
  name: string;
  unit?: string | null;
  result_type: QCResultType;
  lower_limit?: number | null;
  upper_limit?: number | null;
  target?: number | null;
  expected_text?: string | null;
  method?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by?: string | null;
}

/** A measured QC value captured against a production order. The spec
 *  limits are snapshotted here so certificates and trends stay stable. */
export interface QCResult {
  id: string;
  production_order_id: string;
  qc_test_id?: string | null;
  test_order: number;
  name: string;
  unit?: string | null;
  result_type: QCResultType;
  lower_limit?: number | null;
  upper_limit?: number | null;
  target?: number | null;
  expected_text?: string | null;
  method?: string | null;
  result_numeric?: number | null;
  result_text?: string | null;
  passed?: boolean | null;
  instrument?: string | null;
  comment?: string | null;
  tested_by?: string | null;
  tested_at?: string | null;
  created_at: string;
  updated_at: string;
  tester?: Profile;
}

export type CertType = 'COA' | 'COQ';

export interface QCCertificate {
  id: string;
  production_order_id: string;
  certificate_number: string;
  cert_type: CertType;
  issued_by?: string | null;
  issued_at: string;
  notes?: string | null;
  created_at: string;
  issuer?: Profile;
}

// ── Inventory batches + cycle counting ──────────────────────
/** One lot of an item at a lab. Batch quantities for an item×lab sum to
 *  inventory_on_hand.physical_inventory. */
export interface InventoryBatch {
  id: string;
  reagent_item_id: string;
  lab_id: string;
  batch_number: string;
  quantity: number;
  received_at?: string | null;
  expiration_date?: string | null;
  created_at: string;
  updated_at: string;
  reagent_item?: Pick<ReagentItem, 'id' | 'item_number' | 'product_name' | 'item_type' | 'unit_of_measure'>;
  lab?: Pick<Lab, 'id' | 'name' | 'warehouse_id'>;
}

/** A posted cycle count for a lab (one line per batch counted). Posting
 *  adjusts inventory and mimics the sync to D365. */
export interface CycleCount {
  id: string;
  lab_id: string;
  counted_by?: string | null;
  status: 'posted';
  total_lines: number;
  total_variance: number;
  d365_sync_status: 'pending' | 'sent' | 'failed';
  d365_synced_at?: string | null;
  created_at: string;
  counter?: Pick<Profile, 'id' | 'full_name'>;
  lab?: Pick<Lab, 'id' | 'name'>;
}

export interface CycleCountLine {
  id: string;
  cycle_count_id: string;
  inventory_batch_id?: string | null;
  reagent_item_id: string;
  batch_number: string;
  expected_quantity: number;
  counted_quantity: number;
  created_at: string;
}

// ── Planned production orders (D365 Master Planning) ────────
export type PlannedOrderStatus = 'unprocessed' | 'firmed';

/** One demand line behind a planned order (the D365 Pegging grid). */
export interface PlannedOrderPegging {
  reference: string;               // 'Transfer order' | 'Safety stock' | 'BOM line' | …
  number?: string | null;          // the demand document number, when there is one
  requirement_date?: string;       // YYYY-MM-DD
  quantity?: number;
}

/** A D365-style planned production / batch order. Firming creates a
 *  production order against the item's approved work instruction
 *  (its default formula). requirement_date is the demand date and is
 *  never edited; order_date / delivery_date are, with a warning when
 *  moved past the requirement date. */
export interface PlannedProductionOrder {
  id: string;
  number: string;
  reference: string;
  reagent_item_id: string;
  quantity: number;
  unit: string;
  requirement_date: string;        // YYYY-MM-DD (read-only in UI)
  order_date: string;              // YYYY-MM-DD (editable)
  delivery_date?: string | null;   // YYYY-MM-DD (editable)
  planning_priority: number;
  site: string;
  warehouse: string;
  plan_name: string;
  bom_number?: string | null;
  route_number?: string | null;
  pegging: PlannedOrderPegging[];
  status: PlannedOrderStatus;
  d365_ref_id?: string | null;
  firmed_production_order_id?: string | null;
  firmed_by?: string | null;
  firmed_at?: string | null;
  created_at: string;
  updated_at: string;
  item?: Pick<ReagentItem, 'id' | 'item_number' | 'product_name' | 'unit_of_measure'> | null;
}

// ── Notifications (E3) ──────────────────────────────────────
export type NotificationSeverity = 'info' | 'warning' | 'critical';
export type NotificationChannel = 'in_app' | 'email' | 'teams';

/** A persisted notification, written by src/lib/notifications.ts at trigger
 *  points (possible deviation, high-priority reagent order) and surfaced on
 *  the admin Notifications page. Named AppNotification to avoid clashing
 *  with the DOM's built-in Notification type. Read state is group-level:
 *  the first admin to mark it read clears it for everyone. */
export interface AppNotification {
  id: string;
  type: string;                    // 'possible_deviation' | 'high_priority_order' | future types
  severity: NotificationSeverity;
  title: string;
  body?: string | null;
  channels: NotificationChannel[];
  audience: UserRole[];
  link?: string | null;            // in-app route to the related record
  production_order_id?: string | null;
  reagent_order_id?: string | null;
  work_instruction_id?: string | null;
  metadata: Record<string, unknown>;
  created_by?: string | null;
  created_at: string;
  read_at?: string | null;
  read_by?: string | null;
  creator?: Pick<Profile, 'id' | 'full_name'> | null;
  reader?: Pick<Profile, 'id' | 'full_name'> | null;
}
