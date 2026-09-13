import SwiftUI

struct ContentView: View {
    @StateObject private var session = WatchSessionManager.shared
    @StateObject private var sensorManager = WatchSensorManager()

    var body: some View {
        VStack(spacing: 12) {
            HStack(spacing: 6) {
                Circle()
                    .fill(session.isReachable ? Color.green : Color.orange)
                    .frame(width: 8, height: 8)
                Text(session.isReachable ? "iPhone conectado" : "Sincronização pendente")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            VStack(spacing: 2) {
                Image(systemName: "heart.fill")
                    .foregroundStyle(.red)
                Text(sensorManager.heartRateBeatsPerMinute.map { String(Int($0.rounded())) } ?? "--")
                    .font(.system(size: 34, weight: .bold, design: .rounded))
                Text("BPM")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            Text(sensorStatus)
                .font(.caption2)
                .multilineTextAlignment(.center)
                .foregroundStyle(isPermissionBlocked ? Color.orange : Color.secondary)

            Button(actionLabel) {
                if isPermissionBlocked {
                    sensorManager.requestPermissions()
                } else {
                    session.setRecording(!session.isRecording)
                }
            }
            .tint(session.isRecording ? .red : .green)
        }
        .padding()
        .onAppear {
            sensorManager.requestPermissions()
            session.recordingCommandHandler = { shouldRecord in
                if shouldRecord {
                    sensorManager.startHeartRateCapture()
                } else {
                    sensorManager.stopHeartRateCapture()
                }
            }
        }
    }

    private var isPermissionBlocked: Bool {
        if case .unavailable = sensorManager.state { return true }
        return false
    }

    private var actionLabel: String {
        if isPermissionBlocked { return "Revisar acesso" }
        return session.isRecording ? "Parar" : "Iniciar"
    }

    private var sensorStatus: String {
        switch sensorManager.state {
        case .idle: return "Pronto para medir"
        case .requestingPermission: return "Aguardando permissão"
        case .recording: return "Coletando no Apple Watch"
        case .unavailable(let message): return message
        }
    }
}
