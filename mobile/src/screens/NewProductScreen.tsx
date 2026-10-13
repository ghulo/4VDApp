import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BarcodeScanner } from '../components/BarcodeScanner';
import { Confirmation } from '../components/Confirmation';
import { ChoiceRow, Stepper } from '../components/inputs';
import { Button, ErrorState, Loading, TextField, Panel } from '../components/ui';
import { useT } from '../i18n/useT';
import type { RootStackParamList } from '../navigation/types';
import { categoriesApi, productEditApi, productRequestsApi, productsApi } from '../services/api';
import { mediaSrc } from '../services/apiClient';
import type { Product } from '../services/types';
import { canEditProducts, useCurrentUser } from '../state/useAuth';
import { fonts, radius, spacing, type, useThemeColors } from '../theme';
import { errorMessage } from '../utils/format';

type Props = NativeStackScreenProps<RootStackParamList, 'NewProduct'>;

const NO_CATEGORY = 'none';
const PHOTO_OPTIONS: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.6, base64: true, allowsEditing: true, aspect: [1, 1] };

/**
 * A product from the phone. Anyone at the counter can add one: whoever runs
 * the shop adds it at once, anyone else's is sent to them to approve. With a
 * `productId`, whoever runs the shop changes that product instead.
 */
export function NewProductScreen({ route, navigation }: Props) {
  const productId = route.params?.productId;
  const existing = useQuery({ queryKey: ['products', productId], queryFn: () => productsApi.get(productId!), enabled: productId !== undefined });
  if (productId === undefined) return <ProductForm navigation={navigation} />;
  if (existing.isPending) return <Loading />;
  if (existing.isError) return <ErrorState error={existing.error} onRetry={() => existing.refetch()} />;
  return <ProductForm navigation={navigation} product={existing.data} />;
}

function ProductForm({ navigation, product }: { navigation: Props['navigation']; product?: Product }) {
  const colors = useThemeColors();
  const t = useT();
  const user = useCurrentUser();
  const queryClient = useQueryClient();
  const direct = canEditProducts(user);
  const categories = useQuery({ queryKey: ['categories'], queryFn: categoriesApi.list });

  const [scanning, setScanning] = useState(false);
  const [barcode, setBarcode] = useState(product?.barcode ?? '');
  const [name, setName] = useState(product?.name ?? '');
  const [price, setPrice] = useState(product ? String(product.price) : '');
  const [categoryId, setCategoryId] = useState(product ? String(product.category.id) : NO_CATEGORY);
  const [stock, setStock] = useState('0');
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<{ uri: string; base64: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [tried, setTried] = useState(false);

  const priceValue = Number(price.replace(',', '.'));
  const missing = !name.trim()
    ? t.newProduct.needName
    : price.trim() === '' || !Number.isFinite(priceValue) || priceValue < 0
      ? t.newProduct.needPrice
      : direct && categoryId === NO_CATEGORY
        ? t.newProduct.needCategory
        : null;

  const save = useMutation({
    mutationFn: async () => {
      const cleanBarcode = barcode.trim() || null;
      if (product) {
        // The full update sends the photo it was loaded with, so a new photo goes after it.
        await productEditApi.update(product, { name: name.trim(), price: priceValue, categoryId: Number(categoryId) });
        if (cleanBarcode !== product.barcode) await productEditApi.setBarcode(product.id, cleanBarcode);
        if (photo) await productEditApi.setPhoto(product.id, await (await fetch(photo.uri)).blob());
        return { kind: 'saved' as const };
      }
      return productRequestsApi.submit({
        name: name.trim(),
        categoryId: categoryId === NO_CATEGORY ? null : Number(categoryId),
        price: priceValue,
        barcode: cleanBarcode,
        stock: Number(stock) || 0,
        note: note.trim() || null,
        photo: photo ? { mime: 'image/jpeg', data: photo.base64 } : null,
      });
    },
    onSuccess: () => {
      for (const key of ['products', 'inventory', 'approvals', 'attention', 'product-requests']) queryClient.invalidateQueries({ queryKey: [key] });
    },
  });

  async function takePhoto() {
    setProblem(null);
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return setProblem(t.newProduct.noCamera);
    const result = await ImagePicker.launchCameraAsync(PHOTO_OPTIONS);
    const asset = result.canceled ? null : result.assets[0];
    if (asset?.base64) setPhoto({ uri: asset.uri, base64: asset.base64 });
  }

  function submit() {
    setTried(true);
    if (!missing) save.mutate();
  }

  if (save.data) {
    const shown = name.trim();
    const [title, message] =
      save.data.kind === 'saved'
        ? [t.newProduct.savedTitle, t.newProduct.savedMessage(shown)]
        : save.data.kind === 'product'
          ? [t.newProduct.addedTitle, t.newProduct.addedMessage(shown)]
          : [t.newProduct.sentTitle, t.newProduct.sentMessage(shown)];
    return <Confirmation title={title} message={message} onDone={() => navigation.goBack()} />;
  }

  const categoryOptions = [
    ...(direct ? [] : [{ value: NO_CATEGORY, label: t.newProduct.noCategory }]),
    ...(categories.data ?? []).map((category) => ({ value: String(category.id), label: category.name })),
  ];
  const shownPhoto = photo?.uri ?? mediaSrc(product?.imageUrl);

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {!product && <Text style={[styles.intro, { color: colors.ink }]}>{direct ? t.newProduct.intro : `${t.newProduct.intro} ${t.newProduct.introRequest}`}</Text>}

      <Button variant="quiet" label={scanning ? t.newProduct.stopScan : t.newProduct.scan} onPress={() => setScanning((on) => !on)} />
      {scanning && (
        <BarcodeScanner
          onScan={(code) => {
            setBarcode(code);
            setScanning(false);
          }}
        />
      )}
      <Panel>
        <TextField
          label={t.newProduct.barcode}
          hint={t.newProduct.barcodeHint}
          value={barcode}
          onChangeText={setBarcode}
          keyboardType="number-pad"
          autoCorrect={false}
          maxLength={64}
        />
        <TextField
          label={t.newProduct.name}
          placeholder={t.newProduct.namePlaceholder}
          value={name}
          onChangeText={setName}
          maxLength={255}
          error={tried && !name.trim() ? t.newProduct.needName : undefined}
        />
        <TextField
          label={t.newProduct.price}
          value={price}
          onChangeText={setPrice}
          keyboardType="decimal-pad"
          error={tried && missing === t.newProduct.needPrice ? missing : undefined}
        />
        {categories.isError ? (
          <ErrorState error={categories.error} onRetry={() => categories.refetch()} />
        ) : (
          <ChoiceRow label={t.newProduct.category} options={categoryOptions} value={categoryId} onChange={setCategoryId} />
        )}
        {tried && missing === t.newProduct.needCategory && (
          <Text style={[styles.error, { color: colors.signalOut }]} accessibilityRole="alert">
            {missing}
          </Text>
        )}
        {!product && <Stepper label={t.newProduct.onShelf} value={stock} onChange={setStock} min={0} max={100000} />}
  
        <View style={styles.photoRow}>
          {shownPhoto && (
            <Image source={{ uri: shownPhoto }} style={[styles.photo, { borderColor: colors.lineStrong }]} accessibilityLabel={t.newProduct.photo} accessibilityIgnoresInvertColors />
          )}
          <View style={styles.photoButton}>
            <Button variant="quiet" label={shownPhoto ? t.newProduct.retakePhoto : t.newProduct.photo} onPress={takePhoto} disabled={save.isPending} />
          </View>
        </View>
        {problem && (
          <Text style={[styles.error, { color: colors.signalOut }]} accessibilityRole="alert">
            {problem}
          </Text>
        )}
  
        {!product && !direct && <TextField label={t.newProduct.note} value={note} onChangeText={setNote} maxLength={500} multiline />}
      </Panel>

      {save.isError && (
        <Text style={[styles.error, { color: colors.signalOut }]} accessibilityRole="alert">
          {errorMessage(save.error)}
        </Text>
      )}
      <Button
        label={product ? t.newProduct.save : direct ? t.newProduct.add : t.newProduct.send}
        onPress={submit}
        loading={save.isPending}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md },
  intro: { fontFamily: fonts.body, fontSize: type.body },
  error: { fontFamily: fonts.body, fontSize: type.body },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  photo: { width: 88, height: 88, borderRadius: radius.small, borderWidth: 1 },
  photoButton: { flex: 1 },
});
