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
};
