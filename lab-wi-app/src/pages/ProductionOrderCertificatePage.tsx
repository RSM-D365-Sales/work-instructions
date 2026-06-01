import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { ProductionOrder, QCResult, QCCertificate, CertType } from '../types';
import { formatSpec, formatResultValue } from '../lib/qc';
import { cn } from '../lib/utils';
import { ArrowLeft, Printer, FileText, CheckCircle, XCircle, FlaskConical } from 'lucide-react';

export default function ProductionOrderCertificatePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { profile } = useAuth();
  const [certType, setCertType] = useState<CertType>('COA');

  const { data: order } = useQuery<ProductionOrder>({
    queryKey: ['production-order-cert', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('production_orders')
        .select('*, work_instruction:work_instructions(title, product_name, target_molarity, version, reagent_item:reagent_items(item_number, product_name, unit_of_measure, cas_number, storage_conditions)), creator:profiles!created_by(full_name), assignee:profiles!assigned_to(full_name)')
        .eq('id', id!)
        .single();
      if (error) throw error;
      return data as ProductionOrder;
    },
  });

  const { data: results = [] } = useQuery<QCResult[]>({
    queryKey: ['qc-results', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('qc_results')
        .select('*, tester:profiles!tested_by(full_name)')
        .eq('production_order_id', id!)
        .order('test_order');
      if (error) throw error;
      return data as QCResult[];
    },
  });

  const { data: certificate } = useQuery<QCCertificate | null>({
    queryKey: ['qc-certificate', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('qc_certificates')
        .select('*, issuer:profiles!issued_by(full_name)')
        .eq('production_order_id', id!)
        .order('issued_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as QCCertificate) ?? null;
    },
  });

  const issueMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('qc_certificates').insert({
        production_order_id: id!,
        cert_type: certType,
        issued_by: profile!.id,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['qc-certificate', id] }),
  });

  const wi = order?.work_instruction as any;
  const reagent = wi?.reagent_item as any;
  const measured = results.filter(r => r.result_numeric != null || (r.result_text ?? '') !== '');
  const anyFail = results.some(r => r.passed === false);
  const released = measured.length > 0 && !anyFail;

  const issuedDate = certificate ? new Date(certificate.issued_at) : null;
  const mfgDate = order?.completed_at ? new Date(order.completed_at) : (order?.created_at ? new Date(order.created_at) : null);

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      {/* Toolbar (hidden when printing) */}
      <div className="no-print flex items-center justify-between">
        <button onClick={() => navigate(`/production-orders/${id}`)} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800">
          <ArrowLeft size={16} /> Back to order
        </button>
        <div className="flex items-center gap-2">
          {!certificate && (
            <>
              <select
                value={certType}
                onChange={e => setCertType(e.target.value as CertType)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
              >
                <option value="COA">Certificate of Analysis</option>
                <option value="COQ">Certificate of Quality</option>
              </select>
              <button
                onClick={() => issueMutation.mutate()}
                disabled={issueMutation.isPending || measured.length === 0}
                title={measured.length === 0 ? 'Capture QC results first' : 'Issue certificate'}
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                <FileText size={15} /> {issueMutation.isPending ? 'Issuing…' : 'Issue Certificate'}
              </button>
            </>
          )}
          {certificate && (
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg font-medium hover:bg-emerald-700"
            >
              <Printer size={15} /> Print / Save as PDF
            </button>
          )}
        </div>
      </div>

      {measured.length === 0 && (
        <div className="no-print bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
          No QC results have been captured for this order yet. Record results on the production order before issuing a certificate.
        </div>
      )}

      {/* The certificate sheet */}
      <div className="print-area bg-white rounded-xl border border-gray-200 p-10 text-gray-900">
        {/* Header */}
        <div className="flex items-start justify-between border-b-2 border-gray-800 pb-5">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 text-white p-2 rounded-lg">
              <FlaskConical size={26} />
            </div>
            <div>
              <p className="text-lg font-bold leading-tight">Reagent Production Laboratory</p>
              <p className="text-xs text-gray-500">Quality Control Release</p>
            </div>
          </div>
          <div className="text-right">
            <h1 className="text-xl font-bold tracking-tight">
              {certificate?.cert_type === 'COQ' ? 'Certificate of Quality' : 'Certificate of Analysis'}
            </h1>
            {certificate && (
              <p className="text-sm text-gray-500 mt-1 font-mono">{certificate.certificate_number}</p>
            )}
          </div>
        </div>

        {/* Product / lot metadata */}
        <div className="grid grid-cols-2 gap-x-10 gap-y-3 mt-6 text-sm">
          <Field label="Product" value={reagent?.product_name ?? wi?.product_name ?? '—'} />
          <Field label="Item Number" value={reagent?.item_number ?? '—'} mono />
          <Field label="Lot Number" value={order?.lot_number ?? '—'} mono strong />
          <Field label="Production Order" value={order?.production_order_number ?? '—'} mono />
          <Field label="Batch Size" value={order?.batch_size != null ? `${order.batch_size} ${order.batch_size_unit ?? ''}`.trim() : '—'} />
          <Field label="CAS Number" value={reagent?.cas_number ?? '—'} />
          <Field label="Manufacture Date" value={mfgDate ? mfgDate.toLocaleDateString() : '—'} />
          <Field label="Storage" value={reagent?.storage_conditions ?? '—'} />
        </div>

        {/* Results table */}
        <table className="w-full text-sm mt-7 border-t border-gray-200">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b border-gray-300">
              <th className="py-2 pr-3 font-semibold">Test</th>
              <th className="py-2 px-3 font-semibold">Method</th>
              <th className="py-2 px-3 font-semibold">Specification</th>
              <th className="py-2 px-3 font-semibold">Result</th>
              <th className="py-2 pl-3 font-semibold text-right">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {results.length === 0 ? (
              <tr><td colSpan={5} className="py-6 text-center text-gray-400">No tests recorded</td></tr>
            ) : results.map(r => (
              <tr key={r.id}>
                <td className="py-2.5 pr-3 font-medium">{r.name}</td>
                <td className="py-2.5 px-3 text-gray-500">{r.method ?? '—'}</td>
                <td className="py-2.5 px-3 text-gray-700">{formatSpec(r)}</td>
                <td className="py-2.5 px-3 font-medium">
                  {formatResultValue(r.result_type, r.result_numeric, r.result_text, r.unit)}
                </td>
                <td className="py-2.5 pl-3 text-right">
                  {r.passed === true && <span className="text-xs font-bold text-green-700">PASS</span>}
                  {r.passed === false && <span className="text-xs font-bold text-red-700">FAIL</span>}
                  {r.passed == null && <span className="text-xs text-gray-400">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Disposition */}
        <div className={cn(
          'mt-7 flex items-center gap-3 rounded-lg border px-4 py-3',
          released ? 'border-green-300 bg-green-50' : anyFail ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-gray-50'
        )}>
          {released ? <CheckCircle className="text-green-600" size={22} /> : anyFail ? <XCircle className="text-red-600" size={22} /> : <FileText className="text-gray-400" size={22} />}
          <div>
            <p className={cn('font-bold', released ? 'text-green-800' : anyFail ? 'text-red-800' : 'text-gray-700')}>
              {released ? 'RELEASED — Conforms to specification' : anyFail ? 'REJECTED — Out of specification' : 'PENDING — Incomplete testing'}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              {measured.length} of {results.length} test{results.length !== 1 ? 's' : ''} recorded
            </p>
          </div>
        </div>

        {/* Signatures */}
        <div className="grid grid-cols-2 gap-10 mt-10 text-sm">
          <Signature label="Performed / Tested by" name={(results.find(r => (r as any).tester)?.['tester'] as any)?.full_name ?? (order?.assignee as any)?.full_name} date={mfgDate} />
          <Signature label="Issued / Approved by" name={(certificate?.issuer as any)?.full_name} date={issuedDate} />
        </div>

        <p className="text-[10px] text-gray-400 mt-8 pt-4 border-t border-gray-100 text-center">
          This certificate was generated electronically from the Lab WI System and is valid without signature when issued with a certificate number.
        </p>
      </div>
    </div>
  );
}

function Field({ label, value, mono, strong }: { label: string; value: string; mono?: boolean; strong?: boolean }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <p className={cn('mt-0.5', mono && 'font-mono', strong ? 'text-base font-bold' : 'text-gray-800')}>{value}</p>
    </div>
  );
}

function Signature({ label, name, date }: { label: string; name?: string; date: Date | null }) {
  return (
    <div>
      <div className="h-8 border-b border-gray-400" />
      <p className="text-xs font-semibold text-gray-700 mt-1">{label}</p>
      <p className="text-sm text-gray-800">{name ?? '—'}</p>
      <p className="text-xs text-gray-400">{date ? date.toLocaleDateString() : ''}</p>
    </div>
  );
}
