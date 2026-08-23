import {
  assertValidProjectionArtifact,
  explainProjectionArtifactValidation,
  projectCanonicalMemoryToDisclosureCardArtifact,
  PROJECTION_KINDS,
} from "../../canonical/projection-artifact.js";
import {
  deriveDisclosureAttestationBinding,
  DISCLOSURE_ATTESTATION_PROJECTION_ADAPTER_VERSION,
} from "./owner-attestation.js";

export const OWNER_DISCLOSURE_PROJECTION_SURFACE = "DISCLOSURE_CARD";
export const OWNER_DISCLOSURE_PROJECTION_ADAPTER_VERSION = DISCLOSURE_ATTESTATION_PROJECTION_ADAPTER_VERSION;

function projectionError(reason) {
  const error = new TypeError(`invalid owner disclosure projection: ${reason}`);
  error.reason = reason;
  return error;
}

/**
 * Builds the stable, Canonical-only projection used by Owner preview/assert.
 * No runtime candidate, retrieval evidence, or caller-supplied card fields are
 * accepted by this entry point.
 */
export function projectCanonicalMemoryToOwnerDisclosureCardArtifact(canonicalMemory) {
  const artifact = projectCanonicalMemoryToDisclosureCardArtifact(canonicalMemory);
  const validation = explainProjectionArtifactValidation(artifact, canonicalMemory);
  if (!validation.valid) throw projectionError(validation.reason);
  if (artifact.surface !== OWNER_DISCLOSURE_PROJECTION_SURFACE) {
    throw projectionError("owner_projection_surface_mismatch");
  }
  if (artifact.projection_kind !== PROJECTION_KINDS.DISCLOSURE_CARD) {
    throw projectionError("owner_projection_kind_mismatch");
  }
  if (artifact.provenance?.adapter !== OWNER_DISCLOSURE_PROJECTION_ADAPTER_VERSION) {
    throw projectionError("owner_projection_adapter_mismatch");
  }
  return assertValidProjectionArtifact(artifact, canonicalMemory);
}

export function buildOwnerDisclosurePreview(canonicalMemory) {
  const artifact = projectCanonicalMemoryToOwnerDisclosureCardArtifact(canonicalMemory);
  const binding = deriveDisclosureAttestationBinding(canonicalMemory, artifact);
  if (!binding.valid) throw projectionError(binding.reason);
  return {
    artifact,
    binding: binding.binding,
    projection_hash: binding.binding.projection_hash,
  };
}
