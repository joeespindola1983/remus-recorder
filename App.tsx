import React, { useState, useEffect, useMemo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { t, setLocale, getLocale } from './src/i18n';
import { useWearables } from './src/services/wearables';
import {
  PermissionManager,
  AppPermissionsReport,
  PermissionStatus,
} from './src/services/permissions/PermissionManager';

export default function App(): React.JSX.Element {
  const [currentLang, setCurrentLang] = useState(getLocale());
  const [permissions, setPermissions] = useState<AppPermissionsReport>({
    location: PermissionStatus.UNDETERMINED,
    backgroundLocation: PermissionStatus.UNDETERMINED,
    sensors: PermissionStatus.UNDETERMINED,
  });

  const permissionManager = useMemo(() => new PermissionManager(), []);
  const {
    devices,
    currentSample,
    isRecording,
    startRecording,
    stopRecording,
    sendPing,
  } = useWearables();

  useEffect(() => {
    permissionManager.checkPermissions().then(report => {
      setPermissions(report);
    });
  }, [permissionManager]);

  const toggleLanguage = () => {
    const nextLang = currentLang === 'pt-BR' ? 'en-US' : 'pt-BR';
    setLocale(nextLang);
    setCurrentLang(nextLang);
  };

  const handleRequestPermissions = async () => {
    const report = await permissionManager.requestAllPermissions();
    setPermissions(report);
  };

  const handleToggleRecord = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>{t('appName')}</Text>
            <Text style={styles.subtitle}>{t('app.subtitle')}</Text>
          </View>
          <TouchableOpacity
            style={styles.langButton}
            onPress={toggleLanguage}
            accessibilityRole="button"
          >
            <Text style={styles.langText}>
              {currentLang === 'pt-BR' ? 'EN' : 'PT'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Action Button: Start / Stop Recording */}
        <TouchableOpacity
          style={[
            styles.recordButton,
            isRecording ? styles.recordButtonActive : styles.recordButtonIdle,
          ]}
          onPress={handleToggleRecord}
          accessibilityRole="button"
        >
          <Text style={styles.recordButtonText}>
            {isRecording ? t('actions.stopRecording') : t('actions.startRecording')}
          </Text>
          <Text style={styles.recordStatusText}>
            {isRecording ? t('actions.recording') : t('actions.idle')}
          </Text>
        </TouchableOpacity>

        {/* Wearables Card */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>{t('wearables.title')}</Text>
            <TouchableOpacity
              style={styles.pingButton}
              onPress={() => sendPing()}
              accessibilityRole="button"
            >
              <Text style={styles.pingButtonText}>{t('wearables.sendPing')}</Text>
            </TouchableOpacity>
          </View>

          {devices.length === 0 ? (
            <View style={styles.deviceRow}>
              <View style={[styles.statusDot, styles.dotDisconnected]} />
              <Text style={styles.deviceName}>{t('wearables.appleWatch')}</Text>
              <Text style={styles.deviceStatus}>{t('wearables.statusConnecting')}</Text>
            </View>
          ) : (
            devices.map(device => (
              <View key={device.id} style={styles.deviceRow}>
                <View
                  style={[
                    styles.statusDot,
                    device.state === 'connected' ? styles.dotConnected : styles.dotDisconnected,
                  ]}
                />
                <Text style={styles.deviceName}>{device.name}</Text>
                <Text style={styles.deviceStatus}>
                  {device.state === 'connected'
                    ? t('wearables.statusConnected')
                    : t('wearables.statusDisconnected')}
                </Text>
              </View>
            ))
          )}
        </View>

        {/* Sensor & GPS Metrics Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('telemetry.title')}</Text>
          <View style={styles.metricsGrid}>
            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>{t('sensors.heartRate')}</Text>
              <Text style={styles.metricValue}>
                {currentSample?.heartRateBeatsPerMinute !== undefined
                  ? `${currentSample.heartRateBeatsPerMinute} ${t('sensors.bpm')}`
                  : '--'}
              </Text>
            </View>

            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>{t('sensors.groundSpeed')}</Text>
              <Text style={styles.metricValue}>
                {currentSample?.location?.groundSpeedMetersPerSecond != null
                  ? `${(currentSample.location.groundSpeedMetersPerSecond * 3.6).toFixed(1)} km/h`
                  : '--'}
              </Text>
            </View>

            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>{t('sensors.latitude')}</Text>
              <Text style={styles.metricSubValue}>
                {currentSample?.location?.latitude !== undefined
                  ? currentSample.location.latitude.toFixed(5)
                  : '--'}
              </Text>
            </View>

            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>{t('sensors.longitude')}</Text>
              <Text style={styles.metricSubValue}>
                {currentSample?.location?.longitude !== undefined
                  ? currentSample.location.longitude.toFixed(5)
                  : '--'}
              </Text>
            </View>

            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>{t('sensors.accelerationIncludingGravity')}</Text>
              <Text style={styles.metricSubValue}>
                {currentSample?.accelerationIncludingGravityG
                  ? `X: ${currentSample.accelerationIncludingGravityG.x.toFixed(2)} Y: ${currentSample.accelerationIncludingGravityG.y.toFixed(2)} g`
                  : '--'}
              </Text>
            </View>

            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>{t('sensors.rotationRate')}</Text>
              <Text style={styles.metricSubValue}>
                {currentSample?.rotationRateRadiansPerSecond
                  ? `Z: ${currentSample.rotationRateRadiansPerSecond.z.toFixed(2)} rad/s`
                  : '--'}
              </Text>
            </View>
          </View>
        </View>

        {/* Permissions Card */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>{t('permissions.title')}</Text>
            <TouchableOpacity
              style={styles.requestButton}
              onPress={handleRequestPermissions}
              accessibilityRole="button"
            >
              <Text style={styles.requestButtonText}>{t('permissions.request')}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.permissionRow}>
            <Text style={styles.permissionName}>{t('permissions.location')}</Text>
            <Text
              style={[
                styles.permissionBadge,
                permissions.location === PermissionStatus.GRANTED
                  ? styles.badgeGranted
                  : styles.badgeDenied,
              ]}
            >
              {permissions.location === PermissionStatus.GRANTED
                ? t('permissions.granted')
                : t('permissions.denied')}
            </Text>
          </View>

          <View style={styles.permissionRow}>
            <Text style={styles.permissionName}>
              {t('permissions.backgroundLocation')}
            </Text>
            <Text
              style={[
                styles.permissionBadge,
                permissions.backgroundLocation === PermissionStatus.GRANTED
                  ? styles.badgeGranted
                  : styles.badgeDenied,
              ]}
            >
              {permissions.backgroundLocation === PermissionStatus.GRANTED
                ? t('permissions.granted')
                : t('permissions.denied')}
            </Text>
          </View>

          <View style={styles.permissionRow}>
            <Text style={styles.permissionName}>{t('permissions.sensors')}</Text>
            <Text
              style={[
                styles.permissionBadge,
                permissions.sensors === PermissionStatus.GRANTED
                  ? styles.badgeGranted
                  : styles.badgeDenied,
              ]}
            >
              {permissions.sensors === PermissionStatus.GRANTED
                ? t('permissions.granted')
                : t('permissions.denied')}
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    marginTop: 8,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: '#F8FAFC',
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 13,
    color: '#94A3B8',
    marginTop: 2,
  },
  langButton: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  langText: {
    color: '#38BDF8',
    fontWeight: '700',
    fontSize: 13,
  },
  recordButton: {
    paddingVertical: 18,
    borderRadius: 14,
    alignItems: 'center',
    marginBottom: 16,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  recordButtonIdle: {
    backgroundColor: '#10B981',
  },
  recordButtonActive: {
    backgroundColor: '#EF4444',
  },
  recordButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  recordStatusText: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 12,
    marginTop: 3,
    fontWeight: '500',
  },
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F1F5F9',
  },
  pingButton: {
    backgroundColor: '#0EA5E9',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  pingButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 10,
  },
  dotConnected: {
    backgroundColor: '#10B981',
  },
  dotDisconnected: {
    backgroundColor: '#F59E0B',
  },
  deviceName: {
    flex: 1,
    color: '#E2E8F0',
    fontSize: 14,
    fontWeight: '600',
  },
  deviceStatus: {
    color: '#94A3B8',
    fontSize: 12,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  metricItem: {
    width: '48%',
    backgroundColor: '#0F172A',
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  metricLabel: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '500',
  },
  metricValue: {
    color: '#38BDF8',
    fontSize: 18,
    fontWeight: '700',
    marginTop: 4,
  },
  metricSubValue: {
    color: '#CBD5E1',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 4,
  },
  requestButton: {
    backgroundColor: '#6366F1',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  requestButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  permissionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  permissionName: {
    color: '#E2E8F0',
    fontSize: 13,
    fontWeight: '500',
  },
  permissionBadge: {
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  badgeGranted: {
    color: '#10B981',
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
  },
  badgeDenied: {
    color: '#F87171',
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
  },
});
