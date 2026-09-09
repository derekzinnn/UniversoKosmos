import { useAuth } from '@/auth/useAuth';

/**
 * A floating WhatsApp button, shown on every signed-in screen, that opens a
 * chat with Kosmos support with a short message pre-filled with the person's
 * name — so support knows who is writing before they say a word.
 *
 * WhatsApp is the channel this audience (business owners in Brazil) already
 * lives in, so support happens where Kosmos already works and there is no inbox
 * to build. If the support line ever changes, it is the one constant below.
 */
const SUPPORT_WHATSAPP = '555384163922'; // +55 53 8416-3922 — digits only, no "+".

export function SupportButton() {
  const { user } = useAuth();

  const greeting = user?.name ? `Olá! Aqui é ${user.name}. ` : 'Olá! ';
  const message = `${greeting}Preciso de ajuda com o Universo Kosmos.`;
  const href = `https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(message)}`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Falar com o suporte no WhatsApp"
      title="Falar com o suporte"
      className="group fixed right-5 bottom-5 z-50 flex items-center gap-2 rounded-full bg-[#25d366] py-3 pr-5 pl-3.5 text-white shadow-lg transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-[#25d366]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
    >
      <svg viewBox="0 0 24 24" fill="currentColor" className="size-6 shrink-0" aria-hidden>
        <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 2.1.55 4.15 1.6 5.96L2 22l4.25-1.11a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 18.15h-.01a8.2 8.2 0 0 1-4.18-1.15l-.3-.18-2.52.66.67-2.46-.2-.31a8.22 8.22 0 0 1-1.26-4.4c0-4.54 3.7-8.23 8.24-8.23 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.82c0 4.54-3.69 8.24-8.23 8.24Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.12-.16.25-.64.81-.79.97-.14.17-.29.19-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.43.13-.14.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.43-.14 0-.31-.01-.47-.01-.17 0-.43.06-.66.31-.22.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.47-.07 1.47-.6 1.68-1.18.21-.58.21-1.07.14-1.18-.06-.11-.22-.17-.47-.29Z" />
      </svg>
      <span className="hidden text-sm font-semibold sm:inline">Suporte</span>
    </a>
  );
}
