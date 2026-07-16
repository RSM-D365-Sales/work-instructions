import { Rocket } from 'lucide-react';
import { cn } from '../lib/utils';

interface Props {
  /** Text under the animation; pass '' to hide it. */
  label?: string;
  /** Fill the viewport and center (auth / route loading). */
  fullScreen?: boolean;
  className?: string;
}

/** Loading indicator: a rocket rumbling on the pad, then blasting off.
 *  Keyframes live in index.css (.rocket-loader*); animation is disabled
 *  for prefers-reduced-motion users. */
export default function RocketLoader({ label = 'Loading…', fullScreen = false, className }: Props) {
  const content = (
    <div className={cn('flex flex-col items-center gap-2', className)} role="status" aria-label={label || 'Loading'}>
      <div className="rocket-loader">
        <div className="rocket-loader-pad" />
        <div className="rocket-loader-vehicle">
          <Rocket size={32} className="text-blue-600" />
          <div className="rocket-loader-flame" />
        </div>
      </div>
      {label && <p className="text-sm text-gray-400">{label}</p>}
    </div>
  );

  if (fullScreen) {
    return <div className="min-h-screen flex items-center justify-center">{content}</div>;
  }
  return <div className="py-12 flex justify-center">{content}</div>;
}
