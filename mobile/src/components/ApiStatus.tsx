import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { apiClient } from '../services/apiClient';

type ConnectionState =
  | { kind: 'checking' }
  | { kind: 'online' }
  | { kind: 'offline'; reason: string };

const DOT_COLORS: Record<ConnectionState['kind'], string> = {
  checking: '#c58a00',
  online: '#1f9d55',
  offline: '#d64545',
};

export function ApiStatus({ textColor }: { textColor: string }) {
  const [connection, setConnection] = useState<ConnectionState>({ kind: 'checking' });

  useEffect(() => {
    let isCancelled = false;

    apiClient
      .getHealth()
      .then(() => {
        if (!isCancelled) setConnection({ kind: 'online' });
      })
      .catch((error: unknown) => {
        const reason = error instanceof Error ? error.message : 'Unknown error';
        if (!isCancelled) setConnection({ kind: 'offline', reason });
      });

    // Avoid setting state if the screen unmounts before the request ends.
    return () => {
      isCancelled = true;
    };
  }, []);

  const label =
    connection.kind === 'checking'
      ? 'Checking API connection…'
      : connection.kind === 'online'
        ? 'API online'
        : `API unreachable: ${connection.reason}`;

  return (
    <View style={styles.row} accessibilityRole="text" accessibilityLiveRegion="polite">
      <View style={[styles.dot, { backgroundColor: DOT_COLORS[connection.kind] }]} />
      <Text style={[styles.label, { color: textColor }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  label: {
    fontSize: 14,
    flexShrink: 1,
  },
});
