import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';
import { mediaSrc } from '../services/apiClient';
import { fonts } from '../theme';

// Muted tones that keep white initials readable in both themes (same as the dashboard).
const COLOURS = ['#c2410c', '#9a3412', '#1e40af', '#6d28d9', '#047857', '#57534e'];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')).toUpperCase() || '?';
}

function colourFor(name: string): string {
  let hash = 0;
  for (const character of name) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return COLOURS[hash % COLOURS.length]!;
}

/** A person's photo, or their initials when they haven't added one. */
export function Avatar({ name, url, size = 40 }: { name: string; url: string | null; size?: number }) {
  const src = mediaSrc(url);
  const shape = { width: size, height: size, borderRadius: size / 2 };
  if (src) return <Image source={src} style={shape} contentFit="cover" accessibilityIgnoresInvertColors />;
  return (
    <View style={[styles.initials, shape, { backgroundColor: colourFor(name) }]} accessibilityElementsHidden>
      <Text style={[styles.text, { fontSize: Math.round(size * 0.4) }]}>{initials(name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  initials: { alignItems: 'center', justifyContent: 'center' },
  text: { fontFamily: fonts.display, color: '#ffffff' },
});
