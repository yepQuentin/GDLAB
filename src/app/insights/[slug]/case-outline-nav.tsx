"use client";

import { useEffect, useState } from "react";

import {
  buildCaseOutlineGroups,
  type CaseOutlineGroup,
  type CaseOutlineItem,
} from "@/lib/case-content";

import styles from "./case-detail.module.css";

interface CaseOutlineNavProps {
  outline: CaseOutlineItem[];
}

interface OutlineListProps {
  activeId: string | null;
  compact?: boolean;
  groups: CaseOutlineGroup[];
  onNavigate?: () => void;
  showActiveState?: boolean;
}

const MOBILE_BREAKPOINT = 700;
const DESKTOP_BREAKPOINT = 1100;

function normalizeOutlineTitle(title: string): string {
  return title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/^[\s(（【]*[\d一二三四五六七八九十百千零]+[\s、.．-]*/u, "")
    .replace(/[\s：:、，,。.；;！!？?（）()【】·•-]/gu, "");
}

function getHeadingOffset(viewportWidth: number): number {
  if (viewportWidth < MOBILE_BREAKPOINT) {
    return 150;
  }

  if (viewportWidth < DESKTOP_BREAKPOINT) {
    return 170;
  }

  return 186;
}

function OutlineList({
  activeId,
  groups,
  onNavigate,
  compact = false,
  showActiveState = true,
}: OutlineListProps) {
  return (
    <ol className={compact ? styles.tocListCompact : styles.tocList}>
      {groups.map((group) => (
        <li
          key={group.id}
          className={styles.tocItem}
          data-active={showActiveState && activeId === group.id ? "true" : undefined}
        >
          <a
            href={`#${group.id}`}
            className={styles.tocLink}
            aria-current={showActiveState && activeId === group.id ? "location" : undefined}
            data-active={showActiveState && activeId === group.id ? "true" : undefined}
            onClick={onNavigate}
          >
            {group.title}
          </a>
          {group.children.length > 0 ? (
            <ol className={styles.tocSublist}>
              {group.children.map((child) => (
                <li
                  key={child.id}
                  className={styles.tocSubitem}
                  data-active={showActiveState && activeId === child.id ? "true" : undefined}
                >
                  <a
                    href={`#${child.id}`}
                    className={styles.tocSublink}
                    aria-current={showActiveState && activeId === child.id ? "location" : undefined}
                    data-active={showActiveState && activeId === child.id ? "true" : undefined}
                    onClick={onNavigate}
                  >
                    {child.title}
                  </a>
                </li>
              ))}
            </ol>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

export function CaseOutlineNav({ outline }: CaseOutlineNavProps) {
  const groups = buildCaseOutlineGroups(outline);
  const flatItems = groups.flatMap((group) => [group, ...group.children]);
  const hiddenChildParentMap = new Map<string, string>();
  const navigableGroups = groups.map((group) => {
    const normalizedGroupTitle = normalizeOutlineTitle(group.title);
    const children = group.children.filter((child) => {
      const isDuplicate = normalizeOutlineTitle(child.title) === normalizedGroupTitle;

      if (isDuplicate) {
        hiddenChildParentMap.set(child.id, group.id);
      }

      return !isDuplicate;
    });

    return { ...group, children };
  });
  const [activeId, setActiveId] = useState<string | null>(groups[0]?.id ?? null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const resolvedActiveId =
    activeId && flatItems.some((item) => item.id === activeId) ? activeId : groups[0]?.id ?? null;
  const resolvedNavigableActiveId =
    (resolvedActiveId ? hiddenChildParentMap.get(resolvedActiveId) : null) ?? resolvedActiveId;

  useEffect(() => {
    const nextGroups = buildCaseOutlineGroups(outline);
    const nextFlatItems = nextGroups.flatMap((group) => [group, ...group.children]);

    if (nextFlatItems.length === 0) {
      return;
    }

    let frameId = 0;

    const findHeadings = () =>
      nextFlatItems
        .map((item) => document.getElementById(item.id))
        .filter((heading): heading is HTMLElement => heading instanceof HTMLElement);

    const updateActiveHeading = () => {
      const headings = findHeadings();

      if (headings.length === 0) {
        return;
      }

      const offset = getHeadingOffset(window.innerWidth);
      let nextId = headings[0].id;

      for (const heading of headings) {
        if (heading.getBoundingClientRect().top <= offset) {
          nextId = heading.id;
          continue;
        }

        break;
      }

      setActiveId((currentId) => (currentId === nextId ? currentId : nextId));
    };

    const scheduleUpdate = () => {
      cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(updateActiveHeading);
    };

    scheduleUpdate();
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [outline]);

  useEffect(() => {
    const syncViewport = () => {
      if (window.innerWidth >= MOBILE_BREAKPOINT) {
        setMobileOpen(false);
      }
    };

    syncViewport();
    window.addEventListener("resize", syncViewport);

    return () => {
      window.removeEventListener("resize", syncViewport);
    };
  }, []);

  if (groups.length === 0) {
    return null;
  }

  const mobileActiveTitle =
    flatItems.find((item) => item.id === resolvedActiveId)?.title ?? groups[0]?.title ?? "跳转章节";

  return (
    <>
      <nav className={styles.tocMobile} aria-label="文章目录">
        <div className={styles.tocInner}>
          <button
            type="button"
            className={styles.tocToggle}
            aria-expanded={mobileOpen}
            aria-controls="case-outline-mobile-panel"
            data-open={mobileOpen ? "true" : "false"}
            onClick={() => setMobileOpen((open) => !open)}
          >
            <span className={styles.tocToggleLabel}>文章导览</span>
            <span className={styles.tocToggleValue}>{mobileActiveTitle}</span>
            <span className={styles.tocToggleHint}>{mobileOpen ? "收起目录" : "展开目录"}</span>
          </button>
          {mobileOpen ? (
            <div id="case-outline-mobile-panel" className={styles.tocPanel}>
              <OutlineList
                activeId={resolvedActiveId}
                groups={groups}
                compact
                onNavigate={() => setMobileOpen(false)}
              />
            </div>
          ) : null}
        </div>
      </nav>

      <nav className={styles.tocTablet} aria-label="文章目录">
        <div className={styles.tocInner}>
          <div className={styles.tocHeader}>
            <p className={styles.tocEyebrow}>文章导览</p>
          </div>
          <OutlineList activeId={resolvedNavigableActiveId} groups={navigableGroups} compact />
        </div>
      </nav>

      <aside className={styles.toc} aria-label="文章目录">
        <div className={styles.tocInner}>
          <div className={styles.tocHeader}>
            <p className={styles.tocEyebrow}>文章导览</p>
          </div>
          <OutlineList activeId={resolvedNavigableActiveId} groups={navigableGroups} />
        </div>
      </aside>
    </>
  );
}
