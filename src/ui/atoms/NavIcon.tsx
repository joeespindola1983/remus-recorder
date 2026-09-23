import React from 'react';
import { StyleSheet, View } from 'react-native';
import { color } from '../theme/tokens';

export type NavIconName = 'home' | 'activities' | 'community' | 'profile';

export function NavIcon({
  name,
  active,
}: {
  name: NavIconName;
  active: boolean;
}): React.JSX.Element {
  const tint = active ? color.actionPrimary : color.textSecondary;

  const renderIcon = () => {
    switch (name) {
      case 'home':
        return (
          <View style={styles.iconBox}>
            <View
              style={[
                styles.homeRoof,
                { borderBottomColor: tint },
              ]}
            />
            <View style={[styles.homeBase, { borderColor: tint }]}>
              <View style={[styles.homeDoor, { backgroundColor: tint }]} />
            </View>
          </View>
        );
      case 'activities':
        return (
          <View style={styles.iconBox}>
            <View style={[styles.activitiesFrame, { borderColor: tint }]}>
              <View style={[styles.activitiesTopBar, { backgroundColor: tint }]} />
              <View style={[styles.activitiesLine, { backgroundColor: tint }]} />
              <View style={[styles.activitiesLineShort, { backgroundColor: tint }]} />
            </View>
          </View>
        );
      case 'community':
        return (
          <View style={styles.iconBox}>
            <View style={styles.communityGroup}>
              {/* Primary user */}
              <View style={styles.communityPrimary}>
                <View style={[styles.userHead, { backgroundColor: tint }]} />
                <View style={[styles.userBody, { backgroundColor: tint }]} />
              </View>
              {/* Secondary user */}
              <View style={styles.communitySecondary}>
                <View style={[styles.userHeadSmall, { backgroundColor: tint }]} />
                <View style={[styles.userBodySmall, { backgroundColor: tint }]} />
              </View>
            </View>
          </View>
        );
      case 'profile':
        return (
          <View style={styles.iconBox}>
            <View style={[styles.profileHead, { backgroundColor: tint }]} />
            <View style={[styles.profileBody, { backgroundColor: tint }]} />
          </View>
        );
    }
  };

  return (
    <View
      accessibilityRole="image"
      style={styles.container}
      testID={`nav-icon-${name}`}
    >
      {renderIcon()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  iconBox: {
    alignItems: 'center',
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  // Home
  homeRoof: {
    borderBottomWidth: 7,
    borderLeftColor: 'transparent',
    borderLeftWidth: 9,
    borderRightColor: 'transparent',
    borderRightWidth: 9,
    borderStyle: 'solid',
    height: 0,
    width: 0,
  },
  homeBase: {
    alignItems: 'center',
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
    borderWidth: 1.5,
    height: 10,
    justifyContent: 'flex-end',
    width: 14,
  },
  homeDoor: {
    borderTopLeftRadius: 1,
    borderTopRightRadius: 1,
    height: 5,
    width: 4,
  },
  // Activities
  activitiesFrame: {
    borderRadius: 3,
    borderWidth: 1.5,
    height: 18,
    padding: 2,
    width: 16,
  },
  activitiesTopBar: {
    borderRadius: 1,
    height: 2,
    marginBottom: 3,
    width: '100%',
  },
  activitiesLine: {
    borderRadius: 1,
    height: 2,
    marginBottom: 2,
    width: '80%',
  },
  activitiesLineShort: {
    borderRadius: 1,
    height: 2,
    width: '50%',
  },
  // Community
  communityGroup: {
    flexDirection: 'row',
    height: 20,
    position: 'relative',
    width: 22,
  },
  communityPrimary: {
    alignItems: 'center',
    left: 1,
    position: 'absolute',
    top: 2,
  },
  communitySecondary: {
    alignItems: 'center',
    position: 'absolute',
    right: 1,
    top: 4,
  },
  userHead: {
    borderRadius: 3.5,
    height: 7,
    width: 7,
  },
  userBody: {
    borderTopLeftRadius: 5,
    borderTopRightRadius: 5,
    height: 6,
    marginTop: 1,
    width: 11,
  },
  userHeadSmall: {
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  userBodySmall: {
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    height: 5,
    marginTop: 1,
    width: 9,
  },
  // Profile
  profileHead: {
    borderRadius: 4,
    height: 8,
    marginBottom: 1,
    width: 8,
  },
  profileBody: {
    borderTopLeftRadius: 7,
    borderTopRightRadius: 7,
    height: 8,
    width: 15,
  },
});
