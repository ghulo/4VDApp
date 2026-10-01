import * as SecureStore from 'expo-secure-store';

/** Phones: the Keychain (iOS) or Keystore (Android). See secureStorage.web.ts for browsers. */
export const secureStorage = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};
