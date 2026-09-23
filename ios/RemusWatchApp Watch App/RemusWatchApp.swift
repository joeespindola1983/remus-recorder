import SwiftUI
import HealthKit

class WatchAppDelegate: NSObject, WKApplicationDelegate {
    func handle(_ workoutConfiguration: HKWorkoutConfiguration) {
        NSLog("[RemusWatchApp] WatchAppDelegate.handle(_ workoutConfiguration) called! ActivityType: \(workoutConfiguration.activityType.rawValue)")
        Task { @MainActor in
            NSLog("[RemusWatchApp] WatchAppDelegate requesting permissions and starting capture...")
            WatchSensorManager.shared.requestPermissions()
            WatchSensorManager.shared.startHeartRateCapture()
            WatchSessionManager.shared.setRecording(true)
        }
    }
}

@main
struct RemusWatchApp: App {
    @WKApplicationDelegateAdaptor(WatchAppDelegate.self) var appDelegate

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
