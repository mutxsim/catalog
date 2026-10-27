import type { Metadata, Viewport } from "next";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { getSettings } from "@/lib/settings";
import { publicStorageUrl } from "@/lib/public-url";
import { requireCustomer } from "@/lib/customer-auth";
import { CartLink } from "@/components/store/cart-link";
import { SearchBox } from "@/components/store/search-box";
import { CatalogSwitch } from "@/components/store/catalog-switch";
import { customerLogout } from "../login/actions";

export const dynamic = "force-dynamic";

export const viewport: Viewport = { themeColor: "#0d0c13", colorScheme: "dark" };

export async function generateMetadata(): Promise<Metadata> {
  const name = (await getSettings()).business_name.trim();
  return name ? { title: { default: name, template: `%s · ${name}` } } : {};
}

export default async function StoreLayout({ children }: LayoutProps<"/">) {
  const customer = await requireCustomer();
  const settings = await getSettings();
  const logo = publicStorageUrl("branding", settings.logo_path);
  const name = settings.business_name.trim();

  return (
    <div className="store-theme flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4 sm:gap-5 sm:px-6">
          <Link href="/" className="flex min-w-0 shrink-0 items-center gap-2.5" aria-label="Home">
            {logo ? (
              <span className="relative block h-8 w-20 sm:w-28">
                <Image src={logo} alt={name || "Home"} fill sizes="112px" className="object-contain object-left" priority />
              </span>
            ) : name ? (
              <span className="max-w-[5.5rem] truncate text-[15px] font-bold tracking-tight sm:max-w-none">{name}</span>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="text-muted">
                <path d="M3 10.5 12 3l9 7.5V21H3z" />
              </svg>
            )}
          </Link>
          <CatalogSwitch />
          <div className="min-w-0 flex-1">
            <div className="hidden sm:block">
              <Suspense fallback={null}>
                <SearchBox />
              </Suspense>
            </div>
          </div>
          <span className="hidden max-w-[12rem] truncate text-sm text-muted md:inline" title="Signed in as">{customer.customerName}</span>
          <CartLink />
          <form action={customerLogout}>
            <button className="h-10 whitespace-nowrap rounded-full px-2 text-sm text-muted transition-colors hover:bg-subtle hover:text-ink sm:px-3">Log out</button>
          </form>
        </div>
      </header>
      <div className="flex-1">{children}</div>
      <footer className="mx-auto w-full max-w-6xl px-4 py-10 text-center text-xs text-muted sm:px-6">
        Orders are paid in-store at pickup.
      </footer>
    </div>
  );
}
