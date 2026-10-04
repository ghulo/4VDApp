import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { customersApi } from '../services/api';
import type { Customer } from '../services/types';
import { fonts, radius, spacing, useThemeColors } from '../theme';
import { errorMessage, formatMoney } from '../utils/format';
import { useT } from '../i18n/useT';

const SHOWN = 6;

/**
 * "Put on a tab" for a sale: pick a regular, or open a tab for someone new
 * by typing their name. Paid now is the default.
 */
export function TabPicker({ value, onChange }: { value: Customer | null; onChange: (customer: Customer | null) => void }) {
  const colors = useThemeColors();
  const t = useT();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const customers = useQuery({ queryKey: ['customers'], queryFn: customersApi.list, enabled: open });
  const create = useMutation({
    mutationFn: () => customersApi.create({ name: search.trim(), phone: null, note: null }),
    onSuccess: (customer) => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      pick(customer);
    },
  });

  function pick(customer: Customer | null) {
    onChange(customer);
    setOpen(false);
    setSearch('');
  }

  if (value) {
    return (
      <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <Text style={[styles.label, { color: colors.ink }]}>{t.tabs.onTabOf(value.name)}</Text>
        <Text style={[styles.hint, { color: colors.inkMuted }]}>{t.tabs.onTabHint}</Text>
        <Pressable accessibilityRole="button" onPress={() => pick(null)} hitSlop={8}>
          <Text style={[styles.link, { color: colors.ink }]}>{t.tabs.paidNow}</Text>
        </Pressable>
      </View>
    );
  }

  if (!open) {
    return (
      <Pressable accessibilityRole="button" onPress={() => setOpen(true)} hitSlop={8} style={styles.opener}>
        <Text style={[styles.link, { color: colors.ink }]}>{t.tabs.putOnTab}</Text>
      </Pressable>
    );
  }

  const query = search.trim().toLowerCase();
  const matches = (customers.data ?? []).filter((customer) => customer.name.toLowerCase().includes(query)).slice(0, SHOWN);
  const exact = (customers.data ?? []).some((customer) => customer.name.toLowerCase() === query);

  return (
    <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      <Text style={[styles.label, { color: colors.ink }]}>{t.tabs.whose}</Text>
      <TextInput
        value={search}
        onChangeText={setSearch}
        placeholder={t.tabs.searchPlaceholder}
        placeholderTextColor={colors.steel}
        accessibilityLabel={t.tabs.whose}
        autoCorrect={false}
        style={[styles.search, { color: colors.ink, borderColor: colors.lineStrong, backgroundColor: colors.background }]}
      />
      {matches.map((customer) => (
        <Pressable
          key={customer.id}
          accessibilityRole="button"
          onPress={() => pick(customer)}
          style={({ pressed }) => [styles.row, { borderTopColor: colors.line, backgroundColor: pressed ? colors.fill : 'transparent' }]}
        >
          <Text style={[styles.name, { color: colors.ink }]}>{customer.name}</Text>
          {customer.balance > 0 && <Text style={[styles.hint, { color: colors.inkMuted }]}>{t.tabs.owes(formatMoney(customer.balance))}</Text>}
        </Pressable>
      ))}
      {query !== '' && !exact && (
        <Pressable
          accessibilityRole="button"
          onPress={() => create.mutate()}
          disabled={create.isPending}
          style={({ pressed }) => [styles.row, { borderTopColor: colors.line, backgroundColor: pressed ? colors.fill : 'transparent' }]}
        >
          <Text style={[styles.name, { color: colors.ink }]}>{t.tabs.newTab(search.trim())}</Text>
        </Pressable>
      )}
      {create.isError && <Text style={[styles.hint, { color: colors.signalOut }]}>{errorMessage(create.error)}</Text>}
      <Pressable accessibilityRole="button" onPress={() => pick(null)} hitSlop={8}>
        <Text style={[styles.link, { color: colors.ink }]}>{t.tabs.paidNow}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { borderWidth: 1, borderRadius: radius.panel, padding: spacing.md, gap: spacing.sm },
  opener: { paddingVertical: spacing.sm, minHeight: 44, justifyContent: 'center' },
  label: { fontFamily: fonts.bodyBold, fontSize: 15 },
  hint: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20 },
  link: { fontFamily: fonts.bodyBold, fontSize: 15, textDecorationLine: 'underline' },
  search: { borderWidth: 1, borderRadius: radius.small, paddingHorizontal: spacing.md, minHeight: 44, fontFamily: fonts.body, fontSize: 16 },
  row: { minHeight: 48, justifyContent: 'center', borderTopWidth: 1, paddingVertical: spacing.xs },
  name: { fontFamily: fonts.bodyBold, fontSize: 16 },
});
