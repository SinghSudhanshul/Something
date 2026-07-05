/**
 * @nexus/types — RIDE & GO
 *
 * Cross-service type definitions for the NEXUS RIDE & GO subsystem.
 * Every DTO, enum, request/response payload, and Kafka event payload
 * needed by the rides service, web/admin/mobile clients, and the
 * downstream analytics / trust / wallet services is defined here.
 *
 * No type duplication. If a service needs a ride-related type, it
 * imports from `@nexus/types/ride`. The Go services mirror these
 * shapes through generated swagger + the matching struct tags.
 */

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Section 1 — Enums
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const RideStatus = {
  REQUESTED: 'requested',
  MATCHING: 'matching',
  OFFERED: 'offered',
  ACCEPTED: 'accepted',
  DRIVER_ENROUTE: 'driver_enroute',
  ARRIVED: 'arrived',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED_BY_RIDER: 'cancelled_by_rider',
  CANCELLED_BY_DRIVER: 'cancelled_by_driver',
  CANCELLED_BY_SYSTEM: 'cancelled_by_system',
  NO_DRIVERS: 'no_drivers',
  EXPIRED: 'expired',
  DISPUTED: 'disputed',
} as const;
export type RideStatus = (typeof RideStatus)[keyof typeof RideStatus];

export const RIDE_STATUSES_ACTIVE: ReadonlyArray<RideStatus> = [
  RideStatus.REQUESTED,
  RideStatus.MATCHING,
  RideStatus.OFFERED,
  RideStatus.ACCEPTED,
  RideStatus.DRIVER_ENROUTE,
  RideStatus.ARRIVED,
  RideStatus.IN_PROGRESS,
  RideStatus.DISPUTED,
];

export const RIDE_STATUSES_TERMINAL: ReadonlyArray<RideStatus> = [
  RideStatus.COMPLETED,
  RideStatus.CANCELLED_BY_RIDER,
  RideStatus.CANCELLED_BY_DRIVER,
  RideStatus.CANCELLED_BY_SYSTEM,
  RideStatus.NO_DRIVERS,
  RideStatus.EXPIRED,
];

export const RideType = {
  SOLO: 'solo',
  POOL: 'pool',
  WOMEN_ONLY: 'women_only',
  LUGGAGE: 'luggage',
  PREMIUM: 'premium',
  ACCESSIBILITY: 'accessibility',
} as const;
export type RideType = (typeof RideType)[keyof typeof RideType];

export const VehicleType = {
  BICYCLE: 'bicycle',
  ELECTRIC_SCOOTER: 'electric_scooter',
  MOTORCYCLE: 'motorcycle',
  AUTO: 'auto',
  MINI: 'mini',
  SEDAN: 'sedan',
  SUV: 'suv',
  PREMIUM: 'premium',
  VAN: 'van',
} as const;
export type VehicleType = (typeof VehicleType)[keyof typeof VehicleType];

export const DriverStatus = {
  OFFLINE: 'offline',
  ONLINE: 'online',
  ON_BREAK: 'on_break',
  ENROUTE_TO_PICKUP: 'enroute_to_pickup',
  ARRIVED_AT_PICKUP: 'arrived_at_pickup',
  ON_TRIP: 'on_trip',
  SUSPENDED: 'suspended',
  BANNED: 'banned',
} as const;
export type DriverStatus = (typeof DriverStatus)[keyof typeof DriverStatus];

export const VehicleStatus = {
  ACTIVE: 'active',
  MAINTENANCE: 'maintenance',
  RETIRED: 'retired',
  IMPOUNDED: 'impounded',
  INSPECTION_DUE: 'inspection_due',
} as const;
export type VehicleStatus = (typeof VehicleStatus)[keyof typeof VehicleStatus];

export const PoolStatus = {
  OPEN: 'open',
  FILLING: 'filling',
  MATCHED: 'matched',
  DISPATCHED: 'dispatched',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
} as const;
export type PoolStatus = (typeof PoolStatus)[keyof typeof PoolStatus];

export const SosStatus = {
  TRIGGERED: 'triggered',
  ACKNOWLEDGED: 'acknowledged',
  RESOLVED: 'resolved',
  FALSE_ALARM: 'false_alarm',
  ESCALATED: 'escalated',
} as const;
export type SosStatus = (typeof SosStatus)[keyof typeof SosStatus];

export const IncidentStatus = {
  REPORTED: 'reported',
  INVESTIGATING: 'investigating',
  AWAITING_EVIDENCE: 'awaiting_evidence',
  RESOLVED: 'resolved',
  REJECTED: 'rejected',
  ESCALATED_TO_LEGAL: 'escalated_to_legal',
} as const;
export type IncidentStatus = (typeof IncidentStatus)[keyof typeof IncidentStatus];

export const IncidentSeverity = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
} as const;
export type IncidentSeverity = (typeof IncidentSeverity)[keyof typeof IncidentSeverity];

export const PaymentStatus = {
  PENDING: 'pending',
  AUTHORIZED: 'authorized',
  CAPTURED: 'captured',
  REFUNDED: 'refunded',
  PARTIAL_REFUND: 'partial_refund',
  FAILED: 'failed',
  COD_PENDING: 'cod_pending',
  COD_COLLECTED: 'cod_collected',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const PaymentMethod = {
  WALLET: 'wallet',
  UPI: 'upi',
  CARD: 'card',
  NETBANKING: 'netbanking',
  COD: 'cod',
  CAMPUS_PASS: 'campus_pass',
} as const;
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

export const CodVerificationStatus = {
  PENDING: 'pending',
  OTP_SENT: 'otp_sent',
  VERIFIED: 'verified',
  FAILED: 'failed',
  EXPIRED: 'expired',
} as const;
export type CodVerificationStatus =
  (typeof CodVerificationStatus)[keyof typeof CodVerificationStatus];

export const CuratorShiftStatus = {
  SCHEDULED: 'scheduled',
  CHECKED_IN: 'checked_in',
  ON_BREAK: 'on_break',
  COMPLETED: 'completed',
  MISSED: 'missed',
  CANCELLED: 'cancelled',
} as const;
export type CuratorShiftStatus = (typeof CuratorShiftStatus)[keyof typeof CuratorShiftStatus];

export const CuratorTier = {
  BRONZE: 'bronze',
  SILVER: 'silver',
  GOLD: 'gold',
  PLATINUM: 'platinum',
  ELITE: 'elite',
} as const;
export type CuratorTier = (typeof CuratorTier)[keyof typeof CuratorTier];

export const MaintenanceType = {
  ROUTINE: 'routine',
  REPAIR: 'repair',
  INSPECTION: 'inspection',
  BATTERY_SWAP: 'battery_swap',
  TIRE_CHANGE: 'tire_change',
  OIL_CHANGE: 'oil_change',
  DETAILING: 'detailing',
  RECALL: 'recall',
} as const;
export type MaintenanceType = (typeof MaintenanceType)[keyof typeof MaintenanceType];

export const SkinRarity = {
  COMMON: 'common',
  RARE: 'rare',
  EPIC: 'epic',
  LEGENDARY: 'legendary',
  MYTHIC: 'mythic',
} as const;
export type SkinRarity = (typeof SkinRarity)[keyof typeof SkinRarity];

export const DeploymentStatus = {
  PLANNED: 'planned',
  ACTIVE: 'active',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  ROLLED_BACK: 'rolled_back',
} as const;
export type DeploymentStatus = (typeof DeploymentStatus)[keyof typeof DeploymentStatus];

export const TripPhase = {
  IDLE: 'idle',
  MATCHING: 'matching',
  PICKUP: 'pickup',
  TRANSIT: 'transit',
  DROPOFF: 'dropoff',
  WRAP_UP: 'wrap_up',
} as const;
export type TripPhase = (typeof TripPhase)[keyof typeof TripPhase];

// ─── Trip Phase Transition Matrix (driven by state machine) ────────────

export const TRIP_PHASE_TRANSITIONS: Record<TripPhase, ReadonlyArray<TripPhase>> = {
  [TripPhase.IDLE]: [TripPhase.MATCHING],
  [TripPhase.MATCHING]: [TripPhase.PICKUP, TripPhase.IDLE],
  [TripPhase.PICKUP]: [TripPhase.TRANSIT, TripPhase.IDLE],
  [TripPhase.TRANSIT]: [TripPhase.DROPOFF],
  [TripPhase.DROPOFF]: [TripPhase.WRAP_UP],
  [TripPhase.WRAP_UP]: [TripPhase.IDLE],
};

// ─── Matching Radii (meters) used by the expanding-radius algorithm ───

export const MATCHING_RADII_METERS: ReadonlyArray<number> = [500, 1000, 2000, 5000];
export const MATCHING_TIMEOUT_MS = 5 * 60 * 1000;
export const MATCHING_OFFER_TTL_SECONDS = 35;
export const MATCHING_MAX_OFFERS = 3;
export const RIDE_OFFER_DEADLINE_SECONDS = 30;

// ─── Fare Defaults (mirrors services/rides/internal/ride/fare.go) ─────

export interface FareConfig {
  baseFare: number;
  perKmRate: number;
  perMinRate: number;
  minFare: number;
  maxFare: number;
  poolDiscount: number;
  nightSurcharge: number;
  waitingFeePerMin: number;
  platformFee: number;
  gstPct: number;
  surgeCeiling: number;
}

export const DEFAULT_FARE_CONFIG: FareConfig = {
  baseFare: 10,
  perKmRate: 8,
  perMinRate: 1,
  minFare: 15,
  maxFare: 100,
  poolDiscount: 0.3,
  nightSurcharge: 1.25,
  waitingFeePerMin: 2,
  platformFee: 5,
  gstPct: 5,
  surgeCeiling: 2.5,
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Section 2 — Core Domain Entities
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Address {
  label: string;
  address?: string;
  lat: number;
  lng: number;
  building?: string;
  floor?: string;
  icon?: string;
}

export interface DriverLocation {
  driverId: string;
  lat: number;
  lng: number;
  bearing?: number;
  speedKph?: number;
  accuracyM?: number;
  batteryPct?: number;
  status: DriverStatus;
  recordedAt: string;
}

export interface RideDriver {
  id: string;
  userId: string;
  campusId: string;
  licenseNumber: string;
  licenseExpiry?: string;
  isVerified: boolean;
  isWomenOnly: boolean;
  isPremiumEligible: boolean;
  isAccessibilityTrained: boolean;
  trustScore: number;
  acceptanceRate: number;
  cancellationRate: number;
  completedTrips: number;
  totalEarnings: number;
  rating: number;
  ratingCount: number;
  status: DriverStatus;
  currentLocation?: LatLng;
  preferredZoneId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RideVehicle {
  id: string;
  driverId: string;
  campusId: string;
  vehicleType: VehicleType;
  make?: string;
  model?: string;
  year?: number;
  color?: string;
  licensePlate: string;
  seatingCapacity: number;
  luggageCapacity: number;
  isElectric: boolean;
  batteryKwh?: number;
  rangeKm?: number;
  skinId?: string;
  odometerKm: number;
  status: VehicleStatus;
  lastInspectionAt?: string;
  nextInspectionDue?: string;
}

export interface RideRequest {
  id: string;
  riderId: string;
  campusId: string;
  driverId?: string;
  vehicleId?: string;
  poolId?: string;
  rideType: RideType;
  status: RideStatus;
  pickup: Address;
  dropoff: Address;
  distanceMeters: number;
  estimatedDurationSec: number;
  actualDurationSec?: number;
  passengerCount: number;
  luggageCount: number;
  isWomenOnly: boolean;
  accessibilityNeeds?: Array<{ type: string; note?: string }>;
  couponCode?: string;
  scheduledAt?: string;
  acceptedAt?: string;
  arrivedAt?: string;
  startedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
  estimatedFare: number;
  finalFare?: number;
  surgeMultiplier: number;
  tip: number;
  paymentMethod: PaymentMethod;
  promoDiscount: number;
  campusCoinDiscount: number;
  waitingSec: number;
  polyline?: string;
  ratingByRider?: number;
  ratingByDriver?: number;
  notes?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface RideTrackingPoint {
  rideId: string;
  driverId?: string;
  lat: number;
  lng: number;
  bearing?: number;
  speedKph?: number;
  accuracyM?: number;
  phase: TripPhase;
  batteryPct?: number;
  recordedAt: string;
}

export interface RidePool {
  id: string;
  campusId: string;
  driverId?: string;
  vehicleId?: string;
  status: PoolStatus;
  origin: Address;
  destination: Address;
  capacity: number;
  seatsTaken: number;
  discountPct: number;
  detectedAt: string;
  dispatchedAt?: string;
  completedAt?: string;
}

export interface RidePoolMember {
  poolId: string;
  rideId: string;
  riderId: string;
  joinOrder: number;
  fareShare: number;
  pickedUpAt?: string;
  droppedOffAt?: string;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Section 3 — Payments, Promotions, COD
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface RideFareConfig {
  id: string;
  campusId: string;
  vehicleType: VehicleType;
  baseFare: number;
  perKmRate: number;
  perMinRate: number;
  minFare: number;
  maxFare: number;
  poolDiscount: number;
  nightSurcharge: number;
  waitingFeePerMin: number;
  platformFee: number;
  gstPct: number;
  surgeCeiling: number;
  effectiveFrom: string;
  effectiveTo?: string;
  isActive: boolean;
}

export interface RidePromotion {
  id: string;
  campusId?: string;
  code: string;
  title: string;
  description?: string;
  bannerUrl?: string;
  discountType: 'flat' | 'percent';
  discountValue: number;
  maxDiscount?: number;
  minRideValue: number;
  usageLimit?: number;
  usagePerUser: number;
  usageCount: number;
  rideTypes: RideType[];
  applicableHours: { startHour: number; endHour: number };
  validFrom: string;
  validUntil: string;
  isActive: boolean;
}

export interface RidePayment {
  id: string;
  rideId: string;
  riderId: string;
  driverId?: string;
  amount: number;
  tax: number;
  tip: number;
  platformFee: number;
  total: number;
  method: PaymentMethod;
  status: PaymentStatus;
  gatewayOrderId?: string;
  gatewayPaymentId?: string;
  refundAmount: number;
  refundedAt?: string;
  invoiceUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CodVerification {
  rideId: string;
  riderId: string;
  driverId?: string;
  expiresAt: string;
  attempts: number;
  maxAttempts: number;
  status: CodVerificationStatus;
  verifiedAt?: string;
  failureReason?: string;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Section 4 — SOS, Incidents, Luggage, Skins, Scans, Maintenance
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface SosEvent {
  id: string;
  rideId?: string;
  triggeredBy: string;
  driverId?: string;
  campusId: string;
  location?: LatLng;
  audioClipUrl?: string;
  videoClipUrl?: string;
  note?: string;
  severity: IncidentSeverity;
  status: SosStatus;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
  resolvedAt?: string;
  authoritiesNotified: boolean;
  authorityReferenceId?: string;
  timeline: Array<{ at: string; actor: string; action: string; note?: string }>;
  createdAt: string;
}

export interface IncidentEvidence {
  url: string;
  kind: 'image' | 'video' | 'audio' | 'log';
  uploadedAt: string;
}

export interface RideIncident {
  id: string;
  rideId?: string;
  reportedBy: string;
  reportedAgainst?: string;
  driverId?: string;
  campusId: string;
  category: string;
  severity: IncidentSeverity;
  description: string;
  evidence: IncidentEvidence[];
  status: IncidentStatus;
  assignedTo?: string;
  resolution?: string;
  refundedAmount?: number;
  penaltyIssued: boolean;
  penaltyAmount?: number;
  timeline: Array<{ at: string; actor: string; action: string; note?: string }>;
  createdAt: string;
  updatedAt: string;
}

export interface LuggageConfig {
  rideId: string;
  riderId: string;
  pieces: number;
  totalWeightKg?: number;
  sizeBreakdown: Array<{ size: 'cabin' | 'medium' | 'large'; count: number }>;
  fragile: boolean;
  requiresBoots: boolean;
  assistance: boolean;
  notes?: string;
}

export interface SkinPalette {
  primary: string;
  secondary: string;
  accent: string;
  glow: string;
}

export interface RideSkin {
  id: string;
  code: string;
  name: string;
  rarity: SkinRarity;
  thumbnailUrl: string;
  heroUrl?: string;
  description?: string;
  palette: SkinPalette;
  shaderCode?: string;
  unlockCriteria: { type: 'rides' | 'tier' | 'promo' | 'event'; threshold?: number; code?: string };
  isAnimated: boolean;
  isLimited: boolean;
  validFrom: string;
  validUntil?: string;
}

export interface RideSkinSelection {
  skinId: string;
  userId: string;
  appliedToVehicleId?: string;
  selectedAt: string;
}

export interface RideVehicleScan {
  id: string;
  vehicleId: string;
  driverId: string;
  campusId: string;
  scanType: 'pre_trip' | 'post_trip' | 'diagnostic';
  exteriorScore?: number;
  interiorScore?: number;
  tireScore?: number;
  lightScore?: number;
  cleanlinessScore?: number;
  modelUrl?: string;
  thumbnailUrl?: string;
  anomalies: Array<{ code: string; severity: string; note: string }>;
  scanStartedAt: string;
  scanCompletedAt?: string;
}

export interface MaintenancePart {
  name: string;
  cost: number;
  vendor?: string;
}

export interface RideMaintenanceLog {
  id: string;
  vehicleId: string;
  driverId?: string;
  type: MaintenanceType;
  summary: string;
  description?: string;
  parts: MaintenancePart[];
  labourCost: number;
  partsCost: number;
  totalCost: number;
  odometerKm?: number;
  vendor?: string;
  invoiceUrl?: string;
  performedBy?: string;
  performedAt: string;
  nextDueAt?: string;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Section 5 — Fleet Deployment, Heatmap, Places, Ratings
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface RideFleetDeployment {
  id: string;
  campusId: string;
  name: string;
  description?: string;
  zoneIds: string[];
  driverIds: string[];
  vehicleIds: string[];
  status: DeploymentStatus;
  scheduledFrom: string;
  scheduledTo: string;
  surgeFactor: number;
  notes?: string;
  createdBy?: string;
  approvedBy?: string;
  approvedAt?: string;
  createdAt: string;
}

export interface HeatmapPrediction {
  campusId: string;
  bucket: string;
  lat: number;
  lng: number;
  demandScore: number;
  supplyScore: number;
  recommendedDrivers: number;
  confidence: number;
  modelVersion: string;
}

export interface Place {
  id: string;
  campusId?: string;
  kind: 'saved' | 'recent' | 'popular' | 'landmark';
  label: string;
  address?: string;
  lat: number;
  lng: number;
  icon?: string;
  popularity: number;
}

export interface UserPlace {
  id: string;
  userId: string;
  label: 'home' | 'work' | 'hostel' | 'class' | 'custom';
  customLabel?: string;
  address?: string;
  lat: number;
  lng: number;
  icon?: string;
  sortOrder: number;
  lastUsedAt?: string;
}

export interface RideRating {
  rideId: string;
  raterId: string;
  rateeId: string;
  rating: number;
  tags: string[];
  comment?: string;
  isPublic: boolean;
  createdAt: string;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Section 6 — Curators, Rewards, Audit
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface RideCurator {
  id: string;
  userId: string;
  campusId: string;
  displayName: string;
  avatarUrl?: string;
  tier: CuratorTier;
  curatorScore: number;
  ridesCurated: number;
  issuesResolved: number;
  tribesLed: number;
  ritualsCompleted: number;
  biweeklyPoints: number;
  lifetimePoints: number;
  trainingCompleted: string[];
  joinedAt: string;
  lastActiveAt: string;
  isActive: boolean;
}

export interface CuratorShift {
  id: string;
  curatorId: string;
  campusId: string;
  scheduledStart: string;
  scheduledEnd: string;
  checkedInAt?: string;
  checkedOutAt?: string;
  breaks: Array<{ startedAt: string; endedAt?: string; reason?: string }>;
  status: CuratorShiftStatus;
  ridesMonitored: number;
  issuesHandled: number;
  pointsEarned: number;
  notes?: string;
}

export interface CuratorLeaderboardEntry {
  campusId: string;
  period: 'weekly' | 'biweekly' | 'monthly';
  periodStart: string;
  periodEnd: string;
  curatorId: string;
  rank: number;
  score: number;
  ridesCurated: number;
  issuesResolved: number;
  bonusPoints: number;
  reward: { type: 'cash' | 'coin' | 'badge' | 'coupon'; value: number; label: string };
}

export interface RewardBadge {
  code: string;
  name: string;
  earnedAt: string;
}

export interface RewardMilestone {
  code: string;
  reachedAt: string;
  points: number;
}

export interface RideRewards {
  userId: string;
  campusId: string;
  tier: CuratorTier;
  points: number;
  lifetimePoints: number;
  streakDays: number;
  badges: RewardBadge[];
  milestones: RewardMilestone[];
  updatedAt: string;
}

export interface AuditLogEntry {
  id: string;
  actorId?: string;
  actorRole?: string;
  action: string;
  entity: string;
  entityId?: string;
  rideId?: string;
  campusId?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  createdAt: string;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Section 7 — Request / Response DTOs (HTTP API)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface RequestRideDto {
  campusId?: string;
  pickupLat: number;
  pickupLng: number;
  pickupLabel: string;
  pickupBuilding?: string;
  pickupFloor?: string;
  dropoffLat: number;
  dropoffLng: number;
  dropoffLabel: string;
  dropoffBuilding?: string;
  dropoffFloor?: string;
  rideType: RideType;
  isWomenOnly?: boolean;
  passengerCount?: number;
  luggageCount?: number;
  accessibilityNeeds?: Array<{ type: string; note?: string }>;
  paymentMethod?: PaymentMethod;
  couponCode?: string;
  scheduledAt?: string;
  notes?: string;
}

export interface RequestRideResponseDto {
  rideId: string;
  estimatedFare: number;
  surgeMultiplier: number;
  status: RideStatus;
  poolId?: string;
  message: string;
}

export interface FareEstimateDto {
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  rideType: RideType;
  vehicleType: VehicleType;
  couponCode?: string;
  scheduledAt?: string;
}

export interface FareEstimateResponseDto {
  baseFare: number;
  distanceFare: number;
  timeFare: number;
  surgeMultiplier: number;
  platformFee: number;
  tax: number;
  discount: number;
  total: number;
  distanceMeters: number;
  durationSec: number;
  polyline?: string;
  expiresAt: string;
}

export interface AcceptRideDto {
  rideId: string;
  driverId: string;
  etaSec: number;
}

export interface UpdateRideStatusDto {
  rideId: string;
  status: RideStatus;
  note?: string;
}

export interface RateRideDto {
  rideId: string;
  rating: number;
  tags?: string[];
  comment?: string;
}

export interface DriverRegisterDto {
  campusId: string;
  licenseNumber: string;
  licenseImageUrl?: string;
  vehicleType: VehicleType;
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleColor?: string;
  vehicleYear?: number;
  licensePlate?: string;
  isWomenOnly?: boolean;
  isAccessibilityTrained?: boolean;
}

export interface VehicleRegisterDto {
  driverId: string;
  vehicleType: VehicleType;
  make: string;
  model: string;
  year: number;
  color: string;
  licensePlate: string;
  seatingCapacity: number;
  luggageCapacity: number;
  isElectric?: boolean;
  batteryKwh?: number;
  rangeKm?: number;
  rcImageUrl?: string;
  fitnessImageUrl?: string;
  insuranceImageUrl?: string;
  insuranceExpiry: string;
}

export interface LocationUpdateDto {
  lat: number;
  lng: number;
  bearing?: number;
  speedKph?: number;
  accuracyM?: number;
  batteryPct?: number;
}

export interface TriggerSosDto {
  rideId?: string;
  note?: string;
  audioClipUrl?: string;
  videoClipUrl?: string;
  severity?: IncidentSeverity;
}

export interface CreateIncidentDto {
  rideId?: string;
  reportedAgainst?: string;
  category: string;
  severity: IncidentSeverity;
  description: string;
  evidence?: IncidentEvidence[];
}

export interface CreateLuggageDto {
  rideId: string;
  pieces: number;
  totalWeightKg?: number;
  sizeBreakdown: Array<{ size: 'cabin' | 'medium' | 'large'; count: number }>;
  fragile?: boolean;
  requiresBoots?: boolean;
  assistance?: boolean;
  notes?: string;
}

export interface CreateVehicleScanDto {
  vehicleId: string;
  scanType: 'pre_trip' | 'post_trip' | 'diagnostic';
  exteriorScore: number;
  interiorScore: number;
  tireScore: number;
  lightScore: number;
  cleanlinessScore: number;
  modelUrl?: string;
  thumbnailUrl?: string;
  anomalies: Array<{ code: string; severity: string; note: string }>;
}

export interface CreateMaintenanceDto {
  vehicleId: string;
  type: MaintenanceType;
  summary: string;
  description?: string;
  parts?: MaintenancePart[];
  labourCost?: number;
  vendor?: string;
  invoiceUrl?: string;
  nextDueAt?: string;
}

export interface CreateDeploymentDto {
  campusId: string;
  name: string;
  description?: string;
  zoneIds: string[];
  driverIds: string[];
  vehicleIds: string[];
  scheduledFrom: string;
  scheduledTo: string;
  surgeFactor?: number;
  notes?: string;
}

export interface ApplySkinDto {
  skinId: string;
  appliedToVehicleId?: string;
}

export interface SavePlaceDto {
  label: 'home' | 'work' | 'hostel' | 'class' | 'custom';
  customLabel?: string;
  address?: string;
  lat: number;
  lng: number;
  icon?: string;
}

export interface CodVerificationRequest {
  rideId: string;
  otp: string;
}

export interface ProcessPaymentDto {
  rideId: string;
  method: PaymentMethod;
  gatewayOrderId?: string;
  gatewayPaymentId?: string;
  gatewaySignature?: string;
  tip?: number;
}

export interface ProcessRefundDto {
  paymentId: string;
  amount: number;
  reason: string;
}

export interface CuratorCheckInDto {
  shiftId: string;
  location?: LatLng;
}

export interface CuratorBreakDto {
  shiftId: string;
  action: 'start' | 'end';
  reason?: string;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Section 8 — Kafka Event Payloads
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface RideRequestedEvent {
  rideId: string;
  riderId: string;
  campusId: string;
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  rideType: RideType;
  estimatedFare: number;
  requestedAt: string;
}

export interface RideMatchedEvent {
  rideId: string;
  driverId: string;
  vehicleId: string;
  matchedAt: string;
  matchRadius: number;
}

export interface RideAcceptedEvent {
  rideId: string;
  driverId: string;
  etaSec: number;
  acceptedAt: string;
}

export interface RideStartedEvent {
  rideId: string;
  driverId: string;
  startedAt: string;
  pickupLat: number;
  pickupLng: number;
}

export interface RideCompletedEvent {
  rideId: string;
  driverId: string;
  riderId: string;
  startedAt: string;
  completedAt: string;
  distanceMeters: number;
  durationSec: number;
  finalFare: number;
  paymentMethod: PaymentMethod;
}

export interface RideCancelledEvent {
  rideId: string;
  cancelledBy: 'rider' | 'driver' | 'system';
  cancelledAt: string;
  reason?: string;
}

export interface DriverLocationEvent {
  driverId: string;
  lat: number;
  lng: number;
  status: DriverStatus;
  recordedAt: string;
}

export interface DriverAvailabilityEvent {
  driverId: string;
  available: boolean;
  campusId: string;
  changedAt: string;
}

export interface SosTriggeredEvent {
  sosId: string;
  rideId?: string;
  triggeredBy: string;
  campusId: string;
  location?: LatLng;
  severity: IncidentSeverity;
  triggeredAt: string;
}

export interface IncidentReportedEvent {
  incidentId: string;
  rideId?: string;
  reportedBy: string;
  reportedAgainst?: string;
  category: string;
  severity: IncidentSeverity;
  reportedAt: string;
}

export interface PaymentCapturedEvent {
  paymentId: string;
  rideId: string;
  riderId: string;
  amount: number;
  method: PaymentMethod;
  capturedAt: string;
}

export interface MaintenanceLoggedEvent {
  logId: string;
  vehicleId: string;
  type: MaintenanceType;
  totalCost: number;
  performedAt: string;
}

export interface VehicleScanCompletedEvent {
  scanId: string;
  vehicleId: string;
  driverId: string;
  scanType: 'pre_trip' | 'post_trip' | 'diagnostic';
  overallScore: number;
  anomalies: number;
  completedAt: string;
}

export interface CuratorPointsEarnedEvent {
  curatorId: string;
  userId: string;
  campusId: string;
  points: number;
  reason: string;
  earnedAt: string;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Section 9 — API Error Codes
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const RideErrorCode = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  BAD_REQUEST: 'BAD_REQUEST',
  NOT_FOUND: 'RIDE_NOT_FOUND',
  DRIVER_NOT_FOUND: 'DRIVER_NOT_FOUND',
  VEHICLE_NOT_FOUND: 'VEHICLE_NOT_FOUND',
  NO_DRIVERS_AVAILABLE: 'NO_DRIVERS_AVAILABLE',
  OFFER_EXPIRED: 'OFFER_EXPIRED',
  ALREADY_ACCEPTED: 'ALREADY_ACCEPTED',
  INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  COD_VERIFICATION_FAILED: 'COD_VERIFICATION_FAILED',
  DRIVER_UNVERIFIED: 'DRIVER_UNVERIFIED',
  DRIVER_SUSPENDED: 'DRIVER_SUSPENDED',
  VEHICLE_IN_MAINTENANCE: 'VEHICLE_IN_MAINTENANCE',
  FORBIDDEN: 'FORBIDDEN',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  CONFLICT: 'CONFLICT',
} as const;
export type RideErrorCode = (typeof RideErrorCode)[keyof typeof RideErrorCode];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Section 10 — Helper Type Guards
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function isActiveRide(status: RideStatus): boolean {
  return (RIDE_STATUSES_ACTIVE as readonly RideStatus[]).includes(status);
}

export function isTerminalRide(status: RideStatus): boolean {
  return (RIDE_STATUSES_TERMINAL as readonly RideStatus[]).includes(status);
}

export function isWomenOnlyCompatible(rideType: RideType): boolean {
  return rideType === RideType.WOMEN_ONLY;
}

export function requiresOversizedVehicle(rideType: RideType): boolean {
  return rideType === RideType.LUGGAGE || rideType === RideType.PREMIUM;
}

export function supportsPooling(rideType: RideType): boolean {
  return rideType === RideType.POOL || rideType === RideType.SOLO;
}

export function isNightTime(date: Date = new Date()): boolean {
  // IST is UTC+5:30
  const istHour = (date.getUTCHours() + 5 + (date.getUTCMinutes() >= 30 ? 1 : 0)) % 24;
  return istHour >= 22 || istHour < 6;
}

export function nextTripPhase(phase: TripPhase): TripPhase | undefined {
  const transitions = TRIP_PHASE_TRANSITIONS[phase];
  return transitions[0];
}