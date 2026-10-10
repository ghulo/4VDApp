import type { NavigatorScreenParams } from '@react-navigation/native';

export type MainTabParamList = {
  Home: undefined;
  /** `search` pre-fills the search box, e.g. from the search on Home. */
  Catalog: { search?: string } | undefined;
  Favorites: undefined;
  Sell: undefined;
  Account: undefined;
};

export type RootStackParamList = {
  Login: undefined;
  Main: NavigatorScreenParams<MainTabParamList>;
  ProductDetail: { productId: number; name: string };
  RecordSale: { productId?: number };
  MySales: undefined;
  Return: { saleId: number; productName: string; quantity: number; pricePerUnit: number; returnedQuantity: number; saleDate: string };
  WriteOff: { productId: number; productName: string; inStock: number };
  Expiry: { productId: number; productName: string };
  Counts: undefined;
  Count: { countId: number; title: string };
  /** `drawer` ("shop" or "carwash:<id>") picks the drawer, e.g. from End shift. */
  CashCount: { drawer?: string } | undefined;
  /** The closing-up steps: count the drawers, enter the carwash takings. */
  EndShift: undefined;
  Tabs: undefined;
  Tab: { customerId: number; name: string };
  Carwash: { carwashId?: number } | undefined;
  Deliveries: undefined;
  /** Opened from a product QR code. */
  ScanResult: { code: string };
};
