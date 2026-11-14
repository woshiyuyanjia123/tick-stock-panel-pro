#!/usr/bin/env node
/**
 * Silent Alternative Consensus Web Collector (EGO Browser Daemon / Standalone Mode)
 *
 * Usage (with ego-browser.exe isolated silent space):
 *   ego-browser --ego-server-name=tsp-alt-radar nodejs -e "await import('./scripts/ego_alt_collector.mjs')"
 *
 * Usage (standalone Node v24 fallback / diagnostic):
 *   node scripts/ego_alt_collector.mjs [--dry-run]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const OUT_JSONL = path.join(DATA_DIR, 'ego_web_snapshots.jsonl');
const MAX_LINES = 300;

const TARGETS = [
  {
    id: 'openrouter_rankings',
    label: 'OpenRouter LLM Token Share',
    url: 'https://openrouter.ai/api/v1/models',
    webUrl: 'https://openrouter.ai/rankings',
  },
  {
    id: 'hyperliquid_paxg',
    label: 'Hyperliquid 24x7 Shadow Perps',
    url: 'https://api.hyperliquid.xyz/info',
    webUrl: 'https://app.hyperliquid.xyz/trade/PAXG',
  },
  {
    id: 'cme_fedwatch',
    label: 'CME FedWatch Rate Implied Prob',
    url: 'https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html',
    webUrl: 'https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html',
  },
];

function appendJsonl(record) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  let lines = [];
  if (fs.existsSync(OUT_JSONL)) {
    lines = fs
      .readFileSync(OUT_JSONL, 'utf8')
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0);
  }
  lines.push(JSON.stringify(record));
  if (lines.length > MAX_LINES) {
    lines = lines.slice(-MAX_LINES);
  }
  fs.writeFileSync(OUT_JSONL, `${lines.join('\n')}\n`, 'utf8');
}

async function collectViaEgoBrowser() {
  const space = await globalThis.taskSpace('tsp-alt-consensus-radar');
  let page = null;
  const extracted = [];

  try {
    const existingPages = await space.pages();
    page = existingPages[0] || (await space.newPage());

    for (const target of TARGETS.slice(1)) {
      const started = Date.now();
      try {
        await page.goto(target.webUrl, { timeout: 12000, waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1500);
        const domTable = await page.evaluate(() => {
          const title = document.title || '';
          const rows = Array.from(document.querySelectorAll('table tr, [role="row"]'))
            .slice(0, 12)
            .map((row) =>
              Array.from(row.querySelectorAll('th, td, [role="cell"]'))
                .map((cell) => (cell.textContent || '').trim().replace(/\s+/g, ' '))
                .filter(Boolean)
            )
            .filter((cells) => cells.length > 0);
          return { title, rowCount: rows.length, sampleRows: rows.slice(0, 6) };
        });
        extracted.push({
          id: target.id,
          label: target.label,
          ok: true,
          latencyMs: Date.now() - started,
          ...domTable,
        });
      } catch (err) {
        extracted.push({
          id: target.id,
          label: target.label,
          ok: false,
          latencyMs: Date.now() - started,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } finally {
    try {
      if (page && page.close) await page.close();
    } catch {
      // ignore close error
    }
    try {
      if (space && space.finish) await space.finish({ keep: false });
    } catch {
      // ignore finish error
    }
  }

  return {
    timestamp: new Date().toISOString(),
    mode: 'ego-browser-isolated',
    spaceId: space?.spaceId ?? null,
    sources: extracted,
  };
}

async function collectStandaloneJsonFallback(dryRun) {
  const started = Date.now();
  const sources = [];

  // 1. OpenRouter model catalog (no API key required)
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4500);
    const res = await fetch('https://openrouter.ai/api/v1/models', { signal: ctrl.signal });
    clearTimeout(timer);
    if (res.ok) {
      const json = await res.json();
      const models = Array.isArray(json?.data) ? json.data : [];
      const cnModels = models.filter((m) =>
        /deepseek|qwen|glm|kimi|moonshot|minimax/i.test(String(m?.id || ''))
      );
      sources.push({
        id: 'openrouter_models',
        label: 'OpenRouter LLM Catalog',
        ok: true,
        latencyMs: Date.now() - started,
        totalModels: models.length,
        cnAiModelCount: cnModels.length,
        sampleCnModels: cnModels.slice(0, 5).map((m) => m.id),
      });
    } else {
      sources.push({ id: 'openrouter_models', ok: false, status: res.status });
    }
  } catch (err) {
    sources.push({
      id: 'openrouter_models',
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // 2. Hyperliquid shadow perp quick probe
  try {
    const t0 = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4500);
    const res = await fetch('https://api.hyperliquid.xyz/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      const universe = data?.[0]?.universe || [];
      const ctxs = data?.[1] || [];
      const pick = (coin) => {
        const idx = universe.findIndex((u) => u.name === coin);
        return idx >= 0 ? Number(ctxs[idx]?.markPx || 0) : null;
      };
      sources.push({
        id: 'hyperliquid_shadow',
        label: 'Hyperliquid 24x7 Shadow Perps',
        ok: true,
        latencyMs: Date.now() - t0,
        paxg: pick('PAXG'),
        btc: pick('BTC'),
        hype: pick('HYPE'),
      });
    }
  } catch (err) {
    sources.push({
      id: 'hyperliquid_shadow',
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return {
    timestamp: new Date().toISOString(),
    mode: dryRun ? 'standalone-dry-run' : 'standalone-rest',
    sources,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const hasEgoRuntime = typeof globalThis.taskSpace === 'function';

  const record = hasEgoRuntime
    ? await collectViaEgoBrowser()
    : await collectStandaloneJsonFallback(dryRun);

  if (!dryRun) {
    appendJsonl(record);
  }
  console.log(JSON.stringify({ ok: true, outFile: OUT_JSONL, record }, null, 2));
}

main().catch((err) => {
  console.error('[ego_alt_collector] error:', err);
  process.exitCode = 1;
});
