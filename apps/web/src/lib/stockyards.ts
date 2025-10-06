export type Product = 'TMT Bars' | 'Hot Rolled' | 'Galvanised Sheet' | 'Coils' | 'Billets';

export interface Stockyard {
  slug: string;
  name: string;
  products: Record<Product, number>; // stock in tons
}

const NAMES = [
  'Bhilai',
  'Rourkela',
  'Patna',
  'Durgapur',
  'Delhi',
  'Indore',
  'Chennai',
  'Mumbai',
  'Visakhapatnam',
  'Kolkata',
];

const PRODUCTS: Product[] = ['TMT Bars','Hot Rolled','Galvanised Sheet','Coils','Billets'];

function slugify(name: string) {
  return name.toLowerCase().replace(/\s+/g,'-');
}

// Simple deterministic pseudo-random generator based on string hash
function seeded(name: string, product: string) {
  let h = 0; const s = `${name}:${product}`;
  for (let i=0;i<s.length;i++) h = ((h<<5)-h) + s.charCodeAt(i);
  const base = Math.abs(h % 500); // 0..499
  return 200 + base; // 200..699 tons
}

export function getStockyards(): Stockyard[] {
  return NAMES.map(n => ({
    slug: slugify(n),
    name: n,
    products: PRODUCTS.reduce((acc, p) => {
      acc[p] = seeded(n, p);
      return acc;
    }, {} as Record<Product, number>)
  }));
}

export function getStockyard(slug: string): Stockyard | null {
  const name = NAMES.find(n => slugify(n) === slug.toLowerCase());
  if (!name) return null;
  return {
    slug,
    name,
    products: PRODUCTS.reduce((acc, p) => { acc[p] = seeded(name, p); return acc; }, {} as Record<Product, number>)
  };
}

export { PRODUCTS };
