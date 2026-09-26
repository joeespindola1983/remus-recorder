import React, { useEffect, useRef, useState } from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { t } from '../../i18n';
import { RemusBladeManager } from '../../services/blade/RemusBladeManager';
import { color, fontFamily, spacing } from '../theme/tokens';
import {
  addParityHistoryPoint,
  calculateParityPercentage,
  normalizeBladeRotation,
  ParityHistoryPoint,
} from '../presentation/bladeParity';

const MAX_HISTORY_POINTS = 24;
const LEFT_COLOR = '#38bdf8'; // Sky blue / cyan for Left Oar
const RIGHT_COLOR = '#f97316'; // Vibrant orange for Right Oar

export function LiveBladeParityCell({
  bladeManager,
  valueFontSize,
  style,
}: {
  bladeManager?: RemusBladeManager | null;
  valueFontSize: number;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  const [parityPercent, setParityPercent] = useState<number | null>(null);
  const [history, setHistory] = useState<ParityHistoryPoint[]>(() =>
    Array.from({ length: MAX_HISTORY_POINTS }, (_, i) => ({
      left: 0,
      right: 0,
      timestamp: i,
    })),
  );

  const leftRateRef = useRef<number>(0);
  const rightRateRef = useRef<number>(0);
  const hasLeftRef = useRef<boolean>(false);
  const hasRightRef = useRef<boolean>(false);

  useEffect(() => {
    if (!bladeManager || typeof bladeManager.onSensorData !== 'function') {
      return;
    }

    const unsub = bladeManager.onSensorData((sample, placement) => {
      const rot = normalizeBladeRotation(sample, placement);
      if (rot === null) return;

      if (placement === 'left_paddle') {
        leftRateRef.current = rot;
        hasLeftRef.current = true;
      } else if (placement === 'right_paddle') {
        rightRateRef.current = rot;
        hasRightRef.current = true;
      } else {
        return;
      }

      if (hasLeftRef.current && hasRightRef.current) {
        const left = leftRateRef.current;
        const right = rightRateRef.current;
        const score = calculateParityPercentage(left, right);
        if (score !== null) {
          setParityPercent(score);
        }

        setHistory(prev =>
          addParityHistoryPoint(
            prev,
            {
              left,
              right,
              parityPercent: score,
              timestamp: Date.now(),
            },
            MAX_HISTORY_POINTS,
          ),
        );
      }
    });

    return () => unsub();
  }, [bladeManager]);

  const valueDisplay = parityPercent !== null ? String(parityPercent) : '—';
  const lengthScale =
    valueDisplay.length >= 5 ? 0.72 : valueDisplay.length >= 3 ? 0.85 : 1.0;
  const adaptiveFontSize = Math.round(valueFontSize * lengthScale * 0.82);

  return (
    <View style={[styles.cell, style]}>
      {/* Header with Title and Left/Right Legend */}
      <View style={styles.headerRow}>
        <Text style={styles.label}>{t('active.metric.parity')}</Text>
        <View style={styles.legendRow}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: LEFT_COLOR }]} />
            <Text style={styles.legendText}>{t('active.metric.parityLeft')}</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: RIGHT_COLOR }]} />
            <Text style={styles.legendText}>{t('active.metric.parityRight')}</Text>
          </View>
        </View>
      </View>

      {/* Main Metric Value */}
      <View style={styles.valueRow}>
        <Text
          adjustsFontSizeToFit
          minimumFontScale={0.35}
          numberOfLines={1}
          style={[styles.value, { fontSize: adaptiveFontSize }]}
          testID="metric-value-parityPercentage"
        >
          {valueDisplay}
        </Text>
        {parityPercent !== null ? (
          <Text style={styles.unitText}>{t('active.metric.parityUnit')}</Text>
        ) : null}
      </View>

      {/* Mini Rolling Parity Waveform Graph */}
      <View style={styles.graphContainer} testID="blade-parity-graph">
        <View style={styles.centerLine} />
        <View style={styles.barsContainer}>
          {history.map((pt, idx) => {
            // Scale angular velocity: peak ~3.0 rad/s mapped to 16px half-height
            const leftHeight = Math.min(16, Math.max(2, Math.abs(pt.left) * 5));
            const rightHeight = Math.min(16, Math.max(2, Math.abs(pt.right) * 5));
            const leftIsPositive = pt.left >= 0;
            const rightIsPositive = pt.right >= 0;

            return (
              <View key={idx} style={styles.graphColumn}>
                <View
                  style={[
                    styles.barSegment,
                    {
                      backgroundColor: LEFT_COLOR,
                      height: leftHeight,
                      marginTop: leftIsPositive ? 16 - leftHeight : 16,
                    },
                  ]}
                />
                <View
                  style={[
                    styles.barSegment,
                    {
                      backgroundColor: RIGHT_COLOR,
                      height: rightHeight,
                      marginTop: rightIsPositive ? 16 - rightHeight : 16,
                    },
                  ]}
                />
              </View>
            );
          })}
        </View>
      </View>

      <Text style={styles.footerLabel}>{t('active.metric.paritySync')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  cell: {
    backgroundColor: color.surfaceDefault,
    borderColor: color.borderDefault,
    borderWidth: 0.5,
    padding: spacing.md,
    justifyContent: 'space-between',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    color: color.textSecondary,
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  legendDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  legendText: {
    color: color.textSecondary,
    fontFamily,
    fontSize: 10,
    fontWeight: '700',
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
  },
  value: {
    color: color.textPrimary,
    fontFamily,
    fontWeight: '800',
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  unitText: {
    color: color.textSecondary,
    fontFamily,
    fontSize: 14,
    fontWeight: '700',
    marginLeft: 2,
  },
  graphContainer: {
    height: 34,
    width: '100%',
    position: 'relative',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 4,
    overflow: 'hidden',
    paddingHorizontal: 2,
  },
  centerLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 17,
    height: 1,
    backgroundColor: color.borderDefault,
    opacity: 0.6,
  },
  barsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: '100%',
    width: '100%',
  },
  graphColumn: {
    flexDirection: 'row',
    width: 4,
    height: 32,
    gap: 0.5,
  },
  barSegment: {
    width: 1.5,
    borderRadius: 0.5,
    opacity: 0.85,
  },
  footerLabel: {
    alignSelf: 'flex-end',
    color: color.textTertiary,
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
  },
});
