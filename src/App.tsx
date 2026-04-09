import { useEffect, useState, type FormEvent, type MouseEvent } from "react";
import type { Activity, HeatmapEntry, PublicConfig, Summary, SyncReport } from "./types";

type DataState = {
  config: PublicConfig;
  summary: Summary;
  activities: Activity[];
  latest: Activity | null;
  heatmap: HeatmapEntry[];
  syncReport: SyncReport;
};

type HeatmapTooltip = {
  content: string;
  top: number;
  left: number;
};
type ToastTone = "success" | "error" | "info";
type ToastState = {
  tone: ToastTone;
  message: string;
} | null;

type VolumeWindow = "7d" | "30d" | "year";
type VolumePoint = {
  label: string;
  distanceKm: number;
  highlight: boolean;
};
type ArchiveFilter = "all" | string;
type StrokeBreakdownItem = {
  label: string;
  tone: string;
  distanceMeters: number;
  percentage: number;
};

const ARCHIVE_PAGE_SIZE = 8;

async function loadJson<T>(file: string, cacheBust?: number): Promise<T> {
  const normalizedFile = file.startsWith("/") ? file.slice(1) : file;
  const url = new URL(normalizedFile, window.location.origin + import.meta.env.BASE_URL);
  if (cacheBust) {
    url.searchParams.set("t", String(cacheBust));
  }
  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Failed to load ${file}`);
  }
  return response.json() as Promise<T>;
}

function showFriendlyError(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback;
}

function inferImportProvider(raw: string) {
  const parsed = JSON.parse(raw);
  if (
    Array.isArray(parsed) &&
    parsed.every(
      (item) =>
        item &&
        typeof item === "object" &&
        "startedAt" in item &&
        "distanceMeters" in item &&
        "durationSeconds" in item,
    )
  ) {
    return "sample_json" as const;
  }

  return "huawei_health" as const;
}

async function fileToBase64(file: File) {
  const buffer = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

async function loadPublishedData(cacheBust = Date.now()): Promise<DataState> {
  const [config, summary, activities, latest, heatmap, syncReport] = await Promise.all([
    loadJson<PublicConfig>("/generated/config.json", cacheBust),
    loadJson<Summary>("/generated/summary.json", cacheBust),
    loadJson<Activity[]>("/generated/activities.json", cacheBust),
    loadJson<Activity | null>("/generated/latest.json", cacheBust),
    loadJson<HeatmapEntry[]>("/generated/heatmap.json", cacheBust),
    loadJson<SyncReport>("/generated/sync-report.json", cacheBust),
  ]);

  return { config, summary, activities, latest, heatmap, syncReport };
}

type HeatmapDay = {
  date: string;
  sessions: number;
  distanceMeters: number;
  intensity: 0 | 1 | 2 | 3 | 4;
  intensityLabel: string;
  monthIndex: number;
  inYear: boolean;
};

type HeatmapWeek = {
  index: number;
  days: HeatmapDay[];
};

function buildHeatmapDay(entry?: HeatmapEntry, inYear = true): HeatmapDay {
  const distanceMeters = entry?.distanceMeters ?? 0;
  let intensity: 0 | 1 | 2 | 3 | 4 = 0;
  if (distanceMeters > 0 && distanceMeters < 1200) intensity = 1;
  if (distanceMeters >= 1200 && distanceMeters < 2000) intensity = 2;
  if (distanceMeters >= 2000 && distanceMeters < 2800) intensity = 3;
  if (distanceMeters >= 2800) intensity = 4;
  const intensityLabel =
    intensity === 0
      ? "Rest day"
      : intensity === 1
        ? "Recovery load"
        : intensity === 2
          ? "Light load"
          : intensity === 3
            ? "Steady load"
            : "Heavy load";

  return {
    date: entry?.date ?? "",
    sessions: entry?.sessions ?? 0,
    distanceMeters,
    intensity,
    intensityLabel,
    monthIndex: entry ? Number(entry.date.slice(5, 7)) - 1 : 0,
    inYear,
  };
}

function startOfWeekMonday(date: Date) {
  const start = new Date(date);
  const day = start.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  start.setUTCDate(start.getUTCDate() + offset);
  return start;
}

function endOfWeekSunday(date: Date) {
  const end = new Date(date);
  const day = end.getUTCDay();
  const offset = day === 0 ? 0 : 7 - day;
  end.setUTCDate(end.getUTCDate() + offset);
  return end;
}

function buildHeatmapCalendar(entries: HeatmapEntry[], year: number) {
  const entryMap = new Map(entries.map((entry) => [entry.date, entry]));
  const start = startOfWeekMonday(new Date(Date.UTC(year, 0, 1)));
  const end = endOfWeekSunday(new Date(Date.UTC(year, 11, 31)));

  const weeks: HeatmapWeek[] = [];
  const monthLabels: Array<{ month: string; column: number }> = [];
  let currentWeek: HeatmapDay[] = [];
  let weekIndex = 0;
  const seenMonths = new Set<number>();

  for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = cursor.toISOString().slice(0, 10);
    const entry = entryMap.get(date);
    const inYear = cursor.getUTCFullYear() === year;
    const dayData = buildHeatmapDay(entry ? { ...entry } : { date, sessions: 0, distanceMeters: 0 }, inYear);
    dayData.monthIndex = cursor.getUTCMonth();

    if (inYear && cursor.getUTCDate() === 1 && !seenMonths.has(dayData.monthIndex)) {
      monthLabels.push({
        month: cursor.toLocaleString("en-US", { month: "short", timeZone: "UTC" }).toUpperCase(),
        column: weekIndex,
      });
      seenMonths.add(dayData.monthIndex);
    }

    currentWeek.push(dayData);

    if (currentWeek.length === 7) {
      weeks.push({ index: weekIndex, days: currentWeek });
      currentWeek = [];
      weekIndex += 1;
    }
  }

  return { weeks, monthLabels, year };
}

function buildMonthGridColumn(monthLabels: Array<{ month: string; column: number }>, index: number, offset = 0) {
  const startColumn = monthLabels[index]?.column ?? 0;
  return `${startColumn + 1 + offset}`;
}

function buildYearOptions(entries: HeatmapEntry[], fallbackYear: number) {
  const years = new Set(entries.map((entry) => Number(entry.date.slice(0, 4))));
  years.add(fallbackYear);
  const maxYear = Math.max(...years);
  const minYear = Math.min(maxYear - 5, ...years);
  const options: number[] = [];
  for (let year = maxYear; year >= minYear; year -= 1) {
    options.push(year);
  }
  return options;
}

function parseActivityDate(date: string) {
  return new Date(`${date}T00:00:00Z`);
}

function buildVolumeSeries(activities: Activity[], window: VolumeWindow, referenceYear?: number) {
  const sorted = [...activities].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const latest = sorted.length > 0 ? parseActivityDate(sorted.at(-1)!.startedAt) : new Date();
  const points: VolumePoint[] = [];

  if (window === "7d") {
    for (let offset = 6; offset >= 0; offset -= 1) {
      const cursor = new Date(latest);
      cursor.setUTCDate(latest.getUTCDate() - offset);
      const dateKey = cursor.toISOString().slice(0, 10);
      const distanceKm =
        sorted
          .filter((activity) => activity.startedAt === dateKey)
          .reduce((sum, activity) => sum + activity.distanceMeters, 0) / 1000;
      points.push({
        label: cursor.toLocaleString("en-US", { weekday: "short", timeZone: "UTC" }).toUpperCase(),
        distanceKm,
        highlight: offset === 0,
      });
    }
    return points;
  }

  if (window === "30d") {
    for (let bucket = 0; bucket < 6; bucket += 1) {
      const end = new Date(latest);
      end.setUTCDate(latest.getUTCDate() - (5 - bucket) * 5);
      const start = new Date(end);
      start.setUTCDate(end.getUTCDate() - 4);
      const distanceKm =
        sorted
          .filter((activity) => {
            const date = parseActivityDate(activity.startedAt);
            return date >= start && date <= end;
          })
          .reduce((sum, activity) => sum + activity.distanceMeters, 0) / 1000;
      points.push({
        label: `${start.toLocaleString("en-US", { month: "short", timeZone: "UTC" })} ${start.getUTCDate()}`,
        distanceKm,
        highlight: bucket === 5,
      });
    }
    return points;
  }

  const yearlyReferenceYear = referenceYear ?? latest.getUTCFullYear();
  const yearlyActivities = sorted.filter(
    (activity) => parseActivityDate(activity.startedAt).getUTCFullYear() === yearlyReferenceYear,
  );
  const yearlyLatest = yearlyActivities.length > 0
    ? parseActivityDate(yearlyActivities.at(-1)!.startedAt)
    : new Date(Date.UTC(yearlyReferenceYear, 11, 31));

  for (let month = 0; month < 12; month += 1) {
    const distanceKm =
      yearlyActivities
        .filter((activity) => parseActivityDate(activity.startedAt).getUTCMonth() === month)
        .reduce((sum, activity) => sum + activity.distanceMeters, 0) / 1000;
    points.push({
      label: new Date(Date.UTC(yearlyReferenceYear, month, 1)).toLocaleString("en-US", {
        month: "short",
        timeZone: "UTC",
      }).toUpperCase(),
      distanceKm,
      highlight: month === yearlyLatest.getUTCMonth(),
    });
  }
  return points;
}

function shouldShowVolumeLabel(window: VolumeWindow, index: number, length: number) {
  if (window === "7d") {
    return index === 0 || index === Math.floor(length / 2) || index === length - 1;
  }

  if (window === "30d") {
    return index === 0 || index === Math.floor(length / 2) || index === length - 1;
  }

  return index % 2 === 0 || index === length - 1;
}

function buildStrokeBreakdown(activities: Activity[]) {
  const canonical = [
    { label: "Freestyle", tone: "stroke-tone--freestyle" },
    { label: "Backstroke", tone: "stroke-tone--backstroke" },
    { label: "Breaststroke", tone: "stroke-tone--breaststroke" },
    { label: "Butterfly", tone: "stroke-tone--butterfly" },
    { label: "Mixed", tone: "stroke-tone--mixed" },
  ];

  const totals = new Map(canonical.map((item) => [item.label, 0]));

  for (const activity of activities) {
    const stroke = (activity.stroke ?? "").trim().toLowerCase();
    if (stroke === "freestyle") totals.set("Freestyle", (totals.get("Freestyle") ?? 0) + activity.distanceMeters);
    if (stroke === "backstroke") totals.set("Backstroke", (totals.get("Backstroke") ?? 0) + activity.distanceMeters);
    if (stroke === "breaststroke") totals.set("Breaststroke", (totals.get("Breaststroke") ?? 0) + activity.distanceMeters);
    if (stroke === "butterfly") totals.set("Butterfly", (totals.get("Butterfly") ?? 0) + activity.distanceMeters);
    if (stroke === "mixed") totals.set("Mixed", (totals.get("Mixed") ?? 0) + activity.distanceMeters);
  }

  const totalDistance = [...totals.values()].reduce((sum, value) => sum + value, 0);

  return {
    hasKnownStrokeData: totalDistance > 0,
    items: canonical.map((item): StrokeBreakdownItem => {
      const distanceMeters = totals.get(item.label) ?? 0;
      return {
        ...item,
        distanceMeters,
        percentage: totalDistance > 0 ? Math.round((distanceMeters / totalDistance) * 100) : 0,
      };
    }),
  };
}

function buildYearSummary(activities: Activity[]) {
  if (activities.length === 0) {
    return {
      totalDistanceKilometers: null,
      totalMovingHours: null,
      averageSwolf: null,
      averagePaceLabel: null,
    };
  }

  const totalDistanceMeters = activities.reduce((sum, activity) => sum + activity.distanceMeters, 0);
  const totalDurationMinutes = activities.reduce((sum, activity) => {
    const [minutes, seconds] = activity.durationLabel.split(":").map(Number);
    return sum + minutes + seconds / 60;
  }, 0);
  const swolfValues = activities.map((activity) => activity.swolf).filter((value): value is number => typeof value === "number");
  const averageSwolf =
    swolfValues.length > 0 ? Math.round((swolfValues.reduce((sum, value) => sum + value, 0) / swolfValues.length) * 10) / 10 : null;
  const totalPaceSeconds = activities.reduce((sum, activity) => {
    const [minutes, seconds] = activity.paceLabel.replace("/100m", "").split(":").map(Number);
    return sum + minutes * 60 + seconds;
  }, 0);
  const averagePaceSeconds = activities.length > 0 ? Math.round(totalPaceSeconds / activities.length) : 0;
  const averagePaceLabel = `${Math.floor(averagePaceSeconds / 60)}:${String(averagePaceSeconds % 60).padStart(2, "0")}/100m`;

  return {
    totalDistanceKilometers: Math.round((totalDistanceMeters / 1000) * 10) / 10,
    totalMovingHours: Math.round((totalDurationMinutes / 60) * 10) / 10,
    averageSwolf,
    averagePaceLabel,
  };
}

function fallbackDisplay(value: string | number | null | undefined) {
  if (value == null) return "-";
  if (typeof value === "string" && value.trim() === "") return "-";
  return String(value);
}

function fallbackMetric(value: string | number | null | undefined, unit?: string) {
  const displayValue = fallbackDisplay(value);
  return displayValue === "-" ? displayValue : `${displayValue}${unit ?? ""}`;
}

function formatArchiveDate(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleString("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatArchiveSource(source: string) {
  if (source === "sample_json") return "Sample JSON";
  if (source === "keep_swim_probe") return "Keep";
  return source
    .split(/[_-]/)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function isKeepSource(source: string) {
  return source === "keep_swim_probe";
}

function formatMissingMetric(value: string | number | null | undefined, unavailableLabel: string) {
  const displayValue = fallbackDisplay(value);
  return displayValue === "-" ? unavailableLabel : displayValue;
}

function formatStrokeLabel(activity: Activity) {
  const stroke = activity.stroke?.trim();
  if (stroke) {
    return stroke;
  }

  return isKeepSource(activity.source) ? "Keep list data" : "Not logged";
}

function App() {
  const [data, setData] = useState<DataState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<HeatmapTooltip | null>(null);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [volumeWindow, setVolumeWindow] = useState<VolumeWindow>("7d");
  const [archivePage, setArchivePage] = useState(1);
  const [archiveFilter, setArchiveFilter] = useState<ArchiveFilter>("all");
  const [isSyncing, setIsSyncing] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);

  useEffect(() => {
    loadPublishedData()
      .then((nextData) => {
        setData(nextData);
        const latestYear =
          nextData.heatmap.length > 0
            ? Math.max(...nextData.heatmap.map((entry) => Number(entry.date.slice(0, 4))))
            : new Date().getUTCFullYear();
        setSelectedYear(latestYear);
      })
      .catch((reason: Error) => {
        setError(reason.message);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!toast) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setToast(null);
    }, 3200);

    return () => window.clearTimeout(timeoutId);
  }, [toast]);

  async function refreshPublishedData() {
    const nextData = await loadPublishedData(Date.now());
    setData(nextData);
    const latestYear =
      nextData.heatmap.length > 0
        ? Math.max(...nextData.heatmap.map((entry) => Number(entry.date.slice(0, 4))))
        : new Date().getUTCFullYear();
    setSelectedYear(latestYear);
  }

  async function handleSyncClick() {
    setToast(null);
    if (!data || data.config.providerStatus.selected !== "keep_swim_probe") {
      setToast({
        tone: "info",
        message: "Sync is only available when the published archive is using the Keep provider.",
      });
      return;
    }

    setIsSyncing(true);

    try {
      if (import.meta.env.DEV) {
        const response = await fetch("/api/dev/sync-keep", { method: "POST" });
        const payload = (await response.json()) as { error?: string };
        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to sync Keep data.");
        }

        await refreshPublishedData();
        setToast({ tone: "success", message: "Keep data synced and page refreshed." });
        return;
      }

      const triggerUrl = import.meta.env.VITE_SYNC_TRIGGER_URL;
      if (!triggerUrl) {
        throw new Error("Online sync needs a secure trigger URL because GitHub Pages cannot safely hold GitHub credentials.");
      }

      const response = await fetch(triggerUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          source: "swimming-page",
          action: "sync_keep",
        }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to trigger GitHub Actions sync.");
      }

      setToast({
        tone: "info",
        message: "Sync requested. GitHub Actions will rebuild and redeploy the page shortly.",
      });
    } catch (reason) {
      setToast({ tone: "error", message: showFriendlyError(reason, "Sync failed.") });
    } finally {
      setIsSyncing(false);
    }
  }

  async function handleImportSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!importFile) {
      setToast({ tone: "error", message: "Choose a JSON file first." });
      return;
    }

    if (!import.meta.env.DEV) {
      setToast({
        tone: "error",
        message: "Import is only available in local development because the deployed site cannot write source files.",
      });
      return;
    }

    setToast(null);
    setIsImporting(true);

    try {
      const lowerName = importFile.name.toLowerCase();
      const isJson = lowerName.endsWith(".json");
      const content = isJson ? await importFile.text() : null;
      const base64 = await fileToBase64(importFile);
      const response = await fetch("/api/dev/import-data", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fileName: importFile.name,
          content,
          base64,
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        message?: string;
        refreshTriggered?: boolean;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Import failed.");
      }

      if (payload.refreshTriggered) {
        await refreshPublishedData();
      }
      setIsImportModalOpen(false);
      setImportFile(null);
      setToast({ tone: "success", message: payload.message ?? "Import completed." });
    } catch (reason) {
      setToast({ tone: "error", message: showFriendlyError(reason, "Import failed.") });
    } finally {
      setIsImporting(false);
    }
  }

  if (isLoading) {
    return (
      <main className="shell shell--centered">
        <section className="state-panel">
          <p className="eyebrow">Preparing archive</p>
          <h1>Bringing the latest swim record to the surface.</h1>
          <p>Loading the published archive and rebuilding the current view.</p>
        </section>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="shell shell--centered">
        <section className="state-panel">
          <p className="eyebrow">Archive unavailable</p>
          <h1>The published swim archive could not be opened.</h1>
          <p>{error ?? "Public artifacts are missing or invalid."}</p>
        </section>
      </main>
    );
  }

  const isEmpty = data.activities.length === 0;
  const isStale = data.syncReport.staleButValid || data.config.providerStatus.freshness === "stale-but-valid";
  const archiveFilterOptions = [
    { value: "all", label: "All" },
    ...Array.from(new Set(data.activities.map((activity) => activity.source)))
      .sort((left, right) => formatArchiveSource(left).localeCompare(formatArchiveSource(right)))
      .map((source) => ({ value: source, label: formatArchiveSource(source) })),
  ];
  const filteredActivities =
    archiveFilter === "all"
      ? data.activities
      : data.activities.filter((activity) => activity.source === archiveFilter);
  const archivePageCount = Math.max(1, Math.ceil(filteredActivities.length / ARCHIVE_PAGE_SIZE));
  const safeArchivePage = Math.min(archivePage, archivePageCount);
  const archiveStartIndex = (safeArchivePage - 1) * ARCHIVE_PAGE_SIZE;
  const paginatedActivities = filteredActivities.slice(archiveStartIndex, archiveStartIndex + ARCHIVE_PAGE_SIZE);

  function handleArchivePageChange(nextPage: number) {
    setArchivePage(Math.min(Math.max(nextPage, 1), archivePageCount));
  }

  function handleArchiveFilterChange(nextFilter: ArchiveFilter) {
    setArchiveFilter(nextFilter);
    setArchivePage(1);
  }
  const heatmapYear = selectedYear ?? new Date().getUTCFullYear();
  const yearActivities = data.activities.filter((activity) => Number(activity.startedAt.slice(0, 4)) === heatmapYear);
  const heatmap = buildHeatmapCalendar(data.heatmap.filter((entry) => Number(entry.date.slice(0, 4)) === heatmapYear), heatmapYear);
  const yearOptions = buildYearOptions(data.heatmap, heatmapYear);
  const activeHeatmapDays = heatmap.weeks.flatMap((week) => week.days).filter((day) => day.sessions > 0).length;
  const averageSwolfValues = data.activities.map((activity) => activity.swolf).filter((value): value is number => typeof value === "number");
  const averageSwolf =
    averageSwolfValues.length > 0 ? Math.round((averageSwolfValues.reduce((sum, value) => sum + value, 0) / averageSwolfValues.length) * 10) / 10 : null;
  const volumeSeries = buildVolumeSeries(data.activities, volumeWindow, heatmapYear);
  const maxVolume = Math.max(...volumeSeries.map((point) => point.distanceKm), 1);
  const volumeTicks = [maxVolume, maxVolume * 0.66, maxVolume * 0.33, 0].map((value) => Math.round(value * 10) / 10);
  const strokeBreakdown = buildStrokeBreakdown(yearActivities);
  const yearSummary = buildYearSummary(yearActivities);
  const ownerDisplay = (import.meta.env.VITE_PAGE_OWNER ?? data.config.profile.name ?? "").trim();
  const pageOwnerLabel = ownerDisplay ? `${ownerDisplay}'s` : "-";
  const activeProvider = data.config.providerStatus.selected;
  const canTriggerKeepSync = activeProvider === "keep_swim_probe";
  const syncButtonLabel = canTriggerKeepSync ? "Sync data" : "Keep sync unavailable for this provider";

  const showHeatmapTooltip = (event: MouseEvent<HTMLDivElement>, content: string, position: "above" | "below") => {
    const rect = event.currentTarget.getBoundingClientRect();
    const tooltipWidth = 180;
    const gutter = 12;
    const left = Math.min(window.innerWidth - tooltipWidth - gutter, Math.max(gutter, rect.left + rect.width / 2 - tooltipWidth / 2));
    const top = position === "below" ? rect.bottom + 12 : rect.top - 88;
    setTooltip({ content, top, left });
  };

  const showVolumeTooltip = (event: MouseEvent<HTMLDivElement>, content: string) => {
    const tooltipWidth = 180;
    const gutter = 12;
    const left = Math.min(window.innerWidth - tooltipWidth - gutter, event.clientX + 18);
    const top = Math.max(gutter, event.clientY - 28);
    setTooltip({ content, top, left });
  };

  if (isEmpty) {
    return (
      <main className="shell shell--centered">
        <section className="state-panel">
          <p className="eyebrow">First publish</p>
          <h1>Your pool archive is still holding its first lane open.</h1>
          <p>
            Start with sample data or connect a provider, then run the publish flow to bring your
            first session into view.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="shell">
      {tooltip ? (
        <div className="heatmap-tooltip-portal" style={{ top: tooltip.top, left: tooltip.left }}>
          {tooltip.content}
        </div>
      ) : null}
      {toast ? (
        <div className={`toast toast--${toast.tone}`} role="status" aria-live="polite">
          <span>{toast.message}</span>
          <button type="button" className="toast__close" onClick={() => setToast(null)} aria-label="Dismiss message">
            ×
          </button>
        </div>
      ) : null}
      {isImportModalOpen ? (
        <div className="modal-backdrop" onClick={() => setIsImportModalOpen(false)}>
          <div className="modal-panel" onClick={(event) => event.stopPropagation()}>
            <p className="eyebrow">Import data</p>
            <h2>Upload a swim export file to refresh the archive locally.</h2>
            <form className="import-form" onSubmit={handleImportSubmit}>
              <label className={`import-dropzone${importFile ? " import-dropzone--selected" : ""}`}>
                <input
                  className="import-dropzone__input"
                  type="file"
                  accept=".json,.fit,.csv,.gpx,.tcx,.xml,.zip,application/json,application/xml,text/csv,application/zip"
                  onChange={(event) => setImportFile(event.target.files?.[0] ?? null)}
                />
                <span className="import-dropzone__eyebrow">Swim export</span>
                <strong>{importFile ? importFile.name : "Drop a file here or click to browse"}</strong>
                <em>Supports JSON, FIT, CSV, GPX, TCX, XML, and ZIP uploads.</em>
              </label>
              <div className="import-form__note">
                JSON, CSV, TCX/XML, and GPX files can rebuild the page immediately. FIT files are probed for swim fields. ZIP files are staged for later mapping.
              </div>
              <div className="import-form__actions">
                <button type="button" className="archive-control archive-control--ghost" onClick={() => setIsImportModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="archive-control archive-control--ghost" disabled={isImporting}>
                  {isImporting ? "Importing..." : "Import"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
      <header className="page-title-banner page-title-banner--with-meta">
        <div>
          <p>{pageOwnerLabel}</p>
          <h1>
            <span>Swimming</span> Page
          </h1>
        </div>
        <div className="page-title-meta" aria-label="Last sync time">
          <span>Last sync</span>
          <strong>{fallbackDisplay(data.syncReport.lastSuccessfulSyncLabel)}</strong>
        </div>
      </header>
      <section className="hero hero--dashboard">
        <div className="dashboard-metrics">
          <div className="dashboard-metric">
            <span>Total distance</span>
            <strong>
              {fallbackDisplay(data.summary.totalDistanceKilometers)}
              {fallbackDisplay(data.summary.totalDistanceKilometers) === "-" ? null : <em>km</em>}
            </strong>
          </div>
          <div className="dashboard-metric">
            <span>Total moving time</span>
            <strong>
              {fallbackDisplay(Math.round((data.summary.totalDurationSeconds / 3600) * 10) / 10)}
              <em>h</em>
            </strong>
          </div>
          <div className="dashboard-metric">
            <span>Avg. swolf</span>
            <strong>
              {fallbackDisplay(averageSwolf)}
              {fallbackDisplay(averageSwolf) === "-" ? null : <em>pts</em>}
            </strong>
          </div>
          <div className="dashboard-metric">
            <span>Average pace</span>
            <strong>
              {fallbackDisplay(data.summary.averagePaceLabel?.replace("/100m", ""))}
              {fallbackDisplay(data.summary.averagePaceLabel?.replace("/100m", "")) === "-" ? null : <em>/100m</em>}
            </strong>
          </div>
        </div>
        <div className="volume-card">
          <div className="volume-card__header">
            <div>
              <h2>Performance Volume</h2>
            </div>
            <div className="volume-tabs" role="tablist" aria-label="Performance volume range">
              <button type="button" className={volumeWindow === "7d" ? "is-active" : ""} onClick={() => setVolumeWindow("7d")}>
                Last 7 days
              </button>
              <button type="button" className={volumeWindow === "30d" ? "is-active" : ""} onClick={() => setVolumeWindow("30d")}>
                Last 30 days
              </button>
              <button type="button" className={volumeWindow === "year" ? "is-active" : ""} onClick={() => setVolumeWindow("year")}>
                Yearly
              </button>
            </div>
          </div>
          <div className="volume-chart" aria-label="Performance volume chart">
            <div className="volume-axis" aria-hidden="true">
              {volumeTicks.map((tick) => (
                <span key={tick}>{tick.toFixed(tick === 0 ? 0 : 1)} km</span>
              ))}
            </div>
            <div className="volume-bars">
              {volumeSeries.map((point, index) => (
                <div key={point.label} className="volume-bar-group">
                  <div className="volume-bar-track">
                    <div
                      className={`volume-bar ${point.highlight ? "volume-bar--highlight" : ""}`}
                      style={{ height: `${Math.max(12, (point.distanceKm / maxVolume) * 100)}%` }}
                      onMouseEnter={(event) =>
                        showVolumeTooltip(
                          event,
                          `${point.label}\n${point.distanceKm.toFixed(1)} km`,
                        )
                      }
                      onMouseLeave={() => setTooltip(null)}
                    />
                  </div>
                  <span>{shouldShowVolumeLabel(volumeWindow, index, volumeSeries.length) ? point.label : ""}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="tonal-section">
        <div className="consistency-layout">
          <div className="heatmap-years" aria-label="Heatmap year filter">
            {yearOptions.map((year) => (
              <button
                key={year}
                type="button"
                className={`heatmap-year ${year === heatmapYear ? "heatmap-year--active" : ""}`}
                onClick={() => {
                  setTooltip(null);
                  setSelectedYear(year);
                }}
              >
                {year}
              </button>
            ))}
          </div>
          <div className="consistency-main">
            <div className="heatmap-panel heatmap-panel--yearly">
              <div className="consistency-summary">
                {activeHeatmapDays} active day{activeHeatmapDays === 1 ? "" : "s"} recorded in {heatmap.year}.
              </div>
              <div className="heatmap-header">
                <div className="heatmap-header__spacer" />
                <div className="heatmap-legend">
                  <span>Low</span>
                  <div className="heatmap-legend__scale">
                    <i className="heatmap-dot heatmap-dot--0" />
                    <i className="heatmap-dot heatmap-dot--1" />
                    <i className="heatmap-dot heatmap-dot--2" />
                    <i className="heatmap-dot heatmap-dot--3" />
                    <i className="heatmap-dot heatmap-dot--4" />
                  </div>
                  <span>High</span>
                </div>
              </div>
              <div className="heatmap-board">
                <div className="heatmap-months" style={{ gridTemplateColumns: `56px repeat(${heatmap.weeks.length}, 1fr)` }}>
                  <span className="heatmap-months__spacer" />
                  {heatmap.monthLabels.map((label, index) => (
                    <span
                      key={`${label.month}-${label.column}`}
                      style={{ gridColumn: buildMonthGridColumn(heatmap.monthLabels, index, 1) }}
                    >
                      {label.month}
                    </span>
                  ))}
                </div>
                <div className="heatmap-grid-shell">
                  <div className="heatmap-row-labels" aria-hidden="true">
                    <span>Mon</span>
                    <span>Wed</span>
                    <span>Fri</span>
                  </div>
                  <div className="heatmap-calendar heatmap-calendar--year" aria-label={`Swim heatmap summary for ${heatmap.year}`}>
                    {heatmap.weeks.map((week) => (
                      <div key={week.index} className="heatmap-week">
                        {week.days.map((day, dayIndex) => (
                          <div
                            key={day.date}
                            className={`heatmap-dot ${day.inYear ? `heatmap-dot--${day.intensity}` : "heatmap-dot--outside"}`}
                            aria-label={`${day.date} ${day.inYear ? (day.sessions > 0 ? `${day.sessions} session` : "rest day") : "outside selected year"}`}
                            onMouseEnter={
                              day.inYear && day.sessions > 0
                                ? (event) =>
                                    showHeatmapTooltip(
                                      event,
                                      `${day.date}\n${day.sessions} session${day.sessions === 1 ? "" : "s"}\n${Math.round(day.distanceMeters / 100) / 10} km\n${day.intensityLabel}`,
                                      week.index < 2 || dayIndex < 2 ? "below" : "above",
                                    )
                                : undefined
                            }
                            onMouseLeave={day.inYear && day.sessions > 0 ? () => setTooltip(null) : undefined}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="consistency-stats">
              <div className="consistency-stat">
                <span>Total distance</span>
                <strong>
                  {fallbackDisplay(yearSummary.totalDistanceKilometers)}
                  {fallbackDisplay(yearSummary.totalDistanceKilometers) === "-" ? null : <em>km</em>}
                </strong>
              </div>
              <div className="consistency-stat">
                <span>Total moving time</span>
                <strong>
                  {fallbackDisplay(yearSummary.totalMovingHours)}
                  {fallbackDisplay(yearSummary.totalMovingHours) === "-" ? null : <em>h</em>}
                </strong>
              </div>
              <div className="consistency-stat">
                <span>Avg. swolf</span>
                <strong>
                  {fallbackDisplay(yearSummary.averageSwolf)}
                  {fallbackDisplay(yearSummary.averageSwolf) === "-" ? null : <em>pts</em>}
                </strong>
              </div>
              <div className="consistency-stat">
                <span>Average pace</span>
                <strong>
                  {fallbackDisplay(yearSummary.averagePaceLabel?.replace("/100m", ""))}
                  {fallbackDisplay(yearSummary.averagePaceLabel?.replace("/100m", "")) === "-" ? null : <em>/100m</em>}
                </strong>
              </div>
            </div>
            <aside className="stroke-card stroke-card--consistency">
              {strokeBreakdown.hasKnownStrokeData ? (
                <>
                  <div className="stroke-legend" aria-label="Stroke legend">
                    {strokeBreakdown.items.map((item) => (
                      <div key={item.label} className="stroke-legend-item" title={`${item.label}: ${item.percentage}%`}>
                        <i className={`stroke-dot ${item.tone}`} />
                        <span>{item.label}</span>
                      </div>
                    ))}
                  </div>
                  <div className="stroke-bar">
                    {strokeBreakdown.items.map((item) => (
                      <div
                        key={item.label}
                        className={`stroke-segment ${item.tone}`}
                        style={{ width: `${item.percentage}%` }}
                        onMouseEnter={(event) => showVolumeTooltip(event, `${item.label}\n${item.percentage}%`)}
                        onMouseLeave={() => setTooltip(null)}
                      />
                    ))}
                  </div>
                </>
              ) : null}
            </aside>
          </div>
        </div>
      </section>

      <section className="tonal-section">
        <div className="archive-toolbar">
          <div className="archive-toolbar__controls">
            <label className="archive-filter" aria-label="Archive filter">
              <span className="archive-filter__label">Source</span>
              <select
                className="archive-control archive-control--select"
                value={archiveFilter}
                onChange={(event) => handleArchiveFilterChange(event.target.value)}
              >
                {archiveFilterOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="archive-actions" aria-label="Archive actions">
              <button
                type="button"
                className={`hero-action-button${isSyncing ? " is-busy" : ""}`}
                data-tooltip={syncButtonLabel}
                aria-label={syncButtonLabel}
                onClick={handleSyncClick}
                disabled={isSyncing || !canTriggerKeepSync}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M20 12a8 8 0 0 1-13.66 5.66" />
                  <path d="M4 12a8 8 0 0 1 13.66-5.66" />
                  <path d="M7 17H4v-3" />
                  <path d="M17 7h3v3" />
                </svg>
              </button>
              <button
                type="button"
                className="hero-action-button"
                data-tooltip="Import data"
                aria-label="Import data"
                onClick={() => setIsImportModalOpen(true)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 5v14" />
                  <path d="M5 12h14" />
                </svg>
              </button>
            </div>
          </div>
          <div className="archive-toolbar__meta">
            <div className="archive-total">Total sessions: {filteredActivities.length}</div>
            <div className="archive-page-status">
              Page {safeArchivePage} / {archivePageCount}
            </div>
          </div>
        </div>
        <div className="activity-log">
          <div className="activity-log__head" aria-hidden="true">
            <span>Date</span>
            <span>Distance</span>
            <span>Duration</span>
            <span>Pace</span>
            <span>Stroke Freq</span>
            <span>Avg. swolf</span>
            <span>Source</span>
          </div>
          <div className="activity-list">
          {paginatedActivities.map((activity) => (
            <article key={activity.id} className="activity-item">
              <div className="activity-item__date">
                <span>{activity.startedAt ? formatArchiveDate(activity.startedAt) : "-"}</span>
              </div>
              <div className="activity-item__distance">{fallbackMetric(activity.distanceMeters?.toLocaleString(), "m")}</div>
              <div className="activity-item__duration">{fallbackDisplay(activity.durationLabel)}</div>
              <div className="activity-item__stats">
                <strong>{fallbackDisplay(activity.paceLabel)}</strong>
                <span>{formatStrokeLabel(activity)}</span>
              </div>
              <div className={`activity-item__stroke-frequency${isKeepSource(activity.source) ? " activity-item__metric--muted" : ""}`}>
                {formatMissingMetric(null, isKeepSource(activity.source) ? "Not exposed" : "-")}
              </div>
              <div className={`activity-item__swolf${isKeepSource(activity.source) && activity.swolf == null ? " activity-item__metric--muted" : ""}`}>
                {formatMissingMetric(activity.swolf, isKeepSource(activity.source) ? "Not exposed" : "-")}
              </div>
              <div className="activity-item__source">{activity.source ? formatArchiveSource(activity.source) : "-"}</div>
            </article>
          ))}
          </div>
        </div>
        <div className="archive-pagination" aria-label="Archive pagination">
          <button
            type="button"
            className="archive-page-button"
            onClick={() => handleArchivePageChange(safeArchivePage - 1)}
            disabled={safeArchivePage === 1}
          >
            Previous
          </button>
          <div className="archive-page-numbers" role="list" aria-label="Archive pages">
            {Array.from({ length: archivePageCount }, (_, index) => {
              const page = index + 1;
              return (
                <button
                  key={page}
                  type="button"
                  role="listitem"
                  className={`archive-page-number${page === safeArchivePage ? " archive-page-number--active" : ""}`}
                  onClick={() => handleArchivePageChange(page)}
                  aria-current={page === safeArchivePage ? "page" : undefined}
                >
                  {page}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            className="archive-page-button"
            onClick={() => handleArchivePageChange(safeArchivePage + 1)}
            disabled={safeArchivePage === archivePageCount}
          >
            Next
          </button>
        </div>
      </section>

      <section className="provenance-close">
        <div className="section-heading">
          <p className="eyebrow">Provenance</p>
          <h2>A living swim archive, surfaced from synced records and careful publish rules.</h2>
        </div>
        <div className="provenance-close__grid">
          <div>
            <span>Provider</span>
            <strong>{fallbackDisplay(data.config.providerStatus.capabilities.label)}</strong>
          </div>
          <div>
            <span>Automatic sync</span>
            <strong>{data.config.providerStatus.capabilities.supportsAutomaticSync ? "Ready" : "Not yet"}</strong>
          </div>
          <div>
            <span>Last success</span>
            <strong>{fallbackDisplay(data.syncReport.lastSuccessfulSyncLabel)}</strong>
          </div>
          <div>
            <span>Rejected records</span>
            <strong>{data.syncReport.rejectedCount}</strong>
          </div>
        </div>
      </section>
    </main>
  );
}

export default App;
