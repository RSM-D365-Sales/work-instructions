import { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Printer } from 'lucide-react';

// Self-contained interactive flow authored in public/ (so it can also be opened /
// presented / emailed on its own). Embedded here in an iframe so the two never
// drift. BASE_URL respects the Vite base path (/work-instructions/).
const FLOW_SRC = `${import.meta.env.BASE_URL}master-planning-flow.html`;

export default function MasterPlanningFlowPage() {
  const navigate = useNavigate();
  const frameRef = useRef<HTMLIFrameElement>(null);

  function printFlow() {
    frameRef.current?.contentWindow?.print();
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)]">
      <div className="flex items-center gap-3 mb-4 shrink-0">
        <button
          onClick={() => navigate('/')}
          className="text-gray-400 hover:text-gray-700 transition-colors"
          aria-label="Back to dashboard"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-gray-900">Master Planning Flow</h1>
          <p className="text-sm text-gray-500">D365 Master Planning ↔ Rocket Ship — reagent replenishment</p>
        </div>
        <button
          onClick={printFlow}
          className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
        >
          <Printer size={15} />
          Print
        </button>
        <a
          href={FLOW_SRC}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
        >
          <ExternalLink size={15} />
          Open in new tab
        </a>
      </div>

      <iframe
        ref={frameRef}
        src={FLOW_SRC}
        title="Master Planning Flow"
        className="flex-1 w-full rounded-xl border border-gray-200 bg-white"
      />
    </div>
  );
}
