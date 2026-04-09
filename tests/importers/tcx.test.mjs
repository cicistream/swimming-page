import test from "node:test";
import assert from "node:assert/strict";
import { parseTcxSwims } from "../../scripts/importers/tcx.mjs";

test("parseTcxSwims preserves pool length from TCX extensions", () => {
  const xml = `
    <TrainingCenterDatabase>
      <Activities>
        <Activity Sport="Swimming">
          <Id>2026-04-08T11:30:00Z</Id>
          <Lap StartTime="2026-04-08T11:30:00Z">
            <TotalTimeSeconds>1800</TotalTimeSeconds>
            <DistanceMeters>2000</DistanceMeters>
            <Extensions>
              <LX>
                <PoolLengthMeters>50</PoolLengthMeters>
                <SwimStroke>Freestyle</SwimStroke>
              </LX>
            </Extensions>
          </Lap>
        </Activity>
      </Activities>
    </TrainingCenterDatabase>
  `;

  const sessions = parseTcxSwims(xml, "pool-50.tcx");
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].poolLengthMeters, 50);
  assert.equal(sessions[0].laps, 40);
  assert.equal(sessions[0].stroke, "Freestyle");
});
