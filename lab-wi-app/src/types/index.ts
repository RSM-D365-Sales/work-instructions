// Central TypeScript types matching the Supabase schema

export type UserRole = 'admin' | 'author' | 'approver' | 'operator' | 'lab';

export type ReagentOrderStatus = 'pending' | 'approved' | 'in_progress' | 'fulfilled' | 'cancelled';
export type TransferOrderStatus = 'pending' | 'created' | 'failed' | 'skipped';

export interface ReagentOrderItem {
  id: string;
  order_id: string;
  line_number: number;
  reagent_item_id: string;
  quantity: number;
  unit: string;
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

export interface ReagentItem {
  id: string;
  item_number: string;
  d365_product_id?: string;
  d365_synced_at?: string;
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
