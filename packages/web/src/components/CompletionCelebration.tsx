import { Check } from 'lucide-react';
import type { CSSProperties } from 'react';
import { Rocket } from '@/components/Rocket';

/**
 * The little burst thrown when a client finishes a lesson.
 *
 * Stars fly outward from a check that pops in — the orbit mark's moving point,
 * multiplied for a beat. Tinted along the brand's indigo→violet arc so it reads
 * as Kosmos rather than party confetti. It plays once and settles to nothing;
 * `motion-reduce` hides it, since the "Aula concluída" card says the same thing
 * without asking anyone's vestibular system for permission.
 *
 * Purely decorative — `aria-hidden`, pointer-events off — because the meaning
 * lives in the card and the badge, not here.
 */

const PARTICLES = Array.from({ length: 18 }, (_, index) => {
  const angle = (index / 18) * Math.PI * 2;
  const distance = 66 + (index % 3) * 26;
  return {
    tx: Math.cos(angle) * distance,
    ty: Math.sin(angle) * distance,
    hue: 250 + ((index * 6) % 34),
    delay: (index % 5) * 24,
  };
});

/**
 * The rocket flurry: many rockets, big, launching from along the bottom and
 * flying off the top with varied drift, tilt, size and timing. Fixed values
 * (from index maths) so it never reflows, and it plays once per completion.
 */
const ROCKETS = Array.from({ length: 18 }, (_, i) => {
  const drift = ((i * 53) % 20) - 10; // -10..+9 (vw)
  return {
    left: (i * 61) % 96, // 0..95 (%)
    scale: 1.4 + ((i * 7) % 12) / 10, // 1.4..2.5 — noticeably bigger
    drift,
    rot: Math.round(drift * 2.2), // tilt matches the drift
    delayMs: (i * 79) % 1000,
    durationMs: 1800 + ((i * 37) % 800), // 1.8s..2.6s
  };
});

export function CompletionCelebration({ active }: { active: boolean }) {
  if (!active) return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center overflow-hidden motion-reduce:hidden"
    >
      {/* A flurry of rockets launching up the screen, played once. */}
      {ROCKETS.map((r, i) => (
        <div
          key={i}
          className="absolute bottom-0"
          style={
            {
              left: `${String(r.left)}%`,
              animation: `uk-launch ${String(r.durationMs)}ms linear ${String(r.delayMs)}ms 1 both`,
              '--dx': `${String(r.drift)}vw`,
              '--rot': `${String(r.rot)}deg`,
              '--scale': String(r.scale),
            } as CSSProperties
          }
        >
          <Rocket />
        </div>
      ))}

      <div className="relative">
        <span className="kosmos-burst-ring" />

        {PARTICLES.map((particle, index) => (
          <span
            key={index}
            className="kosmos-burst-particle"
            style={
              {
                '--tx': `${String(particle.tx)}px`,
                '--ty': `${String(particle.ty)}px`,
                marginTop: '-0.25rem',
                marginLeft: '-0.25rem',
                background: `oklch(0.72 0.18 ${String(particle.hue)})`,
                animationDelay: `${String(particle.delay)}ms`,
              } as CSSProperties
            }
          />
        ))}

        <span className="kosmos-burst-check flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg">
          <Check className="size-7" strokeWidth={3} aria-hidden />
        </span>
      </div>
    </div>
  );
}
