import assert from "node:assert/strict";
import { test } from "node:test";
import { assessTokenSecurity } from "./security.js";
import type { TokenSecuritySnapshot } from "./security.js";

const safeSnapshot: TokenSecuritySnapshot = {
  mintAuthority: null,
  freezeAuthority: null,
  liquidityUsd: 100_000,
  top10HolderPercent: 20,
  holderCount: 1_000,
};

test("allows a token only when all checks are present and low risk", () => {
  const result = assessTokenSecurity(safeSnapshot);
  assert.equal(result.decision, "allow");
  assert.equal(result.riskScore, 0);
  assert.deepEqual(result.missingChecks, []);
});

test("rejects a token with both authorities active", () => {
  const result = assessTokenSecurity({
    ...safeSnapshot,
    mintAuthority: "active-authority",
    freezeAuthority: "active-authority",
  });
  assert.equal(result.decision, "reject");
  assert.equal(result.riskScore, 60);
});

test("adds risk for low liquidity and concentrated holders", () => {
  const result = assessTokenSecurity({
    ...safeSnapshot,
    liquidityUsd: 2_000,
    top10HolderPercent: 65,
  });
  assert.equal(result.riskScore, 50);
  assert.equal(result.decision, "review");
});

test("requires review when security data is missing", () => {
  const result = assessTokenSecurity({});
  assert.equal(result.decision, "review");
  assert.equal(result.missingChecks.length, 5);
});

test("does not allow invalid metric values", () => {
  const result = assessTokenSecurity({
    ...safeSnapshot,
    liquidityUsd: Number.NaN,
    top10HolderPercent: 140,
    holderCount: -1,
  });
  assert.equal(result.decision, "review");
  assert.equal(result.missingChecks.length, 3);
});

test("caps the risk score at 100", () => {
  const result = assessTokenSecurity({
    mintAuthority: "active",
    freezeAuthority: "active",
    liquidityUsd: 0,
    top10HolderPercent: 99,
    holderCount: 1,
  });
  assert.equal(result.riskScore, 100);
  assert.equal(result.decision, "reject");
});
