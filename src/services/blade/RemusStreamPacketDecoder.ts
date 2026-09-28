import { Buffer } from 'buffer';

export interface DecodedRawImuSample {
  sampleSequence: number;
  nativeTimestampUs: number;
  rawAccel: { x: number; y: number; z: number };
  rawGyro: { x: number; y: number; z: number };
  status: number;
}

export interface DecodedImuBatch {
  batchSequence: number;
  samples: DecodedRawImuSample[];
}

export interface DecodedRelayedImuBatch {
  sourceIdentityHash: number;
  computerReceivedAtMs: number;
  batch: DecodedImuBatch;
}

export interface TelemetryAccounting {
  transportNotificationCount: number;
  decodedBatchCount: number;
  decodedImuSampleCount: number;
  invalidNotificationCount: number;
  pendingFragmentCount: number;
  accelSaturationCountX: number;
  accelSaturationCountY: number;
  accelSaturationCountZ: number;
  gyroSaturationCountX: number;
  gyroSaturationCountY: number;
  gyroSaturationCountZ: number;
  samplesWithAnySaturationCount: number;
  samplesWithAnySaturationPercent: number;
  lostPackets: number;
  lostSamples: number;
  duplicatedPackets: number;
  outOfOrderPackets: number;
  maxSampleGapMs: number;
}

interface FragmentAccumulator {
  fragmentCount: number;
  fragments: Array<Buffer | undefined>;
}

const crc32 = (data: Uint8Array): number => {
  /* eslint-disable no-bitwise -- CRC32 is defined in terms of bit operations. */
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  const result = (~crc) >>> 0;
  /* eslint-enable no-bitwise */
  return result;
};

export class RemusStreamPacketDecoder {
  private readonly fragments = new Map<number, FragmentAccumulator>();
  private transportNotificationCount = 0;
  private decodedBatchCount = 0;
  private decodedImuSampleCount = 0;
  private invalidNotificationCount = 0;
  private readonly saturationCounts = [0, 0, 0, 0, 0, 0];
  private samplesWithAnySaturationCount = 0;
  private expectedBatchSequence: number | null = null;
  private expectedSampleSequence: number | null = null;
  private previousSampleSequence: number | null = null;
  private previousSampleTimestampUs: number | null = null;
  private lostPackets = 0;
  private lostSamples = 0;
  private duplicatedPackets = 0;
  private outOfOrderPackets = 0;
  private maxSampleGapUs = 0;

  beginRecording(): void {
    this.fragments.clear();
    this.transportNotificationCount = 0;
    this.decodedBatchCount = 0;
    this.decodedImuSampleCount = 0;
    this.invalidNotificationCount = 0;
    this.saturationCounts.fill(0);
    this.samplesWithAnySaturationCount = 0;
    this.expectedBatchSequence = null;
    this.expectedSampleSequence = null;
    this.previousSampleSequence = null;
    this.previousSampleTimestampUs = null;
    this.lostPackets = 0;
    this.lostSamples = 0;
    this.duplicatedPackets = 0;
    this.outOfOrderPackets = 0;
    this.maxSampleGapUs = 0;
  }

  getAccounting(): TelemetryAccounting {
    return {
      transportNotificationCount: this.transportNotificationCount,
      decodedBatchCount: this.decodedBatchCount,
      decodedImuSampleCount: this.decodedImuSampleCount,
      invalidNotificationCount: this.invalidNotificationCount,
      pendingFragmentCount: this.fragments.size,
      accelSaturationCountX: this.saturationCounts[0],
      accelSaturationCountY: this.saturationCounts[1],
      accelSaturationCountZ: this.saturationCounts[2],
      gyroSaturationCountX: this.saturationCounts[3],
      gyroSaturationCountY: this.saturationCounts[4],
      gyroSaturationCountZ: this.saturationCounts[5],
      samplesWithAnySaturationCount: this.samplesWithAnySaturationCount,
      samplesWithAnySaturationPercent: this.decodedImuSampleCount === 0
        ? 0
        : this.samplesWithAnySaturationCount / this.decodedImuSampleCount * 100,
      lostPackets: this.lostPackets,
      lostSamples: this.lostSamples,
      duplicatedPackets: this.duplicatedPackets,
      outOfOrderPackets: this.outOfOrderPackets,
      maxSampleGapMs: this.maxSampleGapUs / 1000,
    };
  }

  ingestBase64(rawBase64: string): DecodedImuBatch | null {
    if (!rawBase64) return null;
    return this.ingest(Buffer.from(rawBase64, 'base64'));
  }

  ingest(data: Uint8Array): DecodedImuBatch | null {
    this.transportNotificationCount += 1;
    if (data.length < 2 || data[0] !== 1) return this.invalid();
    if (data[1] === 0x11) return this.ingestFragment(data);
    if (data[1] !== 0x01) return this.invalid();
    const batch = this.decodeBatch(data);
    return batch ?? this.invalid();
  }

  private invalid(): null {
    this.invalidNotificationCount += 1;
    return null;
  }

  private ingestFragment(data: Uint8Array): DecodedImuBatch | null {
    if (data.length < 9) return this.invalid();
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const batchSequence = view.getUint32(2, true);
    const fragmentIndex = data[6];
    const fragmentCount = data[7];
    const payloadLength = data[8];
    if (
      fragmentCount === 0 ||
      fragmentIndex >= fragmentCount ||
      data.length !== 9 + payloadLength
    ) return this.invalid();

    const existing = this.fragments.get(batchSequence);
    const accumulator = existing?.fragmentCount === fragmentCount
      ? existing
      : { fragmentCount, fragments: new Array<Buffer | undefined>(fragmentCount) };
    accumulator.fragments[fragmentIndex] = Buffer.from(data.subarray(9));
    this.fragments.set(batchSequence, accumulator);
    if (accumulator.fragments.filter(fragment => fragment !== undefined).length !== fragmentCount) {
      return null;
    }

    this.fragments.delete(batchSequence);
    const batch = this.decodeBatch(Buffer.concat(accumulator.fragments as Buffer[]));
    return batch ?? this.invalid();
  }

  private decodeBatch(data: Uint8Array): DecodedImuBatch | null {
    if (data.length < 27 || data[0] !== 1 || data[1] !== 0x01) return null;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const headerLength = data[3];
    const sampleCount = data[22];
    const bytesPerSample = 15;
    const expectedLength = headerLength + sampleCount * bytesPerSample + 4;
    if (headerLength !== 23 || sampleCount === 0 || data.length !== expectedLength) return null;

    const expectedCrc = view.getUint32(data.length - 4, true);
    if (crc32(data.subarray(0, data.length - 4)) !== expectedCrc) return null;

    const batchSequence = view.getUint32(4, true);
    const firstSampleSequence = view.getUint32(8, true);
    const firstTimestampUs = Number(view.getBigUint64(12, true));
    const nominalPeriodUs = view.getUint16(20, true);
    if (this.expectedBatchSequence !== null) {
      if (batchSequence > this.expectedBatchSequence) {
        this.lostPackets += batchSequence - this.expectedBatchSequence;
      } else if (batchSequence === this.expectedBatchSequence - 1) {
        this.duplicatedPackets += 1;
      } else if (batchSequence < this.expectedBatchSequence) {
        this.outOfOrderPackets += 1;
      }
    }
    this.expectedBatchSequence = Math.max(this.expectedBatchSequence ?? 0, batchSequence + 1);
    if (this.expectedSampleSequence !== null && firstSampleSequence > this.expectedSampleSequence) {
      this.lostSamples += firstSampleSequence - this.expectedSampleSequence;
    }
    const samples: DecodedRawImuSample[] = [];
    let offset = headerLength;
    for (let index = 0; index < sampleCount; index += 1) {
      const rawAccel = {
        x: view.getInt16(offset, true),
        y: view.getInt16(offset + 2, true),
        z: view.getInt16(offset + 4, true),
      };
      const rawGyro = {
        x: view.getInt16(offset + 6, true),
        y: view.getInt16(offset + 8, true),
        z: view.getInt16(offset + 10, true),
      };
      const jitterUs = view.getInt16(offset + 12, true);
      const status = view.getUint8(offset + 14);
      const sampleSequence = firstSampleSequence + index;
      const sampleTimestampUs = firstTimestampUs + index * nominalPeriodUs + jitterUs;
      if (
        this.previousSampleTimestampUs !== null &&
        this.previousSampleSequence !== null &&
        sampleSequence === this.previousSampleSequence + 1
      ) {
        this.maxSampleGapUs = Math.max(this.maxSampleGapUs, sampleTimestampUs - this.previousSampleTimestampUs);
      }
      this.previousSampleSequence = sampleSequence;
      this.previousSampleTimestampUs = sampleTimestampUs;
      const axes = [rawAccel.x, rawAccel.y, rawAccel.z, rawGyro.x, rawGyro.y, rawGyro.z];
      let sampleSaturated = false;
      axes.forEach((value, axis) => {
        if (value === 32767 || value === -32768) {
          this.saturationCounts[axis] += 1;
          sampleSaturated = true;
        }
      });
      if (sampleSaturated) this.samplesWithAnySaturationCount += 1;
      samples.push({
        sampleSequence,
        nativeTimestampUs: sampleTimestampUs,
        rawAccel,
        rawGyro,
        status,
      });
      offset += bytesPerSample;
    }
    this.decodedBatchCount += 1;
    this.decodedImuSampleCount += samples.length;
    this.expectedSampleSequence = Math.max(
      this.expectedSampleSequence ?? 0,
      firstSampleSequence + sampleCount,
    );
    return { batchSequence, samples };
  }
}

export class RemusRelayedStreamPacketDecoder {
  private readonly fragments = new Map<string, FragmentAccumulator>();
  private readonly sourceDecoders = new Map<number, RemusStreamPacketDecoder>();

  beginRecording(): void {
    this.fragments.clear();
    this.sourceDecoders.clear();
  }

  ingestBase64(rawBase64: string): DecodedRelayedImuBatch | null {
    if (!rawBase64) return null;
    return this.ingest(Buffer.from(rawBase64, 'base64'));
  }

  ingest(data: Uint8Array): DecodedRelayedImuBatch | null {
    if (data.length < 2 || data[0] !== 1) return null;
    if (data[1] === 0x11) return this.ingestFragment(data);
    if (data[1] !== 0x21) return null;
    return this.decodeRelayedPacket(data);
  }

  private ingestFragment(data: Uint8Array): DecodedRelayedImuBatch | null {
    if (data.length < 9) return null;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const relaySequence = view.getUint32(2, true);
    const fragmentIndex = data[6];
    const fragmentCount = data[7];
    const payloadLength = data[8];
    if (
      fragmentCount === 0 ||
      fragmentIndex >= fragmentCount ||
      data.length !== 9 + payloadLength
    ) return null;
    const fragmentKey = `${relaySequence}:${fragmentCount}`;
    const existing = this.fragments.get(fragmentKey);
    const accumulator = (fragmentIndex === 0 || existing?.fragmentCount !== fragmentCount)
      ? { fragmentCount, fragments: new Array<Buffer | undefined>(fragmentCount) }
      : existing;
    accumulator.fragments[fragmentIndex] = Buffer.from(data.subarray(9));
    this.fragments.set(fragmentKey, accumulator);
    if (accumulator.fragments.filter(fragment => fragment !== undefined).length !== fragmentCount) {
      if (this.fragments.size > 64) {
        const oldestKey = this.fragments.keys().next().value;
        if (oldestKey !== undefined) this.fragments.delete(oldestKey);
      }
      return null;
    }
    this.fragments.delete(fragmentKey);
    return this.decodeRelayedPacket(Buffer.concat(accumulator.fragments as Buffer[]));
  }

  private decodeRelayedPacket(data: Uint8Array): DecodedRelayedImuBatch | null {
    const relayHeaderSize = 12;
    const relayCrcSize = 4;
    if (data.length < relayHeaderSize + relayCrcSize || data[0] !== 1 || data[1] !== 0x21) {
      return null;
    }
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const sourceIdentityHash = view.getUint32(2, true);
    const computerReceivedAtMs = view.getUint32(6, true);
    const payloadLength = view.getUint16(10, true);
    if (payloadLength === 0 || data.length !== relayHeaderSize + payloadLength + relayCrcSize) {
      return null;
    }
    const expectedCrc = view.getUint32(data.length - relayCrcSize, true);
    if (crc32(data.subarray(0, data.length - relayCrcSize)) !== expectedCrc) return null;
    let decoder = this.sourceDecoders.get(sourceIdentityHash);
    if (!decoder) {
      decoder = new RemusStreamPacketDecoder();
      this.sourceDecoders.set(sourceIdentityHash, decoder);
    }
    const batch = decoder.ingest(data.subarray(relayHeaderSize, relayHeaderSize + payloadLength));
    if (!batch) return null;
    return { sourceIdentityHash, computerReceivedAtMs, batch };
  }
}
