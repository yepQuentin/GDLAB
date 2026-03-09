"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import clsx from "clsx";

interface NavItem {
  label: string;
  href: string;
  active: (pathname: string) => boolean;
}

const NAV_ITEMS: NavItem[] = [
  {
    label: "首页",
    href: "/",
    active: (pathname) => pathname === "/",
  },
  {
    label: "每日热点",
    href: "/daily",
    active: (pathname) => pathname.startsWith("/daily"),
  },
  {
    label: "商业案例",
    href: "/cases",
    active: (pathname) => pathname.startsWith("/cases"),
  },
  {
    label: "搜索",
    href: "/search",
    active: (pathname) => pathname.startsWith("/search"),
  },
];

export function HeaderNav() {
  const pathname = usePathname();
  const [isMenuOpen, setMenuOpen] = useState(false);

  const navItems = useMemo(
    () =>
      NAV_ITEMS.map((item) => ({
        ...item,
        isActive: item.active(pathname),
      })),
    [pathname],
  );

  return (
    <header className="site-header">
      <div className="container header-inner">
        <Link
          href="/"
          className="brand"
          aria-label="歌尔丹拿商学院"
          onClick={() => setMenuOpen(false)}
        >
          <span className="brand-logo">
            <Image
              src="/GoerDynamics-nav.png"
              alt=""
              width={573}
              height={272}
              priority
              className="brand-logo-image"
            />
          </span>
        </Link>

        <button
          type="button"
          aria-label="切换导航菜单"
          className="menu-toggle"
          onClick={() => setMenuOpen((value) => !value)}
        >
          <span />
          <span />
          <span />
        </button>

        <nav className="desktop-nav" aria-label="主导航">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={clsx("nav-link", item.isActive && "nav-link-active")}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>

      <nav
        className={clsx("mobile-nav", isMenuOpen && "mobile-nav-open")}
        aria-label="移动端主导航"
      >
        {navItems.map((item) => (
          <Link
            key={`mobile-${item.href}`}
            href={item.href}
            className={clsx("mobile-nav-link", item.isActive && "mobile-nav-link-active")}
            onClick={() => setMenuOpen(false)}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
