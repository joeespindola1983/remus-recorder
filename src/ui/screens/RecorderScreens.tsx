import React, { useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { ActivityCaptureState } from '../../application/capture/ActivityCapture';
import { t } from '../../i18n';
import { ActionButton } from '../atoms/ActionButton';
import { OperationalEventBanner } from '../molecules/OperationalEventBanner';
import {
  AdaptiveCaptureSurface,
  captureOrientationFor,
} from '../organisms/AdaptiveCaptureSurface';
import { DeviceReadinessPanel } from '../organisms/DeviceReadinessPanel';
import { RemusBladeSnapshot } from '../../services/blade/RemusBladeAdapter';
import { RecordingManifest } from '../../services/recording/RecordingService';
import {
  describePhoneSummaryEvidence,
  overallReadinessSummary,
} from '../presentation/deviceReadiness';
import {
  SourceCoverageLane,
  SourceCoverageTimeline,
} from '../organisms/SourceCoverageTimeline';
import { SourceFleetPanel } from '../organisms/SourceFleetPanel';
import { color, fontFamily, radius, spacing } from '../theme/tokens';

const elapsed = (seconds: number): string => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map(value => String(value).padStart(2, '0')).join(':');
};

export function ReadyScreen({
  state,
  onStart,
  onRequestPermissions,
  bladeSnapshot,
  onSendGpsAid,
  onDisconnectBlade,
  onConnectBlade,
}: {
  state: ActivityCaptureState;
  onStart: () => void;
  onRequestPermissions?: () => void;
  bladeSnapshot?: RemusBladeSnapshot | null;
  onSendGpsAid?: () => void;
  onDisconnectBlade?: () => void;
  onConnectBlade?: () => void;
}): React.JSX.Element {
  const [expandedSourceId, setExpandedSourceId] = useState<string | null>(null);
  const sourcesList = Object.values(state.sources);
  const overall = overallReadinessSummary(sourcesList);
  const expandedIds = expandedSourceId ? [expandedSourceId] : [];

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>{t('ready.eyebrow')}</Text>
      <Text style={styles.title}>{t('ready.title')}</Text>
      <Text style={styles.body}>{t('ready.body')}</Text>
      <View
        style={[
          styles.readinessCard,
          overall.hasMissingPermissions && styles.readinessCardDegraded,
        ]}
      >
        <Text style={styles.readinessTitle}>{overall.title}</Text>
        <Text style={styles.readinessSummary}>{overall.summary}</Text>
      </View>
      <DeviceReadinessPanel
        expandedSourceIds={expandedIds}
        onRequestPermissions={onRequestPermissions}
        onToggleExpand={(sourceId: string) => {
          setExpandedSourceId(prev => (prev === sourceId ? null : sourceId));
        }}
        sources={sourcesList}
        bladeSnapshot={bladeSnapshot}
        onSendGpsAid={onSendGpsAid}
        onDisconnectBlade={onDisconnectBlade}
        onConnectBlade={onConnectBlade}
      />
      <ActionButton label={t('ready.startAction')} onPress={onStart} />
    </ScrollView>
  );
}

export function ActiveScreen({
  state,
  onStop,
  onPause,
}: {
  state: ActivityCaptureState;
  onStop: () => void;
  onPause: () => void;
}): React.JSX.Element {
  const { width, height } = useWindowDimensions();
  const orientation = captureOrientationFor(width, height);
  const interrupted = Object.values(state.sources).some(
    source => source.recordingState === 'interrupted',
  );
  return (
    <View style={styles.screen}>
      <AdaptiveCaptureSurface
        metrics={state.metrics}
        onFinish={onStop}
        onPause={onPause}
        orientation={orientation}
        viewportWidth={width}
      />
      {interrupted ? (
        <View
          style={[
            styles.connectionNotice,
            orientation === 'landscape' && styles.connectionNoticeLandscape,
          ]}
        >
          <OperationalEventBanner />
        </View>
      ) : null}
    </View>
  );
}

export function FinalizingScreen({
  state,
}: {
  state: ActivityCaptureState;
}): React.JSX.Element {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>{t('finalizing.eyebrow')}</Text>
      <Text style={styles.title}>{t('finalizing.title')}</Text>
      <Text style={styles.body}>{t('finalizing.body')}</Text>
      <SourceFleetPanel sources={Object.values(state.sources)} />
    </ScrollView>
  );
}

export function SummaryScreen({
  state,
  lastManifest,
  onExport,
  onViewAnalysis,
}: {
  state: ActivityCaptureState;
  lastManifest?: RecordingManifest | null;
  onExport?: () => void;
  onViewAnalysis?: () => void;
}): React.JSX.Element {
  const interrupted = Object.values(state.sources).filter(
    source => source.recordingState === 'interrupted',
  ).length;

  const phoneSource = Object.values(state.sources).find(
    s => s.deviceFamily === 'iphone' || s.deviceFamily === 'android_phone',
  );
  const phoneEvidence = phoneSource
    ? describePhoneSummaryEvidence(phoneSource)
    : null;

  const sourceNameMap: Record<string, string> = {
    remus_blade: 'RBP1',
    iphone: 'iPhone',
    android_phone: 'Android',
    apple_watch: 'Watch',
    wear_os: 'Wear OS',
  };

  const recordedSources = Object.values(state.sources).filter(
    source => source.recordingId !== undefined,
  );
  const activeSources =
    recordedSources.length > 0 ? recordedSources : Object.values(state.sources);

  const lanes: SourceCoverageLane[] = activeSources.map(source => {
    const isInterrupted = source.recordingState === 'interrupted';
    return {
      sourceId: source.sourceId,
      sourceName: sourceNameMap[source.deviceFamily] ?? source.deviceFamily,
      coverageSegments: isInterrupted
        ? [{ startRatio: 0, endRatio: 0.65 }]
        : [{ startRatio: 0, endRatio: 1 }],
      isInterrupted,
    };
  });

  const formatClock = (epochMs: number): string => {
    const d = new Date(epochMs);
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  };

  const startTimeText = lastManifest?.startedAtEpochMilliseconds
    ? formatClock(lastManifest.startedAtEpochMilliseconds)
    : '06:18';
  const endTimeText = lastManifest?.endedAtEpochMilliseconds
    ? formatClock(lastManifest.endedAtEpochMilliseconds)
    : '07:02';

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>{t('summary.eyebrow')}</Text>
      <Text style={styles.title}>{t('summary.title')}</Text>
      <Text style={styles.body}>{t('summary.body')}</Text>
      <View style={styles.summaryCard}>
        <Text style={styles.summaryValue}>
          {elapsed(state.metrics.elapsedSeconds)}
        </Text>
        <Text style={styles.summaryLabel}>{t('summary.capturedDuration')}</Text>
        <Text style={styles.summaryDetail}>
          {interrupted === 0
            ? t('summary.fullCoverage')
            : `${interrupted} ${t('summary.interruptedPrefix')}`}
        </Text>
      </View>

      <SourceCoverageTimeline
        testID="source-coverage-timeline"
        endTimeText={endTimeText}
        lanes={lanes}
        startTimeText={startTimeText}
      />

      {lastManifest ? (
        <View style={styles.evidenceDiskCard}>
          <Text style={styles.evidenceDiskTitle}>
            {t('summary.realEvidenceTitle')}
          </Text>
          {lastManifest.sampleCounts?.phoneMotion !== undefined ? (
            <View style={styles.evidenceRow}>
              <Text style={styles.evidenceMetricLabel}>
                {t('summary.phoneMotionSamples')}
              </Text>
              <Text style={styles.evidenceMetricValue}>
                {String(lastManifest.sampleCounts.phoneMotion)}
              </Text>
            </View>
          ) : null}
          {lastManifest.sampleCounts?.phoneLocation !== undefined ? (
            <View style={styles.evidenceRow}>
              <Text style={styles.evidenceMetricLabel}>
                {t('summary.phoneLocationSamples')}
              </Text>
              <Text style={styles.evidenceMetricValue}>
                {String(lastManifest.sampleCounts.phoneLocation)}
              </Text>
            </View>
          ) : null}
          {lastManifest.sampleCounts?.watchHeartRate !== undefined &&
          lastManifest.sampleCounts.watchHeartRate > 0 ? (
            <View style={styles.evidenceRow}>
              <Text style={styles.evidenceMetricLabel}>
                {t('summary.watchSamples')}
              </Text>
              <Text style={styles.evidenceMetricValue}>
                {String(lastManifest.sampleCounts.watchHeartRate)}
              </Text>
            </View>
          ) : null}
          {lastManifest.sampleCounts?.remusBladeLive !== undefined &&
          lastManifest.sampleCounts.remusBladeLive > 0 ? (
            <View style={styles.evidenceRow}>
              <Text style={styles.evidenceMetricLabel}>
                {t('summary.bladeSamples')}
              </Text>
              <Text style={styles.evidenceMetricValue}>
                {String(lastManifest.sampleCounts.remusBladeLive)}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {onExport ? (
        <ActionButton
          label={t('summary.exportZipAction')}
          onPress={onExport}
          tone="secondary"
        />
      ) : null}

      <View style={styles.analysisCard}>
        <Text style={styles.analysisTitle}>{t('summary.analysisReadyTitle')}</Text>
        <Text style={styles.analysisDetail}>
          {t('summary.analysisReadyDetail')}
        </Text>
      </View>

      {onViewAnalysis ? (
        <ActionButton
          label={t('summary.viewAnalysis')}
          onPress={onViewAnalysis}
        />
      ) : null}

      {phoneEvidence ? (
        <View style={styles.phoneEvidenceCard}>
          <Text style={styles.phoneEvidenceTitle}>
            {t('summary.phoneEvidenceTitle')}
          </Text>
          <View style={styles.badgeRow}>
            {phoneEvidence.sensorBadges.map(badge => (
              <View key={badge} style={styles.sensorBadge}>
                <Text style={styles.sensorBadgeText}>{badge}</Text>
              </View>
            ))}
          </View>
          {phoneEvidence.caveat ? (
            <Text style={styles.phoneCaveatText}>{phoneEvidence.caveat}</Text>
          ) : null}
        </View>
      ) : null}

      <SourceFleetPanel sources={Object.values(state.sources)} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: color.backgroundDefault, flex: 1 },
  content: {
    backgroundColor: color.backgroundDefault,
    gap: spacing.md,
    padding: spacing.md,
    paddingBottom: 120,
  },
  header: {
    alignItems: 'center',
    borderBottomColor: color.borderDefault,
    borderBottomWidth: 1,
    flexDirection: 'row',
    height: 64,
    justifyContent: 'space-between',
  },
  brand: {
    color: color.textPrimary,
    fontFamily,
    fontSize: 20,
    fontWeight: '700',
  },
  settingsMark: {
    alignItems: 'center',
    borderColor: color.actionPrimary,
    borderRadius: 25,
    borderWidth: 2,
    height: 50,
    justifyContent: 'center',
    width: 50,
  },
  settingsText: { color: color.actionPrimary, fontSize: 28 },
  eyebrow: {
    color: color.textSecondary,
    fontFamily,
    fontSize: 12,
    marginTop: spacing.xs,
  },
  title: {
    color: color.textPrimary,
    fontFamily,
    fontSize: 24,
    fontWeight: '700',
  },
  body: {
    color: color.textSecondary,
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
  },
  connectionNotice: {
    bottom: 120,
    left: spacing.md,
    position: 'absolute',
    right: spacing.md,
  },
  connectionNoticeLandscape: { bottom: spacing.md, right: 124 },
  readinessCard: {
    backgroundColor: color.successContainer,
    borderRadius: radius.xl,
    padding: spacing.md,
  },
  readinessCardDegraded: {
    backgroundColor: '#291F0A',
    borderColor: color.actionPrimary,
    borderWidth: 1,
  },
  readinessTitle: {
    color: color.textPrimary,
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
  },
  readinessSummary: { color: color.textSecondary, fontFamily, fontSize: 12 },
  summaryCard: {
    backgroundColor: color.successContainer,
    borderRadius: 20,
    gap: 4,
    padding: spacing.lg,
  },
  summaryValue: {
    color: color.textPrimary,
    fontFamily,
    fontSize: 32,
    fontWeight: '700',
  },
  summaryLabel: {
    color: color.textSecondary,
    fontFamily,
    fontSize: 12,
    textTransform: 'uppercase',
  },
  summaryDetail: {
    color: color.success,
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    marginTop: spacing.sm,
  },
  analysisCard: {
    backgroundColor: color.surfaceDefault,
    borderColor: color.borderDefault,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.md,
  },
  analysisTitle: {
    color: color.textPrimary,
    fontFamily,
    fontSize: 16,
    fontWeight: '700',
  },
  analysisDetail: {
    color: color.textSecondary,
    fontFamily,
    fontSize: 13,
    lineHeight: 18,
  },
  phoneEvidenceCard: {
    backgroundColor: color.surfaceDefault,
    borderColor: color.borderDefault,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
  },
  phoneEvidenceTitle: {
    color: color.textPrimary,
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  sensorBadge: {
    backgroundColor: color.successContainer,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  sensorBadgeText: {
    color: color.textPrimary,
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
  },
  phoneCaveatText: {
    color: color.textTertiary,
    fontFamily,
    fontSize: 12,
    fontStyle: 'italic',
    marginTop: spacing.xs,
  },
  evidenceDiskCard: {
    backgroundColor: color.surfaceDefault,
    borderColor: color.borderDefault,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.md,
  },
  evidenceDiskTitle: {
    color: color.textPrimary,
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  evidenceRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  evidenceMetricLabel: {
    color: color.textSecondary,
    fontFamily,
    fontSize: 13,
  },
  evidenceMetricValue: {
    color: color.textPrimary,
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
  },
});
