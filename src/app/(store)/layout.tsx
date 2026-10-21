import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { displayName, getSettings } from "@/lib/settings";
import { publicStorageUrl } from "@/lib/public-url";
import { CartLink } from "@/components/store/cart-link";
import { SearchBox } from "@/components/store/search-box";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const s = await getSettings();
  const name = displayName(s);
  return { title: { default: name, template: `%s · ${name}` } };
}

export default async function StoreLayout({ children }: LayoutProps<"/">) {
  const settings = await getSettings();
  const logo = publicStorageUrl("branding", settings.logo_path);
  const name = displayName(settings);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-paper/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:gap-6 sm:px-6">
          <Link href="/" className="flex min-w-0 shrink-0 items-center gap-2.5" aria-label={`${name} — home`}>
            {logo ? (
              <span className="relative block h-8 w-24 sm:w-28">
                <Image src={logo} alt={name} fill sizes="112px" className="object-contain object-left" priority />
              </span>
            ) : (
              <span className="max-w-[9rem] truncate text-[15px] font-semibold tracking-tight sm:max-w-none">{name}</span>
            )}
          </Link>
          <div className="min-w-0 flex-1">
            <Suspense fallback={<div className="h-10" />}>
              <SearchBox />
            </Suspense>
          </div>
          <CartLink />
        </div>
      </header>
      <div className="flex-1">{children}</div>
      <footer className="mx-auto w-full max-w-6xl px-4 py-10 text-xs text-muted sm:px-6">
        Orders are paid in-store at pickup.
      </footer>
    </div>
  );
}
