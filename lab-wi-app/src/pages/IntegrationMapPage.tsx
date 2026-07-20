import { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Printer } from 'lucide-react';

// Self-contained graphic authored in public/ (opens / prints / shares on its own),
// embedded here in an iframe so the two never drift.
const SRC = `${import.meta.env.BASE_URL}integration-map.html`;

export default function IntegrationMapPage() {
  const navigate = useNavigate();
  const frameRef = useRef<HTMLIFrameElement>(null);

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
          <h1 className="text-xl font-bold text-gray-900">Integration Map</h1>
          <p className="text-sm text-gray-500">D365 ↔ Rocket Ship — who does what &amp; how they talk</p>
        </div>
        <button
          onClick={() => frameRef.current?.contentWindow?.print()}
          className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
        >
          <Printer size={15} />
          Print
        </button>
        <a
          href={SRC}
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
        src={SRC}
        title="Integration Map"
        className="flex-1 w-full rounded-xl border border-gray-200 bg-white"
      />
    </div>
  );
}
