// Mirrors the shapes the backend returns (see docs/API.md).

export type UserRole = 'admin' | 'employee' | 'family';

export interface User {
  id: number;
  email: string;
  name: string;
  role: UserRole;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
}

export interface PricingTier {
  quantity: number;
  price: number;
}

export interface Category {
  id: number;
  name: string;
  productCount?: number;
}

export interface Product {
  id: number;
  name: string;
  description: string | null;
  sku: string | null;
  imageUrl: string | null;
  category: { id: number; name: string };
  price: number;
  stock: { quantity: number; reorderLevel: number; isInStock: boolean; isLowStock: boolean };
  bulkPricingTiers: PricingTier[];
}

export interface Sale {
  id: number;
  productName: string;
  quantity: number;
  pricePerUnit: number;
  totalAmount: number;
}
