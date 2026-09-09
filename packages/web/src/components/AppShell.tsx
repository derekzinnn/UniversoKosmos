import { ChevronDown, LogOut, UserRound } from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '@/auth/useAuth';
import { Logo } from '@/components/Logo';
import { ProfileModal } from '@/components/ProfileModal';
import { SupportButton } from '@/components/SupportButton';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const ROLE_LABELS: Readonly<Record<string, string>> = {
  SUPERADMIN: 'Equipe Kosmos',
  CLIENT_OWNER: 'Responsável',
  CLIENT_MEMBER: 'Participante',
};

/**
 * `end` on the root link so "Início" is not highlighted on every nested page —
 * without it, `/` matches `/admin/tracks` too and two tabs look active at once.
 */
function StaffLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        [
          'rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors',
          isActive
            ? 'bg-accent text-accent-foreground'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        ].join(' ')
      }
    >
      {children}
    </NavLink>
  );
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

/**
 * The frame every signed-in screen shares. Phase 0 has one page inside it;
 * the classroom navigation arrives in Phase 3 and slots in here.
 */
export function AppShell() {
  const { user, logout } = useAuth();
  const [profileOpen, setProfileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="flex min-h-dvh flex-col">
      {/*
        The first thing a keyboard reaches, and invisible until it does. Without
        it, every page begins with the same tab through the logo, three nav
        links and the sign-out button before the actual content.
      */}
      <a
        href="#conteudo"
        className="sr-only rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50"
      >
        Pular para o conteúdo
      </a>

      <header className="sticky top-0 z-10 border-b border-border bg-card/80 backdrop-blur-sm">
        {/*
          Three columns, not two: `1fr auto 1fr` pins the logo hard left and the
          account cluster hard right while the nav sits dead centre, staying
          centred no matter how wide either side grows.
        */}
        <div className="mx-auto grid h-16 w-full max-w-5xl grid-cols-[1fr_auto_1fr] items-center gap-4 px-5">
          <div className="flex min-w-0 items-center justify-self-start">
            <Logo />
          </div>

          {user?.role === 'SUPERADMIN' ? (
            <nav aria-label="Áreas da Kosmos" className="hidden gap-1 justify-self-center sm:flex">
              <StaffLink to="/">Início</StaffLink>
              <StaffLink to="/admin/funnel">Funil</StaffLink>
              <StaffLink to="/admin/clients">Clientes</StaffLink>
              <StaffLink to="/admin/tracks">Trilhas</StaffLink>
              <StaffLink to="/admin/audit">Auditoria</StaffLink>
            </nav>
          ) : (
            <span />
          )}

          <div className="flex items-center justify-self-end">
            {user ? (
              <Popover open={menuOpen} onOpenChange={setMenuOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-2.5 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/60 sm:rounded-lg sm:py-1 sm:pr-2 sm:pl-2.5 sm:hover:bg-muted"
                    aria-label="Conta"
                  >
                    <span className="hidden text-right sm:block">
                      <span className="block text-sm leading-tight font-medium whitespace-nowrap">
                        {user.name}
                      </span>
                      <span className="block text-xs leading-tight text-muted-foreground">
                        {ROLE_LABELS[user.role] ?? user.role}
                      </span>
                    </span>
                    <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent text-xs font-semibold text-accent-foreground">
                      {user.avatarUrl ? (
                        <img src={user.avatarUrl} alt="" className="size-full object-cover" />
                      ) : (
                        initialsOf(user.name)
                      )}
                    </span>
                    <ChevronDown
                      className="hidden size-4 text-muted-foreground sm:block"
                      aria-hidden
                    />
                  </button>
                </PopoverTrigger>

                <PopoverContent align="end" className="w-52 p-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      setProfileOpen(true);
                    }}
                    className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium outline-none hover:bg-muted focus-visible:bg-muted"
                  >
                    <UserRound className="size-4 text-muted-foreground" aria-hidden />
                    Meu perfil
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      void logout();
                    }}
                    className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium text-destructive outline-none hover:bg-destructive/10 focus-visible:bg-destructive/10"
                  >
                    <LogOut className="size-4" aria-hidden />
                    Sair da conta
                  </button>
                </PopoverContent>
              </Popover>
            ) : null}
          </div>
        </div>
      </header>

      {user?.role === 'SUPERADMIN' ? (
        <nav
          aria-label="Áreas da Kosmos"
          // Sticks directly beneath the 4rem header, so switching sections on a
          // phone never requires scrolling back to the top of a long editor.
          className="sticky top-16 z-10 flex gap-1 overflow-x-auto border-b border-border bg-card/80 px-5 py-2 backdrop-blur-sm sm:hidden"
        >
          <StaffLink to="/">Início</StaffLink>
          <StaffLink to="/admin/clients">Clientes</StaffLink>
          <StaffLink to="/admin/tracks">Trilhas</StaffLink>
        </nav>
      ) : null}

      <main id="conteudo" className="mx-auto w-full max-w-5xl flex-1 px-5 py-10">
        <Outlet />
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-5 py-6">
          <p className="text-xs text-muted-foreground">Kosmos Inteligência Digital</p>
          {/* The only place the toggle reaches a phone, where the header has
              no room for it. */}
          <ThemeToggle className="sm:hidden" />
        </div>
      </footer>

      {user ? <ProfileModal open={profileOpen} onOpenChange={setProfileOpen} /> : null}

      <SupportButton />
    </div>
  );
}
