import { useNavigate } from 'react-router-dom';
import { Logo } from '@/components/Logo';
import { Button } from '@/components/ui/button';

/**
 * The 404 screen: a lost astronaut drifting past a moon.
 *
 * A wrong address is a small, low-stakes dead end, so the page owns it with a
 * bit of warmth rather than an error stack — an astronaut who took a wrong
 * turn, a way back home, and nothing else to do. Everything resolves to the
 * design tokens so it reads correctly in light and dark, and the only motion
 * (the float) is dropped under `prefers-reduced-motion`.
 */
export function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-background px-6 text-center">
      <Starfield />

      <div className="absolute left-1/2 top-8 -translate-x-1/2">
        <Logo />
      </div>

      <LostAstronaut />

      <p className="mt-8 font-display text-6xl font-bold tracking-tight text-foreground">404</p>
      <h1 className="mt-2 text-xl font-semibold tracking-tight text-foreground">
        Perdido no espaço
      </h1>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
        O endereço que você acessou não existe ou foi movido. Vamos te levar de volta para um lugar
        conhecido.
      </p>

      <Button className="mt-7" size="lg" onClick={() => void navigate('/')}>
        Voltar ao início
      </Button>
    </div>
  );
}

/** A few fixed, faint stars behind the scene — decoration only. */
const STARS = Array.from({ length: 32 }, (_, i) => ({
  top: (i * 53) % 100,
  left: (i * 37) % 100,
  size: i % 6 === 0 ? 3 : i % 3 === 0 ? 2 : 1.5,
  opacity: 0.1 + ((i * 17) % 30) / 100,
}));

function Starfield() {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      {STARS.map((star, i) => (
        <span
          key={i}
          className="absolute rounded-full bg-foreground"
          style={{
            top: `${String(star.top)}%`,
            left: `${String(star.left)}%`,
            width: `${String(star.size)}px`,
            height: `${String(star.size)}px`,
            opacity: star.opacity,
          }}
        />
      ))}
    </div>
  );
}

/**
 * The illustration: a moon with a couple of craters and, drifting past it, a
 * little astronaut on a tether. Drawn from tokens (`currentColor` and the brand
 * blue) so it inverts cleanly with the theme. Purely decorative.
 */
function LostAstronaut() {
  return (
    <svg
      className="h-64 w-64 text-foreground sm:h-72 sm:w-72"
      viewBox="0 0 240 240"
      fill="none"
      role="img"
      aria-label="Um astronauta perdido flutuando ao lado da lua"
    >
      {/* Moon — a muted disc with soft craters, up and to the left. */}
      <g opacity="0.9">
        <circle cx="70" cy="74" r="42" fill="var(--muted)" />
        <circle cx="70" cy="74" r="42" stroke="var(--border)" strokeWidth="2" />
        <circle cx="56" cy="60" r="7" fill="var(--muted-foreground)" opacity="0.25" />
        <circle cx="86" cy="84" r="10" fill="var(--muted-foreground)" opacity="0.2" />
        <circle cx="62" cy="92" r="5" fill="var(--muted-foreground)" opacity="0.22" />
      </g>

      {/* The astronaut, floating. The whole group drifts via `uk-float`. */}
      <g className="uk-float">
        {/* Tether, curving back toward the moon. */}
        <path
          d="M120 150 C 132 132, 118 108, 96 100"
          stroke="var(--ring)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray="1 7"
          opacity="0.7"
        />

        {/* Backpack. */}
        <rect x="126" y="126" width="26" height="34" rx="8" fill="var(--muted-foreground)" opacity="0.5" />

        {/* Body / suit. */}
        <rect x="108" y="128" width="34" height="42" rx="15" fill="#ffffff" />
        <rect x="108" y="128" width="34" height="42" rx="15" stroke="var(--foreground)" strokeWidth="3" />

        {/* Arms. */}
        <path d="M110 140 C 96 146, 90 158, 92 170" stroke="var(--foreground)" strokeWidth="9" strokeLinecap="round" />
        <path d="M140 140 C 154 144, 162 154, 160 166" stroke="var(--foreground)" strokeWidth="9" strokeLinecap="round" />

        {/* Legs. */}
        <path d="M118 168 C 114 182, 112 190, 116 200" stroke="var(--foreground)" strokeWidth="10" strokeLinecap="round" />
        <path d="M134 168 C 140 182, 142 190, 138 202" stroke="var(--foreground)" strokeWidth="10" strokeLinecap="round" />

        {/* Helmet. */}
        <circle cx="125" cy="112" r="24" fill="#ffffff" />
        <circle cx="125" cy="112" r="24" stroke="var(--foreground)" strokeWidth="3" />
        {/* Visor — the brand blue, with a highlight. */}
        <circle cx="125" cy="112" r="15" fill="var(--ring)" />
        <ellipse cx="119" cy="106" rx="5" ry="7" fill="#ffffff" opacity="0.35" />
      </g>
    </svg>
  );
}
