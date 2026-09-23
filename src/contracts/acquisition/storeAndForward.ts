import type {
  ArtifactManifestMessage,
  ArtifactPersistenceAcknowledgementMessage,
} from './types';

export function canDeleteSourceArtifact(
  manifestMessage: ArtifactManifestMessage,
  acknowledgementMessage: ArtifactPersistenceAcknowledgementMessage,
): boolean {
  const manifest = manifestMessage.payload;
  const acknowledgement = acknowledgementMessage.payload;

  return (
    manifest.finalized &&
    acknowledgement.persistenceStatus === 'persisted_verified' &&
    acknowledgement.persistedAtUtcMicroseconds !== undefined &&
    acknowledgement.artifactId === manifest.artifactId &&
    acknowledgement.recordingId === manifest.recordingId &&
    acknowledgement.byteLength === manifest.byteLength &&
    acknowledgement.contentSha256 === manifest.contentSha256
  );
}

