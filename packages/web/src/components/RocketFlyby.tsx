import { Rocket } from '@/components/Rocket';

/**
 * The login background fly-by: three rockets cross in sequence, on a short
 * loop — one climbing left-to-right, one right-to-left, one straight up — then
 * it repeats. Decoration only (aria-hidden); it sits behind the panel content
 * and is hidden under `prefers-reduced-motion`. The timing and paths live in
 * index.css (`uk-fly-a/b/c`), each anchored to the corner it launches from.
 */
export function RocketFlyby() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <div className="uk-fly-a absolute bottom-0 left-0">
        <Rocket />
      </div>
      <div className="uk-fly-b absolute right-0 bottom-0">
        <Rocket />
      </div>
      <div className="uk-fly-c absolute bottom-0" style={{ left: 'calc(50% - 17px)' }}>
        <Rocket />
      </div>
    </div>
  );
}
