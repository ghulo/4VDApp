import { type BarcodeScanningResult, CameraView, useCameraPermissions } from 'expo-camera';
import { useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { fonts, radius, spacing, useThemeColors } from '../theme';
import { useT } from '../i18n/useT';
import { codeFromScan } from '../utils/scanLinks';
import { Button } from './ui';

/** Product barcodes, the Code 128 some suppliers print, and the shop's own QR codes. */
const BARCODE_TYPES = ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'qr'] as const;
/** The camera sees the same code many times a second; one read per this long. */
const SAME_CODE_PAUSE_MS = 1500;

/**
 * The phone camera as a barcode scanner. On the web it uses the browser's
 * barcode reader (with a fallback where there is none).
 */
export function BarcodeScanner({ onScan }: { onScan: (code: string) => void }) {
  const colors = useThemeColors();
  const t = useT();
  const [permission, requestPermission] = useCameraPermissions();
  const last = useRef<{ code: string; at: number } | null>(null);

  function handleScan(result: BarcodeScanningResult) {
    const code = codeFromScan(result.data);
    const now = Date.now();
    if (last.current && last.current.code === code && now - last.current.at < SAME_CODE_PAUSE_MS) return;
    last.current = { code, at: now };
    onScan(code);
  }

  if (!permission) return null;
  if (!permission.granted) {
    return (
      <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.line, boxShadow: colors.raise }]}>
        <Text style={[styles.text, { color: colors.ink }]}>{t.sell.cameraNeeded}</Text>
        <Button label={t.sell.allowCamera} onPress={() => requestPermission()} />
      </View>
    );
  }

  return (
    <View style={[styles.cameraBox, { borderColor: colors.line }]}>
      {/* The height lives on a wrapper: on the web the camera fills its parent rather than taking a height itself. */}
      <View style={styles.camera}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: [...BARCODE_TYPES] }}
          onBarcodeScanned={handleScan}
        />
      </View>
      <Text style={[styles.hint, { color: colors.inkMuted, backgroundColor: colors.surface }]}>{t.sell.scanHint}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { padding: spacing.lg, gap: spacing.md, borderWidth: 1, borderRadius: radius.panel },
  text: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21 },
  cameraBox: { borderWidth: 1, borderRadius: radius.panel, overflow: 'hidden' },
  camera: { height: 220 },
  hint: { fontFamily: fonts.body, fontSize: 14, padding: spacing.sm, textAlign: 'center' },
});
