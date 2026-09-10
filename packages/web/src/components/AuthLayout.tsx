import type { CSSProperties } from 'react';
import { Logo } from '@/components/Logo';
import { RocketFlyby } from '@/components/RocketFlyby';
import { ThemeToggle } from '@/components/ThemeToggle';

/**
 * A scatter of stars for the cosmic panel — fixed positions (from index maths,
 * not random, so it never reflows), most of them slowly twinkling. Decoration
 * only; the twinkle is disabled under `prefers-reduced-motion` via index.css.
 */
const STARS = Array.from({ length: 70 }, (_, i) => ({
  top: (i * 47) % 100,
  left: (i * 71) % 100,
  size: i % 7 === 0 ? 2.5 : i % 3 === 0 ? 1.8 : 1,
  dim: 0.2 + ((i * 13) % 60) / 100,
  delaySeconds: ((i * 53) % 40) / 10,
  durationSeconds: 2.4 + ((i * 29) % 26) / 10,
}));

function Starfield() {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      {STARS.map((star, i) => (
        <span
          key={i}
          className="uk-twinkle absolute rounded-full bg-white"
          style={
            {
              top: `${String(star.top)}%`,
              left: `${String(star.left)}%`,
              width: `${String(star.size)}px`,
              height: `${String(star.size)}px`,
              opacity: star.dim,
              '--twinkle-min': String(star.dim),
              animationDelay: `${String(star.delaySeconds)}s`,
              animationDuration: `${String(star.durationSeconds)}s`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

interface AuthLayoutProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

/**
 * The frame every signed-out screen shares.
 *
 * **Exactly one thing on the page is actionable.** That principle has held
 * since Phase 0 and still holds — but it is a rule about actions, not about
 * space. On a laptop the form alone left most of the screen empty, and an
 * empty screen is not restraint, it is an unfinished one.
 *
 * So: a brand panel on the left from `lg` up, carrying the mark, what this is
 * and who it is from. Nothing in it can be clicked, so the form on the right
 * is still the only thing to do. Below `lg` the panel disappears entirely
 * rather than stacking above the form — on a phone, brand messaging between
 * the address bar and the e-mail field is just something to scroll past.
 */
export function AuthLayout({ title, description, children, footer }: AuthLayoutProps) {
  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      {/* ── Brand, desktop only: a little corner of the universe ──────── */}
      <aside className="auth-cosmos relative hidden overflow-hidden text-white lg:flex lg:w-[44%] lg:max-w-2xl lg:flex-col lg:justify-between lg:p-12">
        {/* Stars behind, rockets crossing in front of them. */}
        <Starfield />
        <RocketFlyby />

        <div className="relative">
          <Logo />
        </div>

        <div className="relative max-w-md space-y-3">
          <h2 className="font-display text-[1.75rem] leading-tight font-bold tracking-tight text-balance">
            Seu onboarding com a Kosmos, do começo ao fim.
          </h2>
          <p className="max-w-sm text-sm leading-relaxed text-white/60">
            Suas trilhas, suas aulas e seu progresso em um só lugar. Avance no seu ritmo — a gente
            acompanha junto.
          </p>
          <p className="pt-2 text-xs tracking-wide text-white/40">Kosmos Inteligência Digital</p>
        </div>
      </aside>

      {/* ── The form ─────────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col">
        <div className="flex items-center justify-between px-5 pt-5 lg:justify-end lg:px-8">
          <Logo className="lg:hidden" />
          <ThemeToggle />
        </div>

        <main className="flex flex-1 items-center justify-center px-5 py-10 lg:px-8">
          <div className="w-full max-w-[24rem]">
            <div className="mb-7 space-y-1.5">
              <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
              {description ? (
                <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
              ) : null}
            </div>

            {children}

            {footer ? <div className="mt-7 text-sm">{footer}</div> : null}
          </div>
        </main>
      </div>
    </div>
  );
}

