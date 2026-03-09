import Link from "next/link";

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  pathname: string;
}

function buildLink(pathname: string, page: number) {
  if (page <= 1) {
    return pathname;
  }

  return `${pathname}?page=${page}`;
}

export function Pagination({ currentPage, totalPages, pathname }: PaginationProps) {
  if (totalPages <= 1) {
    return null;
  }

  return (
    <nav className="pagination" aria-label="分页">
      <Link
        href={buildLink(pathname, currentPage - 1)}
        aria-disabled={currentPage <= 1}
        className={currentPage <= 1 ? "pagination-link pagination-link-prev disabled" : "pagination-link pagination-link-prev"}
      >
        上一页
      </Link>

      <p className="pagination-current">
        第 {currentPage} / {totalPages} 页
      </p>

      <Link
        href={buildLink(pathname, currentPage + 1)}
        aria-disabled={currentPage >= totalPages}
        className={currentPage >= totalPages ? "pagination-link pagination-link-next disabled" : "pagination-link pagination-link-next"}
      >
        下一页
      </Link>
    </nav>
  );
}
