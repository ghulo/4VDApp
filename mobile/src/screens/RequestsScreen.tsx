import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Check } from 'phosphor-react-native/src/icons/Check';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ChoiceRow } from '../components/inputs';
import { Button, EmptyState, ErrorState, Loading, TextField } from '../components/ui';
import { useT } from '../i18n/useT';
import type { RootStackParamList } from '../navigation/types';
import { billScansApi, categoriesApi, countsApi, decisionsApi, productRequestsApi } from '../services/api';
import { mediaSrc } from '../services/apiClient';
import { fonts, radius, spacing, type, useThemeColors } from '../theme';
import { countryName, errorMessage, flagEmoji, formatDateWith, formatMoney } from '../utils/format';
import { COUNTS_QUERY_KEY } from './CountsScreen';

/** Everything a decision here can change, refreshed after each one. */
const AFFECTED = [['product-requests'], ['bill-scans'], ['returns'], ['write-offs'], COUNTS_QUERY_KEY, ['approvals'], ['attention'], ['products'], ['inventory']];

function useRefreshAfterDecision() {
  const queryClient = useQueryClient();
  return () => {
    for (const queryKey of AFFECTED) queryClient.invalidateQueries({ queryKey });
  };
}

/** "10:42" for today, "28 Sep" for earlier days. */
function when(iso: string): string {
  const date = new Date(iso);
  return date.toDateString() === new Date().toDateString()
    ? formatDateWith(date, { hour: '2-digit', minute: '2-digit' })
    : formatDateWith(date, { day: 'numeric', month: 'short' });
}

/**
 * What waits for whoever runs the shop: new products and scanned bills open
 * their own screen; returns, write-offs and counts are decided right here.
 */
export function RequestsScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'Requests'>) {
  const colors = useThemeColors();
  const t = useT();
  const refresh = useRefreshAfterDecision();
  const products = useQuery({ queryKey: ['product-requests'], queryFn: productRequestsApi.pending });
  const bills = useQuery({ queryKey: ['bill-scans', 'waiting'], queryFn: billScansApi.waiting });
  const returns = useQuery({ queryKey: ['returns', 'pending'], queryFn: decisionsApi.returns });
  const writeOffs = useQuery({ queryKey: ['write-offs', 'pending'], queryFn: decisionsApi.writeOffs });
  const counts = useQuery({ queryKey: COUNTS_QUERY_KEY, queryFn: countsApi.list });
  const all = [products, bills, returns, writeOffs, counts];

  if (all.some((query) => query.isPending)) return <Loading />;
  const failed = all.find((query) => query.isError);
  if (failed) return <ErrorState error={failed.error} onRetry={() => all.forEach((query) => query.refetch())} />;

  const submitted = (counts.data ?? []).filter((count) => count.status === 'submitted');
  const nothing = !products.data?.length && !bills.data?.length && !returns.data?.length && !writeOffs.data?.length && !submitted.length;
  const refreshing = all.some((query) => query.isRefetching);

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
    >
      {nothing && <EmptyState title={t.decide.empty} icon={Check} />}

      {!!products.data?.length && (
        <Panel title={t.decide.products}>
          {products.data.map((request) => (
            <OpenRow
              key={request.id}
              title={`${request.name} · ${formatMoney(request.price)}`}
              meta={t.decide.askedBy(request.requestedBy?.name ?? null, when(request.requestedAt))}
              onPress={() => navigation.navigate('ProductRequest', { id: request.id })}
            />
          ))}
        </Panel>
      )}

      {!!bills.data?.length && (
        <Panel title={t.decide.bills}>
          {bills.data.map((bill) => (
            <OpenRow
              key={bill.id}
              title={[bill.supplierName ?? '?', bill.number, bill.amount !== null ? formatMoney(bill.amount) : null].filter(Boolean).join(' · ')}
              meta={t.decide.askedBy(bill.scannedBy, when(bill.scannedAt))}
              onPress={() => navigation.navigate('BillCheck', { id: bill.id })}
            />
          ))}
        </Panel>
      )}

      {!!returns.data?.length && (
        <Panel title={t.decide.returns}>
          {returns.data.map((item) => (
            <DecideRow
              key={item.id}
              title={t.decide.refund(`${item.quantity} × ${item.productName}${item.condition === 'damaged' ? t.decide.damaged : ''}`, formatMoney(item.refundAmount))}
              meta={t.decide.askedBy(item.requestedBy?.name ?? null, when(item.requestedAt))}
              note={item.notes}
              approve={() => decisionsApi.approveReturn(item.id)}
              reject={(note) => decisionsApi.rejectReturn(item.id, note)}
              onDone={refresh}
            />
          ))}
        </Panel>
      )}

      {!!writeOffs.data?.length && (
        <Panel title={t.decide.writeOffs}>
          {writeOffs.data.map((item) => (
            <DecideRow
              key={item.id}
              title={`${item.quantity} × ${item.productName} · ${t.writeOff.reasons[item.reason as keyof typeof t.writeOff.reasons] ?? item.reason}`}
              meta={[t.decide.askedBy(item.requestedBy?.name ?? null, when(item.requestedAt)), item.value !== null ? t.decide.atCost(formatMoney(item.value)) : null]
                .filter(Boolean)
                .join(' · ')}
              note={item.notes}
              approve={() => decisionsApi.approveWriteOff(item.id)}
              reject={(note) => decisionsApi.rejectWriteOff(item.id, note)}
              onDone={refresh}
            />
          ))}
        </Panel>
      )}

      {submitted.length > 0 && (
        <Panel title={t.decide.counts}>
          {submitted.map((count) => (
            <DecideRow
              key={count.id}
              title={t.decide.countOf(count.category?.name ?? t.decide.wholeShop)}
              meta={t.decide.askedBy(count.startedBy?.name ?? null, when(count.startedAt))}
              approveLabel={t.decide.approveAllCount}
              approve={() => decisionsApi.approveCount(count.id)}
              onDone={refresh}
            />
          ))}
        </Panel>
      )}
    </ScrollView>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  const colors = useThemeColors();
  return (
    <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.line, boxShadow: colors.raise }]}>
      <Text style={[styles.panelTitle, { color: colors.ink }]} accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

function OpenRow({ title, meta, onPress }: { title: string; meta: string; onPress: () => void }) {
  const colors = useThemeColors();
  const t = useT();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={t.decide.open}
      onPress={onPress}
      style={({ pressed }) => [styles.row, { borderTopColor: colors.line }, pressed && styles.pressed]}
    >
      <Text style={[styles.rowName, { color: colors.ink }]}>{title}</Text>
      <Text style={[styles.rowMeta, { color: colors.steel }]}>{meta}</Text>
    </Pressable>
  );
}

/** One request decided in place. Rejecting asks why, since the person sees the reason. */
function DecideRow({
  title,
  meta,
  note,
  approveLabel,
  approve,
  reject,
  onDone,
}: {
  title: string;
  meta: string;
  note?: string | null;
  approveLabel?: string;
  approve: () => Promise<void>;
  reject?: (note: string) => Promise<void>;
  onDone: () => void;
}) {
  const colors = useThemeColors();
  const t = useT();
  const [rejecting, setRejecting] = useState(false);
  const [why, setWhy] = useState('');
  const decide = useMutation({
    mutationFn: (choice: 'approve' | 'reject') => (choice === 'approve' ? approve() : reject!(why.trim())),
    onSuccess: onDone,
  });

  return (
    <View style={[styles.row, styles.decideRow, { borderTopColor: colors.line }]}>
      <Text style={[styles.rowName, { color: colors.ink }]}>{title}</Text>
      <Text style={[styles.rowMeta, { color: colors.steel }]}>{meta}</Text>
      {!!note && <Text style={[styles.rowMeta, { color: colors.ink }]}>“{note}”</Text>}
      {rejecting ? (
        <>
          <TextField label={t.decide.rejectWhy} value={why} onChangeText={setWhy} maxLength={500} autoFocus />
          <View style={styles.actions}>
            <View style={styles.action}>
              <Button variant="quiet" label={t.decide.cancel} onPress={() => setRejecting(false)} disabled={decide.isPending} />
            </View>
            <View style={styles.action}>
              <Button label={t.decide.sendReject} onPress={() => decide.mutate('reject')} disabled={!why.trim()} loading={decide.isPending} />
            </View>
          </View>
        </>
      ) : (
        <View style={styles.actions}>
          {reject && (
            <View style={styles.action}>
              <Button variant="quiet" label={t.decide.reject} onPress={() => setRejecting(true)} disabled={decide.isPending} />
            </View>
          )}
          <View style={styles.action}>
            <Button label={approveLabel ?? t.decide.approve} onPress={() => decide.mutate('approve')} loading={decide.isPending} />
          </View>
        </View>
      )}
      {decide.isError && (
        <Text style={[styles.rowMeta, { color: colors.signalOut }]} accessibilityRole="alert">
          {errorMessage(decide.error)}
        </Text>
      )}
    </View>
  );
}

/** A product someone asked to add: fix the price or category if needed, then approve or reject. */
export function ProductRequestScreen({ route, navigation }: NativeStackScreenProps<RootStackParamList, 'ProductRequest'>) {
  const colors = useThemeColors();
  const t = useT();
  const refresh = useRefreshAfterDecision();
  const request = useQuery({ queryKey: ['product-requests', route.params.id], queryFn: () => productRequestsApi.get(route.params.id) });
  const categories = useQuery({ queryKey: ['categories'], queryFn: categoriesApi.list });
  const [price, setPrice] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [why, setWhy] = useState('');
  const [done, setDone] = useState<string | null>(null);

  const decide = useMutation({
    mutationFn: async (choice: 'approve' | 'reject') => {
      if (choice === 'reject') return productRequestsApi.reject(route.params.id, why.trim());
      return productRequestsApi.approve(route.params.id, { price: priceValue, categoryId: Number(chosenCategory) });
    },
    onSuccess: (_, choice) => {
      refresh();
      setDone(choice === 'approve' ? t.decide.approved : t.decide.rejected);
    },
  });

  if (request.isPending) return <Loading />;
  if (request.isError) return <ErrorState error={request.error} onRetry={() => request.refetch()} />;
  const item = request.data;
  const shownPrice = price ?? String(item.price);
  const priceValue = Number(shownPrice.replace(',', '.'));
  const priceOk = shownPrice.trim() !== '' && Number.isFinite(priceValue) && priceValue >= 0;
  const chosenCategory = categoryId ?? (item.category ? String(item.category.id) : null);
  const photo = mediaSrc(item.photoUrl);

  if (done || item.status !== 'pending') {
    return (
      <EmptyState
        title={done ?? t.decide.blockers.decided}
        icon={Check}
        action={<Button label={t.nav.back} onPress={() => navigation.goBack()} />}
      />
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.line, boxShadow: colors.raise }]}>
        {photo && <Image source={{ uri: photo }} style={[styles.photo, { borderColor: colors.line }]} accessibilityLabel={item.name} accessibilityIgnoresInvertColors />}
        <Text style={[styles.panelTitle, { color: colors.ink }]} accessibilityRole="header">
          {item.name}
        </Text>
        <Text style={[styles.rowMeta, { color: colors.steel }]}>{t.decide.askedBy(item.requestedBy?.name ?? null, when(item.requestedAt))}</Text>
        {!!item.barcode && (
          <Text style={[styles.rowMeta, { color: colors.ink }]}>
            {item.barcode}
            {item.originCountry ? ` · ${flagEmoji(item.originCountry)} ${t.product.from(countryName(item.originCountry))}` : ''}
          </Text>
        )}
        <Text style={[styles.rowMeta, { color: colors.ink }]}>{t.decide.onShelf(item.stock)}</Text>
        {!!item.note && <Text style={[styles.rowMeta, { color: colors.ink }]}>“{item.note}”</Text>}
      </View>

      <TextField
        label={t.newProduct.price}
        value={shownPrice}
        onChangeText={setPrice}
        keyboardType="decimal-pad"
        error={priceOk ? undefined : t.newProduct.needPrice}
      />
      {categories.isError ? (
        <ErrorState error={categories.error} onRetry={() => categories.refetch()} />
      ) : (
        <ChoiceRow
          label={t.newProduct.category}
          options={(categories.data ?? []).map((category) => ({ value: String(category.id), label: category.name }))}
          value={chosenCategory ?? ''}
          onChange={setCategoryId}
        />
      )}
      {!chosenCategory && <Text style={[styles.rowMeta, { color: colors.steel }]}>{t.newProduct.needCategory}</Text>}

      {decide.isError && (
        <Text style={[styles.rowMeta, { color: colors.signalOut }]} accessibilityRole="alert">
          {errorMessage(decide.error)}
        </Text>
      )}
      {rejecting ? (
        <>
          <TextField label={t.decide.rejectWhy} value={why} onChangeText={setWhy} maxLength={500} autoFocus />
          <View style={styles.actions}>
            <View style={styles.action}>
              <Button variant="quiet" label={t.decide.cancel} onPress={() => setRejecting(false)} disabled={decide.isPending} />
            </View>
            <View style={styles.action}>
              <Button label={t.decide.sendReject} onPress={() => decide.mutate('reject')} disabled={!why.trim()} loading={decide.isPending} />
            </View>
          </View>
        </>
      ) : (
        <View style={styles.actions}>
          <View style={styles.action}>
            <Button variant="quiet" label={t.decide.reject} onPress={() => setRejecting(true)} disabled={decide.isPending} />
          </View>
          <View style={styles.action}>
            <Button label={t.decide.approve} onPress={() => decide.mutate('approve')} disabled={!chosenCategory || !priceOk} loading={decide.isPending} />
          </View>
        </View>
      )}
    </ScrollView>
  );
}

/** A scanned bill: a simple one is confirmed here, anything else is finished on the computer. */
export function BillCheckScreen({ route, navigation }: NativeStackScreenProps<RootStackParamList, 'BillCheck'>) {
  const colors = useThemeColors();
  const t = useT();
  const refresh = useRefreshAfterDecision();
  const check = useQuery({ queryKey: ['bill-scans', 'quick', route.params.id], queryFn: () => billScansApi.quick(route.params.id) });
  const confirm = useMutation({
    mutationFn: () => billScansApi.quickConfirm(route.params.id),
    onSuccess: refresh,
  });

  if (check.isPending) return <Loading />;
  if (check.isError) return <ErrorState error={check.error} onRetry={() => check.refetch()} />;
  if (confirm.isSuccess) {
    return <EmptyState title={t.decide.billConfirmed} icon={Check} action={<Button label={t.nav.back} onPress={() => navigation.goBack()} />} />;
  }
  const bill = check.data;

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.line, boxShadow: colors.raise }]}>
        <Text style={[styles.panelTitle, { color: colors.ink }]} accessibilityRole="header">
          {[bill.supplierName ?? '?', bill.number].filter(Boolean).join(' · ')}
        </Text>
        <Text style={[styles.rowMeta, { color: colors.steel }]}>
          {[t.decide.askedBy(bill.scannedBy, when(bill.scannedAt)), bill.amount !== null ? formatMoney(bill.amount) : null, t.decide.lines(bill.lines.length)]
            .filter(Boolean)
            .join(' · ')}
        </Text>
        {bill.lines.map((line, index) => (
          <View key={index} style={[styles.row, { borderTopColor: colors.line }]}>
            <Text style={[styles.rowName, { color: colors.ink }]}>
              {line.pieces} × {line.product ?? line.name}
            </Text>
            <Text style={[styles.rowMeta, { color: line.stamp === 'match' ? colors.steel : colors.ink }]}>
              {[
                t.decide.stamps[line.stamp] ?? line.stamp,
                line.unitCost !== null ? formatMoney(line.unitCost) : null,
                line.stamp === 'price' && line.oldCost !== null && line.unitCost !== null ? t.decide.costChange(formatMoney(line.oldCost), formatMoney(line.unitCost)) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
        ))}
      </View>

      {bill.blockers.length > 0 && (
        <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.line, boxShadow: colors.raise }]}>
          <Text style={[styles.panelTitle, { color: colors.ink }]} accessibilityRole="header">
            {t.decide.billOnDashboard}
          </Text>
          {bill.blockers.map((blocker) => (
            <Text key={blocker} style={[styles.rowMeta, { color: colors.ink }]}>
              • {t.decide.blockers[blocker] ?? blocker}
            </Text>
          ))}
        </View>
      )}

      {confirm.isError && (
        <Text style={[styles.rowMeta, { color: colors.signalOut }]} accessibilityRole="alert">
          {errorMessage(confirm.error)}
        </Text>
      )}
      {bill.input !== null && bill.blockers.length === 0 && (
        <Button label={t.decide.confirmBill} onPress={() => confirm.mutate()} loading={confirm.isPending} />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg },
  panel: { borderWidth: 1, borderRadius: radius.panel, padding: spacing.lg, gap: spacing.sm },
  panelTitle: { fontFamily: fonts.bodyBold, fontSize: type.title },
  row: { minHeight: 52, justifyContent: 'center', borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: spacing.sm },
  decideRow: { gap: spacing.xs },
  rowName: { fontFamily: fonts.bodyBold, fontSize: type.body },
  rowMeta: { fontFamily: fonts.body, fontSize: type.label },
  pressed: { opacity: 0.7 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  action: { flex: 1 },
  photo: { width: '100%', aspectRatio: 1, borderRadius: radius.small, borderWidth: 1 },
});
