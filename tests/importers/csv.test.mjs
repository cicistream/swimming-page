import test from "node:test";
import assert from "node:assert/strict";
import { parseCsvSwims } from "../../scripts/importers/csv.mjs";

test("parseCsvSwims maps common meter-based swim exports", () => {
  const csv = [
    "date,distanceMeters,duration,poolLength,stroke,swolf,calories,notes,location,activityId",
    "2026-04-08 19:30,1500,32:15,25,Freestyle,38,420,Threshold set,Indoor pool,swim-001",
  ].join("\n");

  const sessions = parseCsvSwims(csv, "meters.csv");
  assert.equal(sessions.length, 1);

  const [session] = sessions;
  assert.equal(session.distanceMeters, 1500);
  assert.equal(session.durationSeconds, 32 * 60 + 15);
  assert.equal(session.poolLengthMeters, 25);
  assert.equal(session.laps, 60);
  assert.equal(session.stroke, "Freestyle");
  assert.equal(session.swolf, 38);
  assert.equal(session.calories, 420);
  assert.equal(session.sourceActivityId, "swim-001");
  assert.match(session.notes, /Imported from CSV file meters\.csv/);
});

test("parseCsvSwims supports kilometer and minute style columns", () => {
  const csv = [
    "startTime,distanceKm,durationMinutes,poolM,style,name",
    "2026-04-07T06:20:00+08:00,2.4,48,50,Mixed,Aerobic long swim",
  ].join("\n");

  const sessions = parseCsvSwims(csv, "km.csv");
  assert.equal(sessions.length, 1);

  const [session] = sessions;
  assert.equal(session.distanceMeters, 2400);
  assert.equal(session.durationSeconds, 48 * 60);
  assert.equal(session.poolLengthMeters, 50);
  assert.equal(session.laps, 48);
  assert.equal(session.stroke, "Mixed");
  assert.equal(session.title, "Aerobic long swim");
  assert.equal(session.pacePer100mSeconds, 120);
});

test("parseCsvSwims skips rows without required swim fields", () => {
  const csv = [
    "date,distance,duration,poolLength",
    "2026-04-08 19:30,,32:15,25",
    "2026-04-09 06:20,1000,,25",
  ].join("\n");

  const sessions = parseCsvSwims(csv, "invalid.csv");
  assert.equal(sessions.length, 0);
});

test("parseCsvSwims prefers duration columns over clock time columns", () => {
  const csv = [
    "date,time,distance,durationMinutes",
    "2026-04-08,19:30,1500,32",
  ].join("\n");

  const sessions = parseCsvSwims(csv, "clock-time.csv");
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].startedAt, "2026-04-08T11:30:00.000Z");
  assert.equal(sessions[0].durationSeconds, 32 * 60);
});

test("parseCsvSwims supports compact duration units", () => {
  const csv = [
    "date,distance,duration",
    "2026-04-08 19:30,1500,32m15s",
  ].join("\n");

  const sessions = parseCsvSwims(csv, "compact-duration.csv");
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].durationSeconds, 32 * 60 + 15);
});
