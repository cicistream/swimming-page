export type PublicConfig = {
  profile: {
    name: string;
    headline: string;
    summary: string;
    location: string;
  };
  providerStatus: {
    selected: string;
    capabilities: {
      label: string;
      supportsAuth: boolean;
      supportsListActivities: boolean;
      supportsActivityDetail: boolean;
      supportsAutomaticSync: boolean;
      qualityScore: number;
    };
    freshness: "fresh" | "stale-but-valid";
    completeness: "complete" | "partial";
  };
};

export type Summary = {
  totalDistanceMeters: number;
  totalDistanceKilometers: number;
  totalSessions: number;
  totalDurationSeconds: number;
  totalDurationLabel: string;
  averagePaceSeconds: number;
  averagePaceLabel: string;
  partialCount: number;
  lastSuccessfulSyncLabel: string;
};

export type Activity = {
  id: string;
  source: string;
  title: string;
  startedAt: string;
  startedAtPrecise?: string;
  startedTimeLabel: string;
  distanceMeters: number;
  durationLabel: string;
  paceLabel: string;
  poolLengthMeters: number;
  laps: number;
  stroke?: string | null;
  swolf?: number | null;
  isPartial: boolean;
  missingOptional: string[];
  location?: string;
  notes?: string;
  manualOverride: boolean;
};

export type HeatmapEntry = {
  date: string;
  sessions: number;
  distanceMeters: number;
};

export type SyncReport = {
  status: "success" | "partial_success" | "failed";
  provider: string;
  acceptedCount: number;
  rejectedCount: number;
  partialCount: number;
  staleButValid: boolean;
  lastSuccessfulSyncAt?: string | null;
  lastSuccessfulSyncLabel?: string | null;
  lastAttemptAt?: string | null;
  lastAttemptLabel?: string | null;
  lastAttemptStatus?: "success" | "failed" | null;
  lastAttemptError?: string | null;
  warnings?: string[];
  inputPath?: string;
  rejections: Array<{
    reason: string;
    id: string;
    missingRequired: string[];
  }>;
};
