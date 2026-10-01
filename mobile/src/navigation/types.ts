import type { NavigatorScreenParams } from '@react-navigation/native';

export type MainTabParamList = {
  Catalog: undefined;
  Favorites: undefined;
  Sell: undefined;
  Account: undefined;
};

export type RootStackParamList = {
  Login: undefined;
  Main: NavigatorScreenParams<MainTabParamList>;
  ProductDetail: { productId: number; name: string };
  RecordSale: { productId?: number };
};
