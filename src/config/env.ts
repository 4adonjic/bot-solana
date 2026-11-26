import "dotenv/config";
import { PublicKey } from "@solana/web3.js";
import { z } from "zod";

const base58PubkeySchema = z.string().refine(
  (value) => {
    try {
      new PublicKey(value);
      return true;
    } catch {
      return false;
    }
  },
  { message: "Cle publique Solana invalide (format base58 attendu)" },
);

const envSchema = z.object({
  RPC_HTTP_URL: z.url("RPC_HTTP_URL doit etre une URL valide"),
  RPC_WS_URL: z
    .url("RPC_WS_URL doit etre une URL valide")
    .refine((url) => url.startsWith("ws://") || url.startsWith("wss://"), {
      message: "RPC_WS_URL doit commencer par ws:// ou wss://",
    }),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),
  TARGET_WALLETS: z
    .string()
    .default("")
    .transform((value) =>
      value
        .split(",")
        .map((wallet) => wallet.trim())
        .filter((wallet) => wallet.length > 0),
    )
    .pipe(z.array(base58PubkeySchema)),
  ENABLE_DEX_DISCOVERY: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  ENABLE_PAPER_TRADING: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
}).superRefine((value, context) => {
  if (value.ENABLE_PAPER_TRADING && !value.ENABLE_DEX_DISCOVERY) {
    context.addIssue({
      code: "custom",
      path: ["ENABLE_PAPER_TRADING"],
      message: "Le Paper Trading nécessite ENABLE_DEX_DISCOVERY=true",
    });
  }
  if (!value.ENABLE_DEX_DISCOVERY && value.TARGET_WALLETS.length === 0) {
    context.addIssue({
      code: "custom",
      path: ["TARGET_WALLETS"],
      message: "Configurez au moins un wallet ou activez ENABLE_DEX_DISCOVERY",
    });
  }
});

export type AppConfig = Readonly<{
  rpcHttpUrl: string;
  rpcWsUrl: string;
  logLevel: "trace" | "debug" | "info" | "warn" | "error" | "fatal";
  targetWallets: readonly string[];
  enableDexDiscovery: boolean;
  enablePaperTrading: boolean;
}>;

function loadConfig(): AppConfig {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `- ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Configuration invalide:\n${issues}`);
  }

  return {
    rpcHttpUrl: parsed.data.RPC_HTTP_URL,
    rpcWsUrl: parsed.data.RPC_WS_URL,
    logLevel: parsed.data.LOG_LEVEL,
    targetWallets: parsed.data.TARGET_WALLETS,
    enableDexDiscovery: parsed.data.ENABLE_DEX_DISCOVERY,
    enablePaperTrading: parsed.data.ENABLE_PAPER_TRADING,
  };
}

export const config: AppConfig = loadConfig();
