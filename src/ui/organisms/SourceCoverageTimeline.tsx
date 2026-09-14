import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { t } from '../../i18n';
import { color, fontFamily, radius, spacing } from '../theme/tokens';

export interface CoverageSegment {
  startRatio: number;
  endRatio: number;
}

export interface SourceCoverageLane {
  sourceId: string;
  sourceName: string;
  coverageSegments: CoverageSegment[];
  isInterrupted?: boolean;
}

export function SourceCoverageTimeline({
  startTimeText,
  endTimeText,
  lanes,
}: {
  startTimeText: string;
  endTimeText: string;
  lanes: SourceCoverageLane[];
  testID?: string;
}): React.JSX.Element {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('summary.coverageTitle')}</Text>
      <View style={styles.timeRow}>
        <Text style={styles.timeText}>{startTimeText}</Text>
        <Text style={styles.timeText}>{endTimeText}</Text>
      </View>

      <View style={styles.lanes}>
        {lanes.map(lane => (
          <View key={lane.sourceId} style={styles.laneRow}>
            <Text style={styles.sourceName}>{lane.sourceName}</Text>
            <View style={styles.track}>
              {lane.coverageSegments.map((segment, index) => {
                const left = `${Math.max(0, Math.min(100, segment.startRatio * 100))}%`;
                const width = `${Math.max(
                  0,
                  Math.min(100, (segment.endRatio - segment.startRatio) * 100),
                )}%`;
                return (
                  <View
                    key={index}
                    style={[
                      styles.segment,
                      { left, width },
                      lane.isInterrupted && styles.segmentInterrupted,
                    ]}
                  />
                );
              })}
            </View>
          </View>
        ))}
      </View>

      <Text style={styles.gapNotice}>{t('summary.coverageGapNotice')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: color.surfaceDefault,
    borderColor: color.borderDefault,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  title: {
    color: color.textPrimary,
    fontFamily,
    fontSize: 18,
    fontWeight: '700',
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  timeText: {
    color: color.textTertiary,
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
  },
  lanes: {
    gap: spacing.sm,
    marginVertical: 4,
  },
  laneRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  sourceName: {
    color: color.textPrimary,
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    width: 60,
  },
  track: {
    backgroundColor: color.backgroundTertiary,
    borderRadius: radius.md,
    flex: 1,
    height: 14,
    overflow: 'hidden',
    position: 'relative',
  },
  segment: {
    backgroundColor: color.actionPrimary,
    borderRadius: 2,
    bottom: 0,
    position: 'absolute',
    top: 0,
  },
  segmentInterrupted: {
    backgroundColor: color.warning,
  },
  gapNotice: {
    color: color.textSecondary,
    fontFamily,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
});
