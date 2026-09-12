import SwiftUI

struct ContentView: View {
    @StateObject private var session = WatchSessionManager.shared
    @StateObject private var locationManager = WatchLocationManager()
    @StateObject private var sensorManager = WatchSensorManager()

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                // Header / Connection Status
                HStack {
                    Circle()
                        .fill(session.isReachable ? Color.green : Color.orange)
                        .frame(width: 8, height: 8)
                    Text(session.isReachable ? "Conectado" : "Buscando iPhone")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                    Spacer()
                }

                // Heart Rate Metric
                HStack {
                    Image(systemName: "heart.fill")
                        .foregroundColor(.red)
                    Text(sensorManager.heartRateBeatsPerMinute.map { String(Int($0)) } ?? "--")
                        .font(.system(size: 28, weight: .bold, design: .rounded))
                    Text("BPM")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                    Spacer()
                }
                .padding(6)
                .background(Color.white.opacity(0.1))
                .cornerRadius(8)

                // Location / Speed Metric
                HStack {
                    Image(systemName: "location.fill")
                        .foregroundColor(.blue)
                    VStack(alignment: .leading) {
                        Text(groundSpeedLabel)
                            .font(.headline)
                        Text(String(format: "Alt: %.0fm", locationManager.lastLocation?.altitude ?? 0))
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }
                    Spacer()
                }
                .padding(6)
                .background(Color.white.opacity(0.1))
                .cornerRadius(8)

                // Recording Action
                Button(action: {
                    session.isRecording.toggle()
                    if session.isRecording {
                        locationManager.startTracking()
                        sensorManager.startMotionTracking()
                        WatchSessionManager.shared.sendSensorPayload()
                    } else {
                        locationManager.stopTracking()
                        sensorManager.stopMotionTracking()
                    }
                }) {
                    HStack {
                        Image(systemName: session.isRecording ? "stop.fill" : "record.circle")
                        Text(session.isRecording ? "Parar" : "Gravar")
                            .fontWeight(.semibold)
                    }
                    .frame(maxWidth: .infinity)
                }
                .tint(session.isRecording ? .red : .green)
                .padding(.top, 4)
            }
            .padding(.horizontal, 4)
        }
        .onAppear {
            locationManager.requestPermissions()
            sensorManager.requestPermissions()
        }
    }

    private var groundSpeedLabel: String {
        guard let speed = locationManager.lastLocation?.speed, speed >= 0 else {
            return "-- km/h"
        }
        return String(format: "%.1f km/h", speed * 3.6)
    }
}
