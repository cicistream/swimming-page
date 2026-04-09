function parseCsvRows(raw) {
  const rows = [];
  let current = "";
  let row = [];
  let inQuotes = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    const next = raw[index + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        current += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(current);
      current = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(current);
      rows.push(row);
      row = [];
      current = "";
      continue;
    }

    current += char;
  }

  if (current.length > 0 || row.length > 0) {
    row.push(current);
    rows.push(row);
  }

  return rows.filter((line) => line.some((cell) => cell.trim() !== ""));
}

function normalizeHeader(header) {
  return header.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function buildHeaderIndex(headers) {
  return new Map(headers.map((header, index) => [normalizeHeader(header), index]));
}

function getByAliases(row, headerIndex, aliases) {
  for (const alias of aliases) {
    const index = headerIndex.get(alias);
    if (index != null && row[index] != null && String(row[index]).trim() !== "") {
      return String(row[index]).trim();
    }
  }
  return null;
}

function getByAliasesWithKey(row, headerIndex, aliases) {
  for (const alias of aliases) {
    const index = headerIndex.get(alias);
    if (index != null && row[index] != null && String(row[index]).trim() !== "") {
      return {
        key: alias,
        value: String(row[index]).trim(),
      };
    }
  }
  return null;
}

function parseNumber(value) {
  if (value == null) {
    return null;
  }

  const normalized = String(value).replace(/,/g, "").trim();
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDistanceMeters(value, hint = "") {
  if (value == null) {
    return null;
  }

  const raw = String(value).trim().toLowerCase();
  if (!raw) {
    return null;
  }

  const parsed = parseNumber(raw.replace(/km|kilometers?|kilometres?|meters?|metres?|m/g, ""));
  if (parsed == null) {
    return null;
  }

  if (raw.includes("km") || hint.includes("km")) {
    return Math.round(parsed * 1000);
  }

  return Math.round(parsed);
}

function parseDurationSeconds(value, hint = "") {
  if (value == null) {
    return null;
  }

  const raw = String(value).trim().toLowerCase();
  if (!raw) {
    return null;
  }

  if (/^\d+:\d{2}(:\d{2})?$/.test(raw)) {
    const parts = raw.split(":").map(Number);
    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  const compactMatch =
    raw.match(/^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?$/) ??
    raw.match(/^(?:(\d+(?:\.\d+)?)hr)?(?:(\d+(?:\.\d+)?)min)?(?:(\d+(?:\.\d+)?)sec)?$/);
  if (compactMatch && compactMatch[0]) {
    const hours = Number(compactMatch[1] ?? 0);
    const minutes = Number(compactMatch[2] ?? 0);
    const seconds = Number(compactMatch[3] ?? 0);
    const totalSeconds = Math.round(hours * 3600 + minutes * 60 + seconds);
    if (totalSeconds > 0) {
      return totalSeconds;
    }
  }

  const parsed = parseNumber(raw.replace(/seconds?|secs?|sec|s|minutes?|mins?|min|m|hours?|hrs?|hr|h/g, ""));
  if (parsed == null) {
    return null;
  }

  if (raw.includes("hour") || raw.includes("hr") || hint.includes("hour")) {
    return Math.round(parsed * 3600);
  }
  if (raw.includes("minute") || raw.includes("min") || hint.includes("minute")) {
    return Math.round(parsed * 60);
  }
  if (raw.includes("second") || raw.includes("sec") || hint.includes("second")) {
    return Math.round(parsed);
  }

  return Math.round(parsed);
}

function parseDateTime(row, headerIndex) {
  const datetimeValue = getByAliases(row, headerIndex, [
    "startedat",
    "starttime",
    "startdatetime",
    "datetime",
    "timestamp",
    "date",
  ]);
  const timeValue = getByAliases(row, headerIndex, ["time", "start"]);

  if (!datetimeValue) {
    return null;
  }

  const combined =
    timeValue && !datetimeValue.includes("T") && !/\d{1,2}:\d{2}/.test(datetimeValue)
      ? `${datetimeValue} ${timeValue}`
      : datetimeValue;
  const parsed = new Date(combined);

  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }

  const fallback = new Date(`${datetimeValue}T08:00:00+08:00`);
  return Number.isNaN(fallback.getTime()) ? null : fallback.toISOString();
}

function normalizeStroke(value) {
  if (!value) {
    return null;
  }

  const normalized = String(value).trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized.includes("free")) return "Freestyle";
  if (normalized.includes("back")) return "Backstroke";
  if (normalized.includes("breast")) return "Breaststroke";
  if (normalized.includes("fly")) return "Butterfly";
  if (normalized.includes("medley") || normalized.includes("mixed")) return "Mixed";
  return String(value).trim();
}

export function parseCsvSwims(raw, sourceName) {
  const rows = parseCsvRows(raw);
  if (rows.length < 2) {
    return [];
  }

  const [headers, ...dataRows] = rows;
  const headerIndex = buildHeaderIndex(headers);
  const sessions = [];

  for (let index = 0; index < dataRows.length; index += 1) {
    const row = dataRows[index];
    const startedAt = parseDateTime(row, headerIndex);
    const distanceField =
      getByAliasesWithKey(row, headerIndex, ["distancemeters", "distance", "distancem", "swimdistance"]) ??
      getByAliasesWithKey(row, headerIndex, ["distancekm", "distancekilometers", "distancekilometres"]);
    const durationField =
      getByAliasesWithKey(row, headerIndex, ["durationseconds", "duration", "totaltime", "movingtime"]) ??
      getByAliasesWithKey(row, headerIndex, ["durationminutes", "minutes"]);

    const distanceMeters = parseDistanceMeters(distanceField?.value ?? "", distanceField?.key ?? "");
    const durationSeconds = parseDurationSeconds(durationField?.value ?? "", durationField?.key ?? "");

    if (!startedAt || !distanceMeters || !durationSeconds) {
      continue;
    }

    const poolLengthMeters =
      parseNumber(
        getByAliases(row, headerIndex, ["poollengthmeters", "poollength", "lanelength", "poolm"]),
      ) ?? 25;
    const laps =
      parseNumber(getByAliases(row, headerIndex, ["laps", "lengths"])) ??
      Math.round(distanceMeters / poolLengthMeters);
    const pacePer100mSeconds =
      parseDurationSeconds(
        getByAliases(row, headerIndex, ["paceper100mseconds", "pace", "avgpace", "averagepace"]) ?? "",
      ) ?? Math.round((durationSeconds / distanceMeters) * 100);
    const title =
      getByAliases(row, headerIndex, ["title", "name", "workout", "session"]) ?? `${sourceName} import`;
    const stroke = normalizeStroke(
      getByAliases(row, headerIndex, ["stroke", "swimstroke", "style"]),
    );
    const swolf = parseNumber(getByAliases(row, headerIndex, ["swolf", "averageswolf", "avgswolf"]));
    const calories = parseNumber(getByAliases(row, headerIndex, ["calories", "energy", "kcals", "kcal"]));
    const notes = getByAliases(row, headerIndex, ["notes", "note", "description", "comment"]);
    const location = getByAliases(row, headerIndex, ["location", "pool", "venue"]);
    const sourceActivityId =
      getByAliases(row, headerIndex, ["sourceactivityid", "activityid", "id", "recordid"]) ??
      `${sourceName}-${index + 1}`;

    sessions.push({
      id: `csv-${sourceActivityId}-${startedAt}`,
      source: "sample_json",
      sourceActivityId,
      startedAt,
      timezone: "Asia/Shanghai",
      title,
      distanceMeters,
      durationSeconds,
      pacePer100mSeconds,
      poolLengthMeters,
      laps,
      stroke,
      swolf,
      calories,
      notes: notes ? `${notes} (Imported from CSV file ${sourceName}.)` : `Imported from CSV file ${sourceName}.`,
      location,
      isManualOverride: false,
    });
  }

  return sessions.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
}
