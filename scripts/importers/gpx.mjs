import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseTagValue: true,
  trimValues: true,
});

function asArray(value) {
  if (value == null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function haversineMeters(a, b) {
  const earthRadius = 6371000;
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const x = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  const y = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  return earthRadius * y;
}

function parseTrackPoints(track) {
  const segments = asArray(track?.trkseg);
  return segments.flatMap((segment) =>
    asArray(segment?.trkpt)
      .map((point) => ({
        lat: Number(point?.lat),
        lon: Number(point?.lon),
        time: point?.time ? new Date(point.time).toISOString() : null,
      }))
      .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon)),
  );
}

export function parseGpxSwims(xml, sourceName) {
  const doc = parser.parse(xml);
  const tracks = asArray(doc?.gpx?.trk);
  const sessions = [];

  for (const track of tracks) {
    const trackName = typeof track?.name === "string" ? track.name : sourceName;
    if (!/swim|游泳/i.test(trackName)) {
      continue;
    }

    const points = parseTrackPoints(track);
    if (points.length < 2) {
      continue;
    }

    const firstPoint = points.find((point) => point.time) ?? points[0];
    const lastPoint = [...points].reverse().find((point) => point.time) ?? points.at(-1);
    if (!firstPoint?.time || !lastPoint?.time) {
      continue;
    }

    let distanceMeters = 0;
    for (let index = 1; index < points.length; index += 1) {
      distanceMeters += haversineMeters(points[index - 1], points[index]);
    }

    const durationSeconds =
      Math.round((new Date(lastPoint.time).getTime() - new Date(firstPoint.time).getTime()) / 1000);

    if (!Number.isFinite(distanceMeters) || !Number.isFinite(durationSeconds) || distanceMeters <= 0 || durationSeconds <= 0) {
      continue;
    }

    const roundedDistanceMeters = Math.max(25, Math.round(distanceMeters / 25) * 25);
    const pacePer100mSeconds = Math.round((durationSeconds / roundedDistanceMeters) * 100);

    sessions.push({
      id: `gpx-${firstPoint.time}-${roundedDistanceMeters}`,
      source: "sample_json",
      sourceActivityId: `${sourceName}-${firstPoint.time}`,
      startedAt: firstPoint.time,
      timezone: "Asia/Shanghai",
      title: trackName,
      distanceMeters: roundedDistanceMeters,
      durationSeconds,
      pacePer100mSeconds,
      poolLengthMeters: 25,
      laps: Math.round(roundedDistanceMeters / 25),
      stroke: null,
      swolf: null,
      calories: null,
      notes: `Imported from GPX file ${sourceName}. Distance approximated from track points.`,
      location: null,
      isManualOverride: false,
    });
  }

  return sessions.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
}
