/**
 * @nexus/kafka — RIDE & GO
 *
 * Topic catalog and helper for the RIDE & GO event bus. Every domain
 * event the rides service emits or consumes flows through here.
 *
 * Topics use the `rides.*` domain prefix per the existing
 * KafkaTopics convention in @nexus/types. Consumers can subscribe to
 * a single topic or group of topics.
 *
 * Each topic declares the event payload shape (re-exported from
 * @nexus/types/ride) so consumers get strong typing when filtering.
 */

import type {
  RideRequestedEvent,
  RideMatchedEvent,
  RideAcceptedEvent,
  RideStartedEvent,
  RideCompletedEvent,
  RideCancelledEvent,
  DriverLocationEvent,
  DriverAvailabilityEvent,
  SosTriggeredEvent,
  IncidentReportedEvent,
  PaymentCapturedEvent,
  MaintenanceLoggedEvent,
  VehicleScanCompletedEvent,
  CuratorPointsEarnedEvent,
} from '@nexus/types/ride';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Topic catalog — keep in alphabetical order for diff-friendliness.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const RIDE_TOPICS = {
  RIDE_REQUESTED: 'rides.ride.requested',
  RIDE_MATCHED: 'rides.ride.matched',
  RIDE_ACCEPTED: 'rides.ride.accepted',
  RIDE_DRIVER_ENROUTE: 'rides.ride.driver_enroute',
  RIDE_DRIVER_ARRIVED: 'rides.ride.driver_arrived',
  RIDE_STARTED: 'rides.ride.started',
  RIDE_COMPLETED: 'rides.ride.completed',
  RIDE_CANCELLED: 'rides.ride.cancelled',
  RIDE_RATED: 'rides.ride.rated',
  RIDE_DISPUTED: 'rides.ride.disputed',
  POOL_DETECTED: 'rides.pool.detected',
  POOL_DISPATCHED: 'rides.pool.dispatched',
  POOL_COMPLETED: 'rides.pool.completed',
  DRIVER_LOCATION_UPDATED: 'rides.driver.location_updated',
  DRIVER_AVAILABILITY_CHANGED: 'rides.driver.availability_changed',
  DRIVER_REGISTERED: 'rides.driver.registered',
  DRIVER_VERIFIED: 'rides.driver.verified',
  DRIVER_SUSPENDED: 'rides.driver.suspended',
  VEHICLE_REGISTERED: 'rides.vehicle.registered',
  VEHICLE_SCAN_COMPLETED: 'rides.vehicle.scan_completed',
  VEHICLE_IN_MAINTENANCE: 'rides.vehicle.in_maintenance',
  SOS_TRIGGERED: 'rides.sos.triggered',
  SOS_ACKNOWLEDGED: 'rides.sos.acknowledged',
  SOS_RESOLVED: 'rides.sos.resolved',
  INCIDENT_REPORTED: 'rides.incident.reported',
  INCIDENT_UPDATED: 'rides.incident.updated',
  INCIDENT_RESOLVED: 'rides.incident.resolved',
  PAYMENT_AUTHORIZED: 'rides.payment.authorized',
  PAYMENT_CAPTURED: 'rides.payment.captured',
  PAYMENT_FAILED: 'rides.payment.failed',
  PAYMENT_REFUNDED: 'rides.payment.refunded',
  COD_VERIFICATION_REQUESTED: 'rides.payment.cod_verification_requested',
  COD_VERIFICATION_COMPLETED: 'rides.payment.cod_verification_completed',
  MAINTENANCE_LOGGED: 'rides.maintenance.logged',
  MAINTENANCE_DUE_SOON: 'rides.maintenance.due_soon',
  DEPLOYMENT_CREATED: 'rides.deployment.created',
  DEPLOYMENT_STARTED: 'rides.deployment.started',
  DEPLOYMENT_COMPLETED: 'rides.deployment.completed',
  CURATOR_SHIFT_CHECKED_IN: 'rides.curator.shift_checked_in',
  CURATOR_POINTS_EARNED: 'rides.curator.points_earned',
  CURATOR_TIER_UPGRADED: 'rides.curator.tier_upgraded',
  LEADERBOARD_RECOMPUTED: 'rides.leaderboard.recomputed',
  SKIN_UNLOCKED: 'rides.skin.unlocked',
  SKIN_APPLIED: 'rides.skin.applied',
  REWARDS_UPDATED: 'rides.rewards.updated',
  HEATMAP_PREDICTED: 'rides.heatmap.predicted',
  AUDIT_LOG_APPENDED: 'rides.audit.appended',
} as const;

export type RideTopic = (typeof RIDE_TOPICS)[keyof typeof RIDE_TOPICS];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Event payload mapping — keep keys aligned with RIDE_TOPICS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface RideEventPayloadMap {
  [RIDE_TOPICS.RIDE_REQUESTED]: RideRequestedEvent;
  [RIDE_TOPICS.RIDE_MATCHED]: RideMatchedEvent;
  [RIDE_TOPICS.RIDE_ACCEPTED]: RideAcceptedEvent;
  [RIDE_TOPICS.RIDE_DRIVER_ENROUTE]: RideAcceptedEvent;
  [RIDE_TOPICS.RIDE_DRIVER_ARRIVED]: RideAcceptedEvent;
  [RIDE_TOPICS.RIDE_STARTED]: RideStartedEvent;
  [RIDE_TOPICS.RIDE_COMPLETED]: RideCompletedEvent;
  [RIDE_TOPICS.RIDE_CANCELLED]: RideCancelledEvent;
  [RIDE_TOPICS.SOS_TRIGGERED]: SosTriggeredEvent;
  [RIDE_TOPICS.INCIDENT_REPORTED]: IncidentReportedEvent;
  [RIDE_TOPICS.PAYMENT_CAPTURED]: PaymentCapturedEvent;
  [RIDE_TOPICS.MAINTENANCE_LOGGED]: MaintenanceLoggedEvent;
  [RIDE_TOPICS.VEHICLE_SCAN_COMPLETED]: VehicleScanCompletedEvent;
  [RIDE_TOPICS.CURATOR_POINTS_EARNED]: CuratorPointsEarnedEvent;
  [RIDE_TOPICS.DRIVER_LOCATION_UPDATED]: DriverLocationEvent;
  [RIDE_TOPICS.DRIVER_AVAILABILITY_CHANGED]: DriverAvailabilityEvent;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Topic groups for batch subscription
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const RIDE_RIDER_TOPICS: ReadonlyArray<RideTopic> = [
  RIDE_TOPICS.RIDE_REQUESTED,
  RIDE_TOPICS.RIDE_MATCHED,
  RIDE_TOPICS.RIDE_ACCEPTED,
  RIDE_TOPICS.RIDE_DRIVER_ENROUTE,
  RIDE_TOPICS.RIDE_DRIVER_ARRIVED,
  RIDE_TOPICS.RIDE_STARTED,
  RIDE_TOPICS.RIDE_COMPLETED,
  RIDE_TOPICS.RIDE_CANCELLED,
  RIDE_TOPICS.RIDE_RATED,
  RIDE_TOPICS.RIDE_DISPUTED,
];

export const RIDE_DRIVER_TOPICS: ReadonlyArray<RideTopic> = [
  RIDE_TOPICS.RIDE_REQUESTED,
  RIDE_TOPICS.RIDE_MATCHED,
  RIDE_TOPICS.RIDE_ACCEPTED,
  RIDE_TOPICS.RIDE_CANCELLED,
  RIDE_TOPICS.PAYMENT_CAPTURED,
  RIDE_TOPICS.SOS_TRIGGERED,
  RIDE_TOPICS.MAINTENANCE_DUE_SOON,
  RIDE_TOPICS.VEHICLE_IN_MAINTENANCE,
];

export const RIDE_OPS_TOPICS: ReadonlyArray<RideTopic> = [
  RIDE_TOPICS.DRIVER_REGISTERED,
  RIDE_TOPICS.DRIVER_VERIFIED,
  RIDE_TOPICS.DRIVER_SUSPENDED,
  RIDE_TOPICS.DRIVER_AVAILABILITY_CHANGED,
  RIDE_TOPICS.INCIDENT_REPORTED,
  RIDE_TOPICS.INCIDENT_UPDATED,
  RIDE_TOPICS.INCIDENT_RESOLVED,
  RIDE_TOPICS.DEPLOYMENT_CREATED,
  RIDE_TOPICS.DEPLOYMENT_STARTED,
  RIDE_TOPICS.DEPLOYMENT_COMPLETED,
  RIDE_TOPICS.LEADERBOARD_RECOMPUTED,
  RIDE_TOPICS.CURATOR_TIER_UPGRADED,
  RIDE_TOPICS.REWARDS_UPDATED,
  RIDE_TOPICS.AUDIT_LOG_APPENDED,
];

export const RIDE_FINANCE_TOPICS: ReadonlyArray<RideTopic> = [
  RIDE_TOPICS.PAYMENT_AUTHORIZED,
  RIDE_TOPICS.PAYMENT_CAPTURED,
  RIDE_TOPICS.PAYMENT_FAILED,
  RIDE_TOPICS.PAYMENT_REFUNDED,
  RIDE_TOPICS.COD_VERIFICATION_REQUESTED,
  RIDE_TOPICS.COD_VERIFICATION_COMPLETED,
];

export const RIDE_FLEET_TOPICS: ReadonlyArray<RideTopic> = [
  RIDE_TOPICS.VEHICLE_REGISTERED,
  RIDE_TOPICS.VEHICLE_SCAN_COMPLETED,
  RIDE_TOPICS.VEHICLE_IN_MAINTENANCE,
  RIDE_TOPICS.MAINTENANCE_LOGGED,
  RIDE_TOPICS.MAINTENANCE_DUE_SOON,
  RIDE_TOPICS.HEATMAP_PREDICTED,
];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Partition helpers — derive a stable key for ordering guarantees
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function rideTopicPartitionKey(rideId: string): string {
  return rideId;
}

export function driverTopicPartitionKey(driverId: string): string {
  return driverId;
}

export function campusTopicPartitionKey(campusId: string): string {
  return campusId;
}

export function paymentTopicPartitionKey(paymentId: string): string {
  return paymentId;
}

export function vehicleTopicPartitionKey(vehicleId: string): string {
  return vehicleId;
}

export function curatorTopicPartitionKey(curatorId: string): string {
  return curatorId;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Re-export helpers so callers don't need to import the parent module
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type {
  RideRequestedEvent,
  RideMatchedEvent,
  RideAcceptedEvent,
  RideStartedEvent,
  RideCompletedEvent,
  RideCancelledEvent,
  DriverLocationEvent,
  DriverAvailabilityEvent,
  SosTriggeredEvent,
  IncidentReportedEvent,
  PaymentCapturedEvent,
  MaintenanceLoggedEvent,
  VehicleScanCompletedEvent,
  CuratorPointsEarnedEvent,
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// publishRideEvent — typed wrapper around publishEvent
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Producer } from 'kafkajs';
import { publishEvent } from './index';

export async function publishRideEvent<T extends RideTopic>(
  producer: Producer,
  topic: T,
  payload: RideEventPayloadMap[T],
  correlationId?: string,
): Promise<void> {
  await publishEvent(producer, topic, payload, correlationId);
}