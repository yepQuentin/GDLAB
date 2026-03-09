import Link from "next/link";

export default function NotFoundPage() {
  return (
    <section className="section-block">
      <div className="section-header">
        <div className="section-title-group">
          <p className="section-kicker">404</p>
          <h1>页面不存在</h1>
        </div>
        <Link href="/" className="section-link">
          返回首页
        </Link>
      </div>
      <p className="section-description">你访问的内容可能未发布，或者链接已失效。</p>
    </section>
  );
}
