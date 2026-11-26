import assert from "node:assert/strict";
import { test } from "node:test";
import { parseMintAuthorities } from "./security-onchain.js";

test("reads revoked mint and freeze authorities", () => {
  assert.deepEqual(
    parseMintAuthorities({
      parsed: { type: "mint", info: { mintAuthority: null, freezeAuthority: null } },
    }),
    { mintAuthority: null, freezeAuthority: null },
  );
});

test("detects active mint and freeze authorities", () => {
  assert.deepEqual(
    parseMintAuthorities({
      parsed: {
        type: "mint",
        info: {
          mintAuthority: "MintAuthority111111111111111111111111111",
          freezeAuthority: "FreezeAuthority1111111111111111111111111",
        },
      },
    }),
    {
      mintAuthority: "MintAuthority111111111111111111111111111",
      freezeAuthority: "FreezeAuthority1111111111111111111111111",
    },
  );
});

test("does not treat malformed or non-mint account data as safe", () => {
  assert.deepEqual(parseMintAuthorities({ parsed: { type: "account", info: {} } }), {});
  assert.deepEqual(parseMintAuthorities({}), {});
  assert.deepEqual(
    parseMintAuthorities({
      parsed: { type: "mint", info: { mintAuthority: "active" } },
    }),
    { mintAuthority: "active" },
  );
});
