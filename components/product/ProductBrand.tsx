import Link from "next/link";
import styles from "./product.module.css";

export function ProductGlyph({ inverse = false }: { inverse?: boolean }) {
  return (
    <span className={inverse ? styles.productGlyphInverse : styles.productGlyph} aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

export function ProductBrand({ inverse = false, href = "/" }: { inverse?: boolean; href?: string }) {
  return (
    <Link className={inverse ? styles.productBrandInverse : styles.productBrand} href={href} aria-label="Commonstate home">
      <ProductGlyph inverse={inverse} />
      <span>
        <strong>commonstate</strong>
        <small>Operational context</small>
      </span>
    </Link>
  );
}
