import { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Printer } from 'lucide-react';

// The agenda is authored as a standalone, self-contained HTML file that lives in
// public/ (so it can also be opened / printed / emailed on its own). We embed the
// exact same file here in an iframe rather than re-implementing it in JSX, so the
// two never drift. BASE_URL respects the Vite base path (/work-instructions/).
const AGENDA_SRC = `${import.meta.env.BASE_URL}workshop-agenda.html`;

export default function WorkshopAgendaPage() {
  const navigate = useNavigate();
  const frameRef = useRef<HTMLIFrameElement>(null);

  function printAgenda() {
    // Same-origin iframe, so we can drive its print dialog directly.
    frameRef.current?.contentWindow?.print();
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)]">
      <div className="flex items-center gap-3 mb-4 shrink-0">
        <button
          onClick={() => navigate('/work-instructions')}
          className="text-gray-400 hover:text-gray-700 transition-colors"
          aria-label="Back to work instructions"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-gray-900">Workshop Agenda</h1>
          <p className="text-sm text-gray-500">Solution review session — tentative</p>
        </div>
        <button
          onClick={printAgenda}
          className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
        >
          <Printer size={15} />
          Print
        </button>
        <a
          href={AGENDA_SRC}
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
        src={AGENDA_SRC}
        title="Workshop Agenda"
        className="flex-1 w-full rounded-xl border border-gray-200 bg-white"
      />
    </div>
  );
}
