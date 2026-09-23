# iPhone evidence recording vertical slice

Status: implemented for native iOS capture and live Apple Watch/RBP1 ingress

Date: 2026-09-13

## Responsibility

The iPhone is the persistence coordinator for an app-controlled activity. React
Native starts and stops the activity, but raw callbacks never cross JavaScript
before they are preserved. `RemusEvidenceStore` owns a serial append path under
Application Support:

```text
remus-recorder/evidence/activity-<uuid>/
  manifest.json
  lifecycle.ndjson
  phone-motion.ndjson
  phone-location.ndjson
  watch-heart-rate.ndjson
  remus-blade-live.ndjson
```

Each activity has one `activityId`, one opaque `activityCorrelationId` and a
distinct `recordingId` for every potential source. A source that is offline is
not presented as capturing, but data that legitimately arrives after the
activity starts still retains its preallocated source recording identity.

## Recorded streams

- iPhone `CMDeviceMotion` at a requested 100 Hz: acceleration including
  gravity, user acceleration, gravity, rotation rate, attitude and quaternion;
- iPhone `CLLocation` at native callback cadence: source and receipt times,
  WGS84 position, accuracy, altitude, speed and course when available;
- every unique Apple Watch heart-rate observation received by the iPhone,
  retaining the watch measurement time, phone receipt time, message identity
  and sequence;
- every RBP1 live BLE notification, preserving the complete producer CSV text,
  peripheral identity and phone receipt time.

Missing values remain absent. Duplicate Watch delivery with the same
`messageId` is not appended twice. RBP1 CSV is preserved before later parsing so
producer evidence is not lost when the canonical adapter evolves.

## Durability and finalization

The store serializes writes outside React Native, synchronizes all open parts
every 500 appends and again at stop, closes the parts, calculates SHA-256 and
atomically replaces `manifest.json` with `status: finalized`. The manifest
contains source recording identities, byte lengths, hashes and per-stream
sample counts. On a subsequent process start, a manifest left as `recording` is
marked `interrupted` rather than being presented as completed.

This is the first real persistence slice. NDJSON is an inspectable v1 evidence
part format, not the final high-rate cross-platform codec. Moving its framing
and catalog semantics into the shared C++ core must preserve the original files
and lineage rather than rewriting previously captured evidence.

## RBP1 200 Hz boundary

The current BLE characteristic publishes a lower-rate live snapshot. Every
snapshot received during the activity is recorded, but it is not the complete
200 Hz RBP1 acquisition. The RBP1 must retain its own raw high-rate artifact.
A later store-and-forward implementation will:

1. discover the immutable RBP1 artifact and manifest;
2. transfer resumable chunks without blocking current live acquisition;
3. verify lengths and hashes on the iPhone;
4. associate the RBP1 recording, wholly or over a bounded interval, without
   rewriting source timestamps;
5. authorize deletion on the Blade only after verified durable persistence.

Until that protocol exists, the UI must not claim that the 200 Hz RBP1 artifact
has synchronized merely because live BLE snapshots were received.

## Current platform boundary

This implementation centralizes evidence on iPhone for iPhone sensors, Apple
Watch heart rate and RBP1 BLE. Wear OS Data Layer terminates on an Android
companion and cannot use this iPhone-native store directly. Android durable
recording requires the equivalent host writer or a qualified cross-device relay
in a separate slice.
