-- Migration 043: Add attachment step type + storage bucket
-- A work-instruction step where the operator attaches supporting documents
-- (PDF, image, spreadsheet, …) to the production order via a paperclip
-- button. Files are stored in the 'po-attachments' storage bucket under
-- {production_order_id}/{wi_step_id}/…; the file list is captured on the
-- po_step's actual_values ({files: [{name, path, size, content_type}]}),
-- so anyone can reopen the completed step later and view the documents.

-- 1) Extend check constraint on step_templates ------------------------
ALTER TABLE public.step_templates
  DROP CONSTRAINT IF EXISTS step_templates_step_type_check;

ALTER TABLE public.step_templates
  ADD CONSTRAINT step_templates_step_type_check
    CHECK (step_type IN (
      'gather_inputs','gather_equipment','gather_reagents',
      'weigh','mix','transfer','ph_adjust','heat','cool','observe',
      'notes','production_break','print_labels','possible_deviation',
      'attachment','user_defined','custom'
    ));

-- 2) Insert system step template --------------------------------------
INSERT INTO public.step_templates (name, description, step_type, parameter_schema, is_system)
VALUES (
  'Add Attachment',
  'Attach supporting documents (PDF, image, spreadsheet, …) to the production order.',
  'attachment',
  '{"prompt": {"type": "string", "label": "Attachment Prompt"}, "required": {"type": "boolean", "label": "Attachment Required"}}',
  true
)
ON CONFLICT DO NOTHING;

-- 3) Storage bucket for the files --------------------------------------
-- Public bucket: files are viewable via their public URL (fine for the demo;
-- switch public → false and serve signed URLs if the content becomes real).
-- 25 MB per-file limit.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('po-attachments', 'po-attachments', true, 26214400)
ON CONFLICT (id) DO NOTHING;

-- 4) Storage policies — any signed-in user can upload / list / remove
--    files in this bucket (removal lets an operator replace a wrong file
--    before completing the step).
DROP POLICY IF EXISTS "po_attachments_insert" ON storage.objects;
CREATE POLICY "po_attachments_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'po-attachments');

DROP POLICY IF EXISTS "po_attachments_select" ON storage.objects;
CREATE POLICY "po_attachments_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'po-attachments');

DROP POLICY IF EXISTS "po_attachments_delete" ON storage.objects;
CREATE POLICY "po_attachments_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'po-attachments');
