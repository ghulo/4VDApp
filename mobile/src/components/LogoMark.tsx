import Svg, { Path, Rect } from 'react-native-svg';

/** The 4VD mark: four equal pillars under one roof (see brand/README.md). */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Rect width={64} height={64} rx={14} fill="#1D5C45" />
      <Path d="M11 25 L32 11 L53 25" fill="none" stroke="#D9A945" strokeWidth={5.5} strokeLinecap="round" strokeLinejoin="round" />
      {[14, 24.5, 35, 45.5].map((x) => (
        <Rect key={x} x={x} y={30} width={6.5} height={22} rx={1.5} fill="#FFFFFF" />
      ))}
    </Svg>
  );
}
