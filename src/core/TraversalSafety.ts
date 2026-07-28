import * as THREE from 'three';
import { GAME_CONFIG } from '../config/GameConfig';
import type { PlayerController } from '../player/PlayerController';

export type TraversalFailureReason =
  | 'non-finite-position'
  | 'outside-playable-envelope'
  | 'impossible-displacement';

export interface TraversalSafetySnapshot {
  readonly recoveryCount: number;
  readonly lastReason: TraversalFailureReason | null;
  readonly safeSampleCount: number;
  readonly armed: boolean;
}

const MAX_SAFE_SAMPLES = 12;
const SAFE_SAMPLE_INTERVAL = 0.22;
const REARM_DURATION = 0.85;
const RECOVERY_COOLDOWN = 1.75;
const IMPOSSIBLE_DISPLACEMENT = 17;

/**
 * Runtime guard rail for traversal failures that cannot be solved by collision tuning alone.
 *
 * It never nudges valid movement. It only reports clearly invalid coordinates, leaving the
 * Game/Progression layer to perform a screen-covered recovery. Safe samples are intentionally
 * delayed so recovery lands a short distance before the bad edge rather than on the exact frame
 * that caused the failure.
 */
export class TraversalSafety {
  private readonly previousPosition = new THREE.Vector3();
  private readonly currentPosition = new THREE.Vector3();
  private readonly safeSamples: THREE.Vector3[] = [];
  private sampleAccumulator = 0;
  private rearmRemaining = REARM_DURATION;
  private recoveryCooldown = 0;
  private initialized = false;
  private recoveryCount = 0;
  private lastReason: TraversalFailureReason | null = null;

  reset(position: THREE.Vector3): void {
    this.previousPosition.copy(position);
    this.safeSamples.length = 0;
    if (isFiniteVector(position) && isInsidePlayableEnvelope(position)) {
      this.safeSamples.push(position.clone());
    }
    this.sampleAccumulator = 0;
    this.rearmRemaining = REARM_DURATION;
    this.recoveryCooldown = 0;
    this.initialized = true;
  }

  update(delta: number, player: PlayerController): TraversalFailureReason | null {
    player.getWorldPosition(this.currentPosition);
    if (!this.initialized) this.reset(this.currentPosition);
    this.rearmRemaining = Math.max(0, this.rearmRemaining - delta);
    this.recoveryCooldown = Math.max(0, this.recoveryCooldown - delta);

    const reason = this.detectFailure();
    if (reason && this.recoveryCooldown <= 0 && this.rearmRemaining <= 0 && !player.isDead()) {
      this.lastReason = reason;
      this.recoveryCount += 1;
      this.recoveryCooldown = RECOVERY_COOLDOWN;
      this.rearmRemaining = REARM_DURATION;
      this.previousPosition.copy(this.currentPosition);
      return reason;
    }

    this.sampleAccumulator += delta;
    if (this.sampleAccumulator >= SAFE_SAMPLE_INTERVAL) {
      this.sampleAccumulator %= SAFE_SAMPLE_INTERVAL;
      if (this.isSafeSample(player)) {
        this.safeSamples.push(this.currentPosition.clone());
        if (this.safeSamples.length > MAX_SAFE_SAMPLES) this.safeSamples.shift();
      }
    }
    this.previousPosition.copy(this.currentPosition);
    return null;
  }

  hasRecoverySample(): boolean {
    return this.safeSamples.length > 0;
  }

  getRecoveryPosition(fallback: THREE.Vector3): THREE.Vector3 {
    // Use an older sample so the character does not return to the lip of a fall or the face of a wall.
    const sampleIndex = Math.max(0, this.safeSamples.length - 4);
    const sample = this.safeSamples[sampleIndex];
    const recovery = sample?.clone() ?? fallback.clone();
    recovery.y += 0.12;
    return recovery;
  }

  recordRecovery(position: THREE.Vector3, reason: TraversalFailureReason | null): void {
    if (reason) this.lastReason = reason;
    this.reset(position);
    this.recoveryCooldown = RECOVERY_COOLDOWN;
  }

  getSnapshot(): TraversalSafetySnapshot {
    return {
      recoveryCount: this.recoveryCount,
      lastReason: this.lastReason,
      safeSampleCount: this.safeSamples.length,
      armed: this.initialized && this.rearmRemaining <= 0,
    };
  }

  private detectFailure(): TraversalFailureReason | null {
    if (!isFiniteVector(this.currentPosition)) return 'non-finite-position';
    if (!isInsidePlayableEnvelope(this.currentPosition)) return 'outside-playable-envelope';
    if (this.previousPosition.distanceToSquared(this.currentPosition) > IMPOSSIBLE_DISPLACEMENT ** 2) {
      return 'impossible-displacement';
    }
    return null;
  }

  private isSafeSample(player: PlayerController): boolean {
    if (!player.isGrounded() || player.isDead()) return false;
    if (!isFiniteVector(this.currentPosition) || !isInsidePlayableEnvelope(this.currentPosition)) return false;
    if (this.currentPosition.y < GAME_CONFIG.world.safety.minimumSafeY) return false;
    return player.getSpeed() <= GAME_CONFIG.world.safety.maximumSampleSpeed;
  }
}

export function isInsidePlayableEnvelope(position: THREE.Vector3): boolean {
  const envelope = GAME_CONFIG.world.safety;
  return position.x >= envelope.minimumX
    && position.x <= envelope.maximumX
    && position.y >= envelope.minimumY
    && position.y <= envelope.maximumY
    && position.z >= envelope.minimumZ
    && position.z <= envelope.maximumZ;
}

function isFiniteVector(position: THREE.Vector3): boolean {
  return Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z);
}
