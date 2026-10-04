import { useId } from 'react';
import Svg, { Circle, ClipPath, Defs, Path, Rect } from 'react-native-svg';

const PILLARS = [18, 25.67, 33.33, 41];

/** The 4VD mark: the shop at sunrise, four equal pillars under one roof (see brand/logo-mark.svg). */
export function LogoMark({ size = 32 }: { size?: number }) {
  // Each mark on a screen needs its own clip id.
  const clipId = `logo-ground-${useId().replace(/:/g, '')}`;
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Defs>
        <ClipPath id={clipId}>
          <Rect width={64} height={46} />
        </ClipPath>
      </Defs>
      <Rect x={0.5} y={0.5} width={63} height={63} rx={13.5} fill="#FAF9F5" stroke="#E3DACC" />
      <Circle cx={32} cy={35} r={21} fill="#D4704F" clipPath={`url(#${clipId})`} />
      <Rect x={8} y={36} width={48} height={1.4} fill="#FAF9F5" />
      <Rect x={8} y={40} width={48} height={1.8} fill="#FAF9F5" />
      <Path d="M16 27 L32 16 L48 27" fill="none" stroke="#141413" strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" />
      {PILLARS.map((x) => (
        <Rect key={x} x={x} y={29} width={5} height={14} rx={1} fill="#141413" />
      ))}
      <Rect x={15} y={42.5} width={34} height={3.5} rx={1} fill="#141413" />
      <Rect x={7} y={46} width={50} height={2.6} rx={1.3} fill="#141413" />
    </Svg>
  );
}
