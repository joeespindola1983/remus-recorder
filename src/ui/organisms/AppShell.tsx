import React, { useContext } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { t } from '../../i18n';
import { NavIcon, NavIconName } from '../atoms/NavIcon';
import { color, fontFamily, spacing } from '../theme/tokens';

export type NavigationTab = NavIconName;

export function AppShell({
  activeTab = 'activities',
  onSelectTab,
  onSettingsPress,
  children,
  showNav = true,
}: {
  activeTab?: NavigationTab;
  onSelectTab?: (tab: NavigationTab) => void;
  onSettingsPress?: () => void;
  children: React.ReactNode;
  showNav?: boolean;
}): React.JSX.Element {
  const insets = useContext(SafeAreaInsetsContext) ?? {
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
  };
  const tabs: { key: NavigationTab; label: string }[] = [
    { key: 'home', label: t('nav.home') },
    { key: 'activities', label: t('nav.activities') },
    { key: 'community', label: t('nav.community') },
    { key: 'profile', label: t('nav.profile') },
  ];

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.header,
          {
            height: 56 + Math.max(insets.top, 0),
            paddingTop: Math.max(insets.top, 0),
          },
        ]}
      >
        <Text style={styles.brand}>Remus</Text>
        <TouchableOpacity
          accessibilityLabel={t('nav.settings')}
          accessibilityRole="button"
          onPress={onSettingsPress}
          style={styles.settingsMark}
        >
          <Text style={styles.settingsText}>☼</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.body}>{children}</View>

      {showNav ? (
        <View
          style={[
            styles.bottomNav,
            {
              height: 58 + Math.max(insets.bottom, 8),
              paddingBottom: Math.max(insets.bottom, 8),
            },
          ]}
        >
          {tabs.map(tab => {
            const isActive = tab.key === activeTab;
            return (
              <TouchableOpacity
                key={tab.key}
                onPress={() => onSelectTab?.(tab.key)}
                style={styles.navItem}
              >
                {isActive ? <View style={styles.activeIndicator} /> : null}
                <NavIcon name={tab.key} active={isActive} />
                <Text
                  style={[
                    styles.navLabel,
                    isActive && styles.navLabelActive,
                  ]}
                >
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: color.backgroundDefault,
    flex: 1,
  },
  header: {
    alignItems: 'center',
    backgroundColor: color.backgroundDefault,
    borderBottomColor: color.borderDefault,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
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
    borderRadius: 18,
    borderWidth: 2,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  settingsText: {
    color: color.actionPrimary,
    fontSize: 20,
  },
  body: {
    flex: 1,
  },
  bottomNav: {
    backgroundColor: color.surfaceDefault,
    borderTopColor: color.borderDefault,
    borderTopWidth: 1,
    flexDirection: 'row',
    paddingTop: 4,
  },
  navItem: {
    alignItems: 'center',
    flex: 1,
    gap: 3,
    justifyContent: 'center',
    position: 'relative',
  },
  navLabel: {
    color: color.textSecondary,
    fontFamily,
    fontSize: 11,
    fontWeight: '500',
  },
  navLabelActive: {
    color: color.actionPrimary,
    fontWeight: '700',
  },
  activeIndicator: {
    backgroundColor: color.actionPrimary,
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
    height: 3,
    position: 'absolute',
    top: -4,
    width: 36,
  },
});
