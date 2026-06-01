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
  status: ReagentOrderStatus;
  created_by: string;
  requested_by: string;
  created_at: string;
  updated_at: string;
  transfer_order_number?: string | null;
  transfer_order_status?: TransferOrderStatus | null;
  transfer_order_error?: string | null;
  transfer_order_created_at?: string | null;
  reagent_item?: ReagentItem;
  lab?: Lab;
  creator?: Profile;
  requester?: Profile;
  items?: ReagentOrderItem[];
}

export interface Profile {
  id: string;
  full_name: string;
  email?: string;
  role: UserRole;
  default_lab_id?: string | null;
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
  | 'weigh'
  | 'mix'
  | 'transfer'
  | 'ph_adjust'
  | 'heat'
  | 'cool'
  | 'observe'
  | 'notes'             // free-text notes about the order up to this step
  | 'production_break'  // divider marking the boundary between parts of a run
  | 'print_labels'
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

export type POStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';

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
  model?: string;
  manufacturer?: string;
  serial_number?: string;
  location?: string;
  notes?: string;
  status: ScaleStatus;
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
export type QCResultType = 'numeric' | 'text';

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
