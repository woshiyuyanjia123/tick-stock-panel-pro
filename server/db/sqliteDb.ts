import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  AlertTriggerEvent,
  MonitorRule,
  OmsExecutionPolicy,
  WatchlistItem,
} from '../../src/types/market';
import { DATA_DIR } from '../utils/httpCache';
import { cleanCode, getBeijingTimeInfo } from '../utils/marketHelpers';

export const DB_PATH = path.join(DATA_DIR, 'tsp_enterprise.sqlite');
export const DB_WAL_PATH = `${DB_PATH}-wal`;

export type SaasPlanTier = 'free' | 'pro' | 'institutional';
export type SaasSeatRole = 'admin' | 'pm' | 'researcher';

export interface SaasUserProfile {
  id: string;
  username: string;
  displayName: string;
  planTier: SaasPlanTier;
  seatRole: SaasSeatRole;
  createdAt: string;
}

export interface WatchlistGroupCount {
  name: string;
  count: number;
}

export interface AlertsStorage {
  rules: MonitorRule[];
  events: AlertTriggerEvent[];
}

export interface TableMetaEntry {
  tableName: string;
  description: string;
}

export const SQLITE_TABLE_CATALOG: TableMetaEntry[] = [
  { tableName: 'users', description: '多租户席位账号与套餐权限' },
  { tableName: 'sessions', description: 'SaaS 登录会话令牌 (tsp_sess_)' },
  { tableName: 'api_keys', description: '量化 OpenAPI 密钥 (tsp_live_)' },
  { tableName: 'watchlist_groups', description: '租户隔离自选股分组' },
  { tableName: 'watchlist_items', description: '租户自选池与成本风控参数' },
  { tableName: 'backtest_runs', description: '5大引擎历史回测归档库' },
  { tableName: 'paper_portfolios', description: '多策略实盘资金专户' },
  { tableName: 'paper_positions', description: '实时盯市持仓与T+1/止损风控明细' },
  { tableName: 'paper_orders', description: 'OMS交易委托与交割成交流水' },
  { tableName: 'paper_nav_points', description: '资金专户历史净值与回撤时序' },
  { tableName: 'oms_execution_policy', description: 'OMS四维自动报单与证伪止损风控策略' },
  { tableName: 'alert_rules', description: '实盘异动与价格风控规则' },
  { tableName: 'alert_events', description: '实时告警触发审计日志' },
  { tableName: 'webhook_channels', description: '飞书/钉钉/企微/TG推送通道' },
  { tableName: 'consensus_snapshots_sql', description: '跨平台超前认知每日定时快照' },
  { tableName: 'fupeng_intel_items', description: '付鹏24h全网动态情报与FICC观点库' },
];

export function hashScryptPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyScryptPassword(password: string, storedHash: string): boolean {
  const parts = String(storedHash || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, hexHash] = parts;
  if (!salt || !hexHash) return false;
  try {
    const derived = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(hexHash, 'hex');
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export function sha256Hex(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function nowIsoLocal(): string {
  const bj = getBeijingTimeInfo();
  return `${bj.dateStr} ${bj.timeStr}`;
}

let dbInstance: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (dbInstance) return dbInstance;
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const db = new DatabaseSync(DB_PATH);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `);
  initSchemaAndSeeds(db);
  dbInstance = db;
  return db;
}

export function runInTransaction<T>(fn: (db: DatabaseSync) => T): T {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn(db);
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore rollback error if transaction already closed
    }
    throw err;
  }
}

function readJsonFileSafe<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function initSchemaAndSeeds(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      plan_tier TEXT NOT NULL DEFAULT 'pro',
      seat_role TEXT NOT NULL DEFAULT 'pm',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      key_prefix TEXT NOT NULL,
      key_hash TEXT UNIQUE NOT NULL,
      scopes_json TEXT NOT NULL,
      last_used_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);

    CREATE TABLE IF NOT EXISTS watchlist_groups (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      UNIQUE(user_id, name)
    );

    CREATE TABLE IF NOT EXISTS watchlist_items (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      group_name TEXT NOT NULL DEFAULT '核心自选',
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      added_at TEXT NOT NULL,
      cost_price REAL,
      shares REAL,
      target_price REAL,
      stop_loss_price REAL,
      note TEXT,
      UNIQUE(user_id, code)
    );
    CREATE INDEX IF NOT EXISTS idx_watchlist_user_group ON watchlist_items(user_id, group_name);

    CREATE TABLE IF NOT EXISTS backtest_runs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      engine_type TEXT NOT NULL,
      symbol TEXT NOT NULL,
      symbol_name TEXT NOT NULL,
      strategy_name TEXT NOT NULL,
      total_return_pct REAL NOT NULL,
      excess_return_pct REAL NOT NULL,
      annual_return_pct REAL NOT NULL,
      sharpe REAL NOT NULL,
      max_drawdown_pct REAL NOT NULL,
      win_rate_pct REAL NOT NULL,
      trade_count INTEGER NOT NULL,
      params_summary TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_backtest_user_time ON backtest_runs(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS paper_portfolios (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      initial_capital REAL NOT NULL,
      cash_balance REAL NOT NULL,
      realized_pnl REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_paper_portfolios_user ON paper_portfolios(user_id);

    CREATE TABLE IF NOT EXISTS paper_positions (
      id TEXT PRIMARY KEY,
      portfolio_id TEXT NOT NULL REFERENCES paper_portfolios(id) ON DELETE CASCADE,
      symbol TEXT NOT NULL,
      name TEXT NOT NULL,
      market TEXT NOT NULL,
      side TEXT NOT NULL,
      quantity REAL NOT NULL,
      available_quantity REAL NOT NULL,
      avg_cost REAL NOT NULL,
      last_price REAL NOT NULL,
      leverage REAL NOT NULL DEFAULT 1,
      margin_occupied REAL NOT NULL DEFAULT 0,
      strategy_tag TEXT NOT NULL DEFAULT '手动下单',
      opened_date TEXT NOT NULL,
      last_unlock_date TEXT NOT NULL,
      UNIQUE(portfolio_id, symbol, market, side)
    );
    CREATE INDEX IF NOT EXISTS idx_paper_positions_pf ON paper_positions(portfolio_id);

    CREATE TABLE IF NOT EXISTS paper_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      portfolio_id TEXT NOT NULL REFERENCES paper_portfolios(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      trading_date TEXT NOT NULL,
      symbol TEXT NOT NULL,
      name TEXT NOT NULL,
      market TEXT NOT NULL,
      action TEXT NOT NULL,
      quantity REAL NOT NULL,
      fill_price REAL NOT NULL,
      leverage REAL NOT NULL DEFAULT 1,
      fee REAL NOT NULL DEFAULT 0,
      realized_pnl REAL NOT NULL DEFAULT 0,
      strategy_tag TEXT NOT NULL,
      note TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_paper_orders_pf ON paper_orders(portfolio_id, id DESC);

    CREATE TABLE IF NOT EXISTS paper_nav_points (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      portfolio_id TEXT NOT NULL REFERENCES paper_portfolios(id) ON DELETE CASCADE,
      timestamp TEXT NOT NULL,
      total_equity REAL NOT NULL,
      return_pct REAL NOT NULL,
      cash_balance REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_paper_nav_pf ON paper_nav_points(portfolio_id, id ASC);

    CREATE TABLE IF NOT EXISTS alert_rules (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      code TEXT NOT NULL,
      metric TEXT NOT NULL,
      threshold REAL NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_alert_rules_user ON alert_rules(user_id);

    CREATE TABLE IF NOT EXISTS alert_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      time TEXT NOT NULL,
      rule_id TEXT,
      rule_name TEXT NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      message TEXT NOT NULL,
      level TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_alert_events_user ON alert_events(user_id, time DESC);

    CREATE TABLE IF NOT EXISTS webhook_channels (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      provider TEXT NOT NULL,
      webhook_url TEXT NOT NULL,
      secret TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      events_filter_json TEXT NOT NULL,
      last_status TEXT,
      last_sent_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_webhooks_user ON webhook_channels(user_id);

    CREATE TABLE IF NOT EXISTS consensus_snapshots_sql (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL UNIQUE,
      kalshi_count INTEGER NOT NULL,
      manifold_count INTEGER NOT NULL,
      pm_count INTEGER NOT NULL,
      paxg_price REAL NOT NULL,
      btc_funding_annual_pct REAL NOT NULL,
      chinext_pcr REAL NOT NULL,
      top_back_variety TEXT NOT NULL,
      top_back_roll_yield_pct REAL NOT NULL,
      raw_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS fupeng_intel_items (
      id TEXT PRIMARY KEY,
      published_at TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      source_channel TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      url TEXT NOT NULL UNIQUE,
      pillar TEXT NOT NULL,
      stance TEXT NOT NULL,
      confidence_score REAL NOT NULL DEFAULT 80,
      mapped_targets_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_fupeng_intel_pub ON fupeng_intel_items(published_at DESC);

    CREATE TABLE IF NOT EXISTS oms_execution_policy (
      user_id TEXT PRIMARY KEY,
      auto_follow_4of4 INTEGER NOT NULL DEFAULT 0,
      auto_stop_loss_guard INTEGER NOT NULL DEFAULT 1,
      auto_alloc_pct REAL NOT NULL DEFAULT 10,
      max_daily_auto_orders INTEGER NOT NULL DEFAULT 3,
      default_slippage_bps REAL NOT NULL DEFAULT 1.5,
      updated_at TEXT NOT NULL
    );
  `);

  runOmsSchemaMigrations(db);
  seedInitialEnterpriseData(db);
}

function runOmsSchemaMigrations(db: DatabaseSync): void {
  const posCols = db.prepare(`PRAGMA table_info(paper_positions)`).all() as { name: string }[];
  const posColSet = new Set(posCols.map((c) => c.name));
  if (!posColSet.has('stop_loss_price')) {
    db.exec(`ALTER TABLE paper_positions ADD COLUMN stop_loss_price REAL`);
  }
  if (!posColSet.has('take_profit_price')) {
    db.exec(`ALTER TABLE paper_positions ADD COLUMN take_profit_price REAL`);
  }
  db.exec(`
    UPDATE paper_positions
    SET stop_loss_price = ROUND(
      CASE WHEN side = 'short' THEN avg_cost * 1.045 ELSE avg_cost * 0.955 END,
      2
    )
    WHERE stop_loss_price IS NULL OR stop_loss_price <= 0;
  `);

  const ordCols = db.prepare(`PRAGMA table_info(paper_orders)`).all() as { name: string }[];
  const ordColSet = new Set(ordCols.map((c) => c.name));
  if (!ordColSet.has('exec_id')) {
    db.exec(`ALTER TABLE paper_orders ADD COLUMN exec_id TEXT`);
  }
  if (!ordColSet.has('order_type')) {
    db.exec(`ALTER TABLE paper_orders ADD COLUMN order_type TEXT DEFAULT 'MARKET_IOC'`);
  }
  if (!ordColSet.has('slippage_bps')) {
    db.exec(`ALTER TABLE paper_orders ADD COLUMN slippage_bps REAL DEFAULT 1.2`);
  }
  if (!ordColSet.has('tax_and_fee_detail')) {
    db.exec(`ALTER TABLE paper_orders ADD COLUMN tax_and_fee_detail TEXT DEFAULT ''`);
  }
  db.exec(`
    UPDATE paper_orders
    SET exec_id = 'EX' || REPLACE(SUBSTR(created_at, 1, 10), '-', '') || '-' || printf('%06d', id)
    WHERE exec_id IS NULL OR exec_id = '';
    UPDATE paper_orders
    SET order_type = 'MARKET_IOC'
    WHERE order_type IS NULL OR order_type = '';
  `);

  const oldMainName = '\u4e3b\u7b56\u7565\u5b9e\u76d8\u6a21\u62df\u8231';
  const oldMacroName = '\u5b8f\u89c2\u4e8b\u4ef6\u5bf9\u51b2\u6a21\u62df\u8231';
  const oldCabin = '\u6a21\u62df\u5b9e\u76d8\u8231';
  const oldShort = '\u6a21\u62df\u8231';
  const oldGroup = '\u6a21\u62df\u7ec4\u5408';
  const oldWord = '\u6a21\u62df';
  db.prepare(`UPDATE paper_portfolios SET name = '旗舰主策略实盘专户' WHERE name = ?`).run(oldMainName);
  db.prepare(`UPDATE paper_portfolios SET name = '全球宏观FICC对冲专户' WHERE name = ?`).run(oldMacroName);
  db.prepare(
    `UPDATE paper_portfolios SET name = REPLACE(REPLACE(REPLACE(name, ?, '实盘专户'), ?, '实盘专户'), ?, '策略专户') WHERE name LIKE ?`
  ).run(oldCabin, oldShort, oldGroup, `%${oldWord}%`);
}

function seedInitialEnterpriseData(db: DatabaseSync): void {
  const userCountRow = db.prepare('SELECT COUNT(*) AS cnt FROM users').get() as { cnt: number };
  if (Number(userCountRow?.cnt || 0) === 0) {
    const now = nowIsoLocal();
    const adminHash = hashScryptPassword('tsp2026');
    const pmHash = hashScryptPassword('tsp2026');

    const insertUser = db.prepare(`
      INSERT INTO users (id, username, display_name, password_hash, plan_tier, seat_role, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertUser.run(
      'u_desk_admin',
      'desk_admin',
      '首席量化台 (本地旗舰席位)',
      adminHash,
      'institutional',
      'admin',
      '2026-11-06 09:00:00'
    );
    insertUser.run(
      'u_macro_pm',
      'macro_pm',
      '宏观PM专户席位 (Polymarket跨市场)',
      pmHash,
      'pro',
      'pm',
      '2026-11-08 09:00:00'
    );

    // Seed default session & sample OpenAPI key for u_desk_admin
    const expiresAt = '2027-11-15 00:00:00';
    db.prepare(`
      INSERT OR IGNORE INTO sessions (token, user_id, created_at, expires_at)
      VALUES (?, ?, ?, ?)
    `).run('tsp_sess_local_desktop_flagship_seat', 'u_desk_admin', now, expiresAt);

    const demoApiKeyRaw = 'tsp_live_demo_local_quant_desk_key_2026';
    db.prepare(`
      INSERT OR IGNORE INTO api_keys (id, user_id, name, key_prefix, key_hash, scopes_json, last_used_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'key_desk_default',
      'u_desk_admin',
      '本地量化脚本默认密钥',
      `${demoApiKeyRaw.slice(0, 16)}...`,
      sha256Hex(demoApiKeyRaw),
      JSON.stringify(['read:market', 'read:paper', 'write:paper', 'read:archive']),
      now,
      '2026-11-10 09:30:00'
    );

    // Seed watchlist groups for both seats
    const insGroup = db.prepare(`
      INSERT OR IGNORE INTO watchlist_groups (id, user_id, name, sort_order, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    insGroup.run('wg_admin_core', 'u_desk_admin', '核心自选', 1, now);
    insGroup.run('wg_admin_cpo', 'u_desk_admin', 'CPO算力链', 2, now);
    insGroup.run('wg_admin_pm', 'u_desk_admin', 'PM宏观对冲', 3, now);
    insGroup.run('wg_pm_core', 'u_macro_pm', '核心自选', 1, now);
    insGroup.run('wg_pm_hedge', 'u_macro_pm', 'PM事件对冲', 2, now);

    // Migrate data/watchlist.json into u_desk_admin
    const wlFile = path.join(DATA_DIR, 'watchlist.json');
    const existingWl = readJsonFileSafe<WatchlistItem[]>(wlFile, [
      { code: '600519', name: '贵州茅台', addedAt: '2026-11-06', note: '核心消费龙头' },
      { code: '300750', name: '宁德时代', addedAt: '2026-11-06', note: '新能源容量核心' },
      { code: '002594', name: '比亚迪', addedAt: '2026-11-06', note: '整车趋势观察' },
      { code: '688981', name: '中芯国际', addedAt: '2026-11-06', note: '国产替代主线' },
      { code: '600118', name: '中国卫星', addedAt: '2026-11-10', note: '商业航天弹性' },
    ]);

    const insWl = db.prepare(`
      INSERT OR IGNORE INTO watchlist_items
        (id, user_id, group_name, code, name, added_at, cost_price, shares, target_price, stop_loss_price, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const item of existingWl) {
      const code = cleanCode(item.code);
      const groupName = item.groupName || (code === '300308' || code === '300502' ? 'CPO算力链' : '核心自选');
      insWl.run(
        `wl_admin_${code}`,
        'u_desk_admin',
        groupName,
        code,
        item.name || code,
        item.addedAt || '2026-11-06',
        item.costPrice ?? null,
        item.shares ?? null,
        item.targetPrice ?? null,
        item.stopLossPrice ?? null,
        item.note ?? null
      );
    }
    // Add CPO & PM seeded items for admin groups if absent
    insWl.run('wl_admin_300308', 'u_desk_admin', 'CPO算力链', '300308', '中际旭创', '2026-11-11', 132.5, 1200, 165, 118, '800G/1.6T光模块核心锚定');
    insWl.run('wl_admin_600547', 'u_desk_admin', 'PM宏观对冲', '600547', '山东黄金', '2026-11-10', 24.8, 4500, 29.5, 22.8, '联储降息/避险概率共振');

    // Isolated watchlist for secondary seat u_macro_pm
    insWl.run('wl_pm_601899', 'u_macro_pm', 'PM事件对冲', '601899', '紫金矿业', '2026-11-09', 16.2, 5000, 19.5, 14.8, '黄金铜宏观通胀对冲');
    insWl.run('wl_pm_601919', 'u_macro_pm', 'PM事件对冲', '601919', '中远海控', '2026-11-10', 14.1, 4000, 16.8, 12.9, '霍尔木兹航运溢价映射');

    // Migrate data/alerts.json into u_desk_admin
    const alertsFile = path.join(DATA_DIR, 'alerts.json');
    const existingAlerts = readJsonFileSafe<AlertsStorage>(alertsFile, { rules: [], events: [] });
    const insRule = db.prepare(`
      INSERT OR IGNORE INTO alert_rules (id, user_id, name, code, metric, threshold, enabled, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const r of existingAlerts.rules || []) {
      insRule.run(
        r.id,
        'u_desk_admin',
        r.name,
        r.code,
        r.metric,
        Number(r.threshold ?? 0),
        r.enabled ? 1 : 0,
        r.createdAt || now
      );
    }
    if (!existingAlerts.rules || existingAlerts.rules.length === 0) {
      insRule.run('rule-zt-breakout', 'u_desk_admin', '强势冲击涨停预警 (>9.0%)', '*', 'changePct', 9.0, 0, '2026-11-06 09:30:00');
      insRule.run('rule-vol-spike', 'u_desk_admin', '放量异动扫描 (量比 >= 3.0)', '*', 'volumeRatio', 3.0, 0, '2026-11-06 09:30:00');
    }
    insRule.run('rule-pm-gold', 'u_macro_pm', '紫金矿业突破预警 (>= 18.5)', '601899', 'priceAbove', 18.5, 1, '2026-11-10 09:30:00');

    const insEvent = db.prepare(`
      INSERT OR IGNORE INTO alert_events (id, user_id, time, rule_id, rule_name, code, name, message, level)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    if (existingAlerts.events && existingAlerts.events.length > 0) {
      for (const ev of existingAlerts.events) {
        insEvent.run(ev.id, 'u_desk_admin', ev.time, ev.ruleId || null, ev.ruleName, ev.code, ev.name, ev.message, ev.level);
      }
    } else {
      insEvent.run(
        'evt-seed-cpo-gate',
        'u_desk_admin',
        '2026-11-13 14:35:00',
        'rule-zt-breakout',
        'CPO五节点门控状态切换',
        '300308',
        '中际旭创',
        'CPO贝叶斯门控触发拥挤度收敛提醒，建议控制追高仓位至门控区间',
        'warn'
      );
      insEvent.run(
        'evt-seed-hl-gold',
        'u_desk_admin',
        '2026-11-13 09:05:00',
        'rule-vol-spike',
        'Hyperliquid隔夜影子金价异动',
        'AU0',
        '沪金主力',
        'PAXG 隔夜跳空缺口 +1.18%，关联沪金主力/山东黄金共振观察',
        'info'
      );
    }

    // Seed initial Webhook Channel (disabled demo placeholder so external URLs are not hit unexpectedly)
    db.prepare(`
      INSERT OR IGNORE INTO webhook_channels
        (id, user_id, name, provider, webhook_url, secret, enabled, events_filter_json, last_status, last_sent_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'wh_desk_feishu_demo',
      'u_desk_admin',
      '飞书投研量化群 (待配置Hook)',
      'feishu',
      'https://open.feishu.cn/open-apis/bot/v2/hook/replace-with-your-bot-token',
      '',
      0,
      JSON.stringify(['anomaly', 'cpo_gate', 'pm_shock', 'paper_fill']),
      '待填入真实机器人Webhook地址后启用',
      null,
      '2026-11-12 10:00:00'
    );

    // Seed initial Paper Portfolios & realistic MTM positions
    seedInitialPaperPortfolios(db);

    // Seed 2 initial archived backtest runs
    seedInitialArchivedBacktests(db);
  }

  // Always check consensus_snapshots_sql migration if empty
  const snapCnt = db.prepare('SELECT COUNT(*) AS cnt FROM consensus_snapshots_sql').get() as { cnt: number };
  if (Number(snapCnt?.cnt || 0) === 0) {
    migrateConsensusJsonlToSql(db);
  }

  // Always check fupeng_intel_items baseline seed if empty
  const fpCnt = db.prepare('SELECT COUNT(*) AS cnt FROM fupeng_intel_items').get() as { cnt: number };
  if (Number(fpCnt?.cnt || 0) === 0) {
    const insFp = db.prepare(`
      INSERT OR IGNORE INTO fupeng_intel_items
        (id, published_at, captured_at, source_channel, title, summary, url, pillar, stance, confidence_score, mapped_targets_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const now = nowIsoLocal();
    insFp.run(
      'fp_seed_barbell_2026',
      '2026-11-12 09:00:00',
      now,
      '本地宏观智库',
      '【付鹏FICC框架】有效需求不足下的哑铃型配置：左端长债红利底仓 + 右端AI生产力硬瓶颈',
      '在居民与传统部门资产负债表修复周期内，利率中枢趋势下行叠加低风险资产荒，资金持续向高股息垄断现金流与长久期国债聚集；哑铃右端仅保留具备全球资本开支硬约束的AI算力与电力出海瓶颈，严守拥挤度门控。',
      'local://fupeng/fp_seed_barbell_2026',
      '哑铃左端·长债红利防御',
      '超配防御',
      92,
      JSON.stringify([
        { symbol: 'TL0', name: '30年国债期指', direction: '做多' },
        { symbol: '600900', name: '长江电力', direction: '做多' },
        { symbol: '300308', name: '中际旭创', direction: '门控观察' },
      ])
    );
    insFp.run(
      'fp_seed_gold_2026',
      '2026-11-13 10:30:00',
      now,
      '本地宏观智库',
      '【付鹏黄金框架】逆全球化与财政赤字货币化下，黄金脱离美债实际利率单锚的底层重估',
      '当全球央行持续增持黄金替代美元美债储备，黄金定价从单一实际利率因子转向主权信用对冲与去美元化硬通货；工业白银受全球制造业需求拖累弹性偏弱，可配置多AU0空AG0剥离利率Beta。',
      'local://fupeng/fp_seed_gold_2026',
      '逆全球化·黄金硬通货重估',
      '看多配置',
      94,
      JSON.stringify([
        { symbol: 'AU0', name: '沪金主力', direction: '做多' },
        { symbol: '600547', name: '山东黄金', direction: '做多' },
        { symbol: 'AG0', name: '沪银主力', direction: '做空' },
      ])
    );
  }
}

function seedInitialPaperPortfolios(db: DatabaseSync): void {
  const insPf = db.prepare(`
    INSERT OR IGNORE INTO paper_portfolios (id, user_id, name, initial_capital, cash_balance, realized_pnl, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  // Initial 1,000,000; deployed:
  // 1) 300308: 1200 * 132.50 = 159,000 (fee 39.75)
  // 2) 600547: 4500 * 24.80 = 111,600 (fee 27.90)
  // 3) AU0 (mini-lot 100g/lot, 5 lots * 615.20 * 100 / 5x = 61,520 margin, fee 30.76)
  // Total cash spent = 159,039.75 + 111,627.90 + 61,550.76 = 332,218.41 -> remaining cash = 667,781.59
  insPf.run('pf_desk_main', 'u_desk_admin', '旗舰主策略实盘专户', 1_000_000, 667_781.59, 14_280.0, '2026-11-06 09:30:00');
  insPf.run('pf_macro_pm_main', 'u_macro_pm', '全球宏观FICC对冲专户', 500_000, 444_000.0, 4_120.0, '2026-11-08 09:30:00');

  const insPos = db.prepare(`
    INSERT OR IGNORE INTO paper_positions
      (id, portfolio_id, symbol, name, market, side, quantity, available_quantity, avg_cost, last_price, leverage, margin_occupied, strategy_tag, opened_date, last_unlock_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insPos.run('pos_300308_long', 'pf_desk_main', '300308', '中际旭创', 'ashare', 'long', 1200, 1200, 132.5, 138.4, 1, 0, 'CPO五节点门控', '2026-11-11', '2026-11-13');
  insPos.run('pos_600547_long', 'pf_desk_main', '600547', '山东黄金', 'ashare', 'long', 4500, 4500, 24.8, 25.65, 1, 0, 'PM联储避险共振', '2026-11-10', '2026-11-13');
  insPos.run('pos_AU0_long', 'pf_desk_main', 'AU0', '沪金主力', 'futures', 'long', 5, 5, 615.2, 622.8, 5, 61520, 'HL影子金价缺口', '2026-11-12', '2026-11-13');

  insPos.run('pos_pm_EC0_long', 'pf_macro_pm_main', 'EC0', '欧线集运', 'futures', 'long', 2, 2, 2800.0, 2910.0, 5, 56000, '霍尔木兹航运溢价', '2026-11-11', '2026-11-13');

  const insOrd = db.prepare(`
    INSERT INTO paper_orders
      (portfolio_id, created_at, trading_date, symbol, name, market, action, quantity, fill_price, leverage, fee, realized_pnl, strategy_tag, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insOrd.run('pf_desk_main', '2026-11-10 09:42:15', '2026-11-10', '600547', '山东黄金', 'ashare', 'buy_long', 4500, 24.8, 1, 27.9, 0, 'PM联储避险共振', 'A股T+1整手建仓 (次日已解锁)');
  insOrd.run('pf_desk_main', '2026-11-11 10:15:30', '2026-11-11', '300308', '中际旭创', 'ashare', 'buy_long', 1200, 132.5, 1, 39.75, 0, 'CPO五节点门控', 'CPO节点门控放行低吸建仓');
  insOrd.run('pf_desk_main', '2026-11-12 09:05:10', '2026-11-12', 'AU0', '沪金主力', 'futures', 'buy_long', 5, 615.2, 5, 30.76, 0, 'HL影子金价缺口', '期货T+0 5倍杠杆做多5手 (100g/手)');
  insOrd.run('pf_macro_pm_main', '2026-11-11 09:12:00', '2026-11-11', 'EC0', '欧线集运', 'futures', 'buy_long', 2, 2800.0, 5, 28.0, 0, '霍尔木兹航运溢价', 'PM航运低通航概率多头建仓');

  const insNav = db.prepare(`
    INSERT INTO paper_nav_points (portfolio_id, timestamp, total_equity, return_pct, cash_balance)
    VALUES (?, ?, ?, ?, ?)
  `);
  const seedCurve = [
    ['2026-11-06 15:00', 1_000_000, 0.0, 1_000_000],
    ['2026-11-07 15:00', 1_004_620, 0.46, 882_400],
    ['2026-11-10 15:00', 1_009_180, 0.92, 770_800],
    ['2026-11-11 15:00', 1_013_450, 1.35, 729_300],
    ['2026-11-12 15:00', 1_018_920, 1.89, 667_781.59],
    ['2026-11-13 15:00', 1_024_986.59, 2.50, 667_781.59],
  ] as const;
  for (const [ts, eq, ret, cash] of seedCurve) {
    insNav.run('pf_desk_main', ts, eq, ret, cash);
  }
  insNav.run('pf_macro_pm_main', '2026-11-08 15:00', 500_000, 0.0, 500_000);
  insNav.run('pf_macro_pm_main', '2026-11-11 15:00', 504_120, 0.82, 444_000);
  insNav.run('pf_macro_pm_main', '2026-11-13 15:00', 511_000, 2.20, 444_000);
}

function seedInitialArchivedBacktests(db: DatabaseSync): void {
  const insBt = db.prepare(`
    INSERT OR IGNORE INTO backtest_runs
      (id, user_id, engine_type, symbol, symbol_name, strategy_name, total_return_pct, excess_return_pct, annual_return_pct, sharpe, max_drawdown_pct, win_rate_pct, trade_count, params_summary, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const sampleCpoPayload = {
    metrics: { totalReturnPct: 18.42, excessReturnPct: 12.65, annualReturnPct: 39.1, sharpe: 2.14, maxDrawdownPct: 6.84, winRatePct: 66.7, tradeCount: 9 },
    trades: [
      { id: 1, entryDate: '2026-08-14', exitDate: '2026-08-26', side: '做多', entryPrice: 118.4, exitPrice: 129.8, pnl: 9628.4, returnPct: 9.63, reason: 'CPO五节点门控放行 (拥挤度34%)' },
      { id: 2, entryDate: '2026-09-18', exitDate: '2026-10-09', side: '做多', entryPrice: 124.2, exitPrice: 135.6, pnl: 9178.7, returnPct: 9.18, reason: '海外光通信共振+非拥挤突破' },
    ],
  };

  const samplePmPayload = {
    metrics: { totalReturnPct: 14.85, excessReturnPct: 9.12, annualReturnPct: 31.4, sharpe: 1.92, maxDrawdownPct: 4.52, winRatePct: 62.5, tradeCount: 8 },
    trades: [
      { id: 1, entryDate: '2026-09-02', exitDate: '2026-09-15', side: '做多', entryPrice: 586.4, exitPrice: 612.8, pnl: 13200.0, returnPct: 4.5, reason: 'Polymarket联储宽松概率跃升+HL金价领先' },
    ],
  };

  insBt.run(
    'bt_seed_cpo_300308',
    'u_desk_admin',
    'cpo_dag',
    '300308',
    '中际旭创',
    'CPO五节点贝叶斯门控传导',
    18.42,
    12.65,
    39.1,
    2.14,
    6.84,
    66.7,
    9,
    '周期=120日 | 拥挤度阈值=75% | 贝叶斯门控=启用',
    JSON.stringify(sampleCpoPayload),
    '2026-11-12 16:20:00'
  );
  insBt.run(
    'bt_seed_pm_AU0',
    'u_desk_admin',
    'pm_event',
    'AU0',
    '沪金主力',
    'Polymarket 联储避险概率事件冲击',
    14.85,
    9.12,
    31.4,
    1.92,
    4.52,
    62.5,
    8,
    '事件=FED_HIKE_DEC | 冲击阈值=3.5pp | 滞后窗口=2日',
    JSON.stringify(samplePmPayload),
    '2026-11-13 11:10:00'
  );
}

function migrateConsensusJsonlToSql(db: DatabaseSync): void {
  const jsonlPath = path.join(DATA_DIR, 'consensus_snapshots.jsonl');
  if (!fs.existsSync(jsonlPath)) return;
  try {
    const lines = fs.readFileSync(jsonlPath, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const ins = db.prepare(`
      INSERT OR IGNORE INTO consensus_snapshots_sql
        (timestamp, kalshi_count, manifold_count, pm_count, paxg_price, btc_funding_annual_pct, chinext_pcr, top_back_variety, top_back_roll_yield_pct, raw_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const line of lines) {
      try {
        const rec = JSON.parse(line);
        if (!rec || !rec.timestamp) continue;
        ins.run(
          String(rec.timestamp),
          Number(rec.kalshiCount || 0),
          Number(rec.manifoldCount || 0),
          Number(rec.pmCount || 0),
          Number(rec.paxgPrice || 0),
          Number(rec.btcFundingAnnualPct || 0),
          Number(rec.chinextPcr || 0),
          String(rec.topBackVariety || ''),
          Number(rec.topBackRollYieldPct || 0),
          line
        );
      } catch {
        // skip malformed line
      }
    }
  } catch {
    // ignore read error
  }
}

export function dbInsertConsensusSnapshot(rec: {
  timestamp: string;
  kalshiCount: number;
  manifoldCount: number;
  pmCount: number;
  paxgPrice: number;
  btcFundingAnnualPct: number;
  chinextPcr: number;
  topBackVariety: string;
  topBackRollYieldPct: number;
}): void {
  const db = getDb();
  db.prepare(`
    INSERT OR IGNORE INTO consensus_snapshots_sql
      (timestamp, kalshi_count, manifold_count, pm_count, paxg_price, btc_funding_annual_pct, chinext_pcr, top_back_variety, top_back_roll_yield_pct, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    rec.timestamp,
    Number(rec.kalshiCount || 0),
    Number(rec.manifoldCount || 0),
    Number(rec.pmCount || 0),
    Number(rec.paxgPrice || 0),
    Number(rec.btcFundingAnnualPct || 0),
    Number(rec.chinextPcr || 0),
    String(rec.topBackVariety || ''),
    Number(rec.topBackRollYieldPct || 0),
    JSON.stringify(rec)
  );
}

// ================= Multi-Tenant Watchlist & Alert SQLite Helpers =================

export function dbGetWatchlistGroups(userId = 'u_desk_admin'): WatchlistGroupCount[] {
  const db = getDb();
  const groupRows = db.prepare(`
    SELECT name FROM watchlist_groups
    WHERE user_id = ?
    ORDER BY sort_order ASC, created_at ASC
  `).all(userId) as { name: string }[];

  const countRows = db.prepare(`
    SELECT group_name, COUNT(*) AS cnt FROM watchlist_items
    WHERE user_id = ?
    GROUP BY group_name
  `).all(userId) as { group_name: string; cnt: number }[];

  const countMap = new Map<string, number>();
  for (const r of countRows) {
    countMap.set(r.group_name || '核心自选', Number(r.cnt || 0));
  }

  const seen = new Set<string>();
  const out: WatchlistGroupCount[] = [];
  for (const g of groupRows) {
    seen.add(g.name);
    out.push({ name: g.name, count: countMap.get(g.name) || 0 });
  }
  for (const [name, count] of countMap.entries()) {
    if (!seen.has(name)) out.push({ name, count });
  }
  if (out.length === 0) {
    out.push({ name: '核心自选', count: 0 });
  }
  return out;
}

export function dbCreateWatchlistGroup(name: string, userId = 'u_desk_admin'): WatchlistGroupCount[] {
  const cleanName = String(name || '').trim().slice(0, 24);
  if (!cleanName) return dbGetWatchlistGroups(userId);
  const db = getDb();
  const maxOrderRow = db.prepare(`SELECT COALESCE(MAX(sort_order), 0) AS m FROM watchlist_groups WHERE user_id = ?`).get(userId) as { m: number };
  db.prepare(`
    INSERT OR IGNORE INTO watchlist_groups (id, user_id, name, sort_order, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    `wg_${crypto.randomBytes(6).toString('hex')}`,
    userId,
    cleanName,
    Number(maxOrderRow?.m || 0) + 1,
    nowIsoLocal()
  );
  return dbGetWatchlistGroups(userId);
}

export function dbGetWatchlist(userId = 'u_desk_admin', groupName?: string): WatchlistItem[] {
  const db = getDb();
  const useGroup = groupName && groupName !== '全部' && groupName !== 'all';
  const rows = (useGroup
    ? db.prepare(`
        SELECT group_name, code, name, added_at, cost_price, shares, target_price, stop_loss_price, note
        FROM watchlist_items
        WHERE user_id = ? AND group_name = ?
        ORDER BY rowid DESC
      `).all(userId, groupName)
    : db.prepare(`
        SELECT group_name, code, name, added_at, cost_price, shares, target_price, stop_loss_price, note
        FROM watchlist_items
        WHERE user_id = ?
        ORDER BY rowid DESC
      `).all(userId)) as any[];

  return rows.map((r) => ({
    code: r.code,
    name: r.name,
    addedAt: r.added_at,
    groupName: r.group_name || '核心自选',
    costPrice: r.cost_price != null ? Number(r.cost_price) : undefined,
    shares: r.shares != null ? Number(r.shares) : undefined,
    targetPrice: r.target_price != null ? Number(r.target_price) : undefined,
    stopLossPrice: r.stop_loss_price != null ? Number(r.stop_loss_price) : undefined,
    note: r.note ?? undefined,
  }));
}

export function dbUpsertWatchlist(
  item: Partial<WatchlistItem> & { code: string; groupName?: string },
  userId = 'u_desk_admin'
): WatchlistItem[] {
  const db = getDb();
  const code = cleanCode(item.code);
  const groupName = String(item.groupName || '核心自选').trim() || '核心自选';
  dbCreateWatchlistGroup(groupName, userId);

  const existing = db.prepare(`
    SELECT * FROM watchlist_items WHERE user_id = ? AND code = ?
  `).get(userId, code) as any;

  const today = getBeijingTimeInfo().dateStr;
  if (existing) {
    db.prepare(`
      UPDATE watchlist_items
      SET group_name = ?,
          name = ?,
          cost_price = ?,
          shares = ?,
          target_price = ?,
          stop_loss_price = ?,
          note = ?
      WHERE user_id = ? AND code = ?
    `).run(
      item.groupName !== undefined ? groupName : existing.group_name,
      item.name ?? existing.name,
      item.costPrice !== undefined ? item.costPrice : existing.cost_price,
      item.shares !== undefined ? item.shares : existing.shares,
      item.targetPrice !== undefined ? item.targetPrice : existing.target_price,
      item.stopLossPrice !== undefined ? item.stopLossPrice : existing.stop_loss_price,
      item.note !== undefined ? item.note : existing.note,
      userId,
      code
    );
  } else {
    db.prepare(`
      INSERT INTO watchlist_items
        (id, user_id, group_name, code, name, added_at, cost_price, shares, target_price, stop_loss_price, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `wl_${userId}_${code}`,
      userId,
      groupName,
      code,
      item.name || code,
      item.addedAt || today,
      item.costPrice ?? null,
      item.shares ?? null,
      item.targetPrice ?? null,
      item.stopLossPrice ?? null,
      item.note ?? null
    );
  }
  return dbGetWatchlist(userId);
}

export function dbRemoveWatchlist(code: string, userId = 'u_desk_admin'): WatchlistItem[] {
  const db = getDb();
  db.prepare(`DELETE FROM watchlist_items WHERE user_id = ? AND code = ?`).run(userId, cleanCode(code));
  return dbGetWatchlist(userId);
}

export function dbGetAlerts(userId = 'u_desk_admin'): AlertsStorage {
  const db = getDb();
  const ruleRows = db.prepare(`
    SELECT id, name, code, metric, threshold, enabled, created_at
    FROM alert_rules
    WHERE user_id = ?
    ORDER BY rowid DESC
  `).all(userId) as any[];

  const eventRows = db.prepare(`
    SELECT id, time, rule_id, rule_name, code, name, message, level
    FROM alert_events
    WHERE user_id = ?
    ORDER BY time DESC, rowid DESC
    LIMIT 100
  `).all(userId) as any[];

  return {
    rules: ruleRows.map((r) => ({
      id: r.id,
      name: r.name,
      code: r.code,
      metric: r.metric,
      threshold: Number(r.threshold),
      enabled: Boolean(r.enabled),
      createdAt: r.created_at,
    })),
    events: eventRows.map((e) => ({
      id: e.id,
      time: e.time,
      ruleId: e.rule_id || undefined,
      ruleName: e.rule_name,
      code: e.code,
      name: e.name,
      message: e.message,
      level: (e.level || 'info') as 'info' | 'warn' | 'critical',
    })),
  };
}

export function dbSaveAlerts(data: AlertsStorage, userId = 'u_desk_admin'): AlertsStorage {
  runInTransaction((db) => {
    db.prepare(`DELETE FROM alert_rules WHERE user_id = ?`).run(userId);
    const insRule = db.prepare(`
      INSERT INTO alert_rules (id, user_id, name, code, metric, threshold, enabled, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const r of data.rules || []) {
      insRule.run(r.id, userId, r.name, r.code, r.metric, Number(r.threshold ?? 0), r.enabled ? 1 : 0, r.createdAt || nowIsoLocal());
    }

    const insEvt = db.prepare(`
      INSERT OR REPLACE INTO alert_events (id, user_id, time, rule_id, rule_name, code, name, message, level)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const e of (data.events || []).slice(0, 100)) {
      insEvt.run(e.id, userId, e.time, e.ruleId || null, e.ruleName, e.code, e.name, e.message, e.level || 'info');
    }
  });
  return dbGetAlerts(userId);
}

export function dbAppendAlertEvent(ev: AlertTriggerEvent, userId = 'u_desk_admin'): void {
  const db = getDb();
  db.prepare(`
    INSERT OR IGNORE INTO alert_events (id, user_id, time, rule_id, rule_name, code, name, message, level)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    ev.id,
    userId,
    ev.time,
    ev.ruleId || null,
    ev.ruleName,
    ev.code,
    ev.name,
    ev.message,
    ev.level || 'info'
  );
}

export function dbUpsertMonitorRule(rule: Partial<MonitorRule>, userId = 'u_desk_admin'): AlertsStorage {
  const db = getDb();
  const id = rule.id || `rule-${Date.now()}`;
  const existing = db.prepare(`SELECT * FROM alert_rules WHERE id = ? AND user_id = ?`).get(id, userId) as any;
  if (existing) {
    db.prepare(`
      UPDATE alert_rules
      SET name = ?, code = ?, metric = ?, threshold = ?, enabled = ?
      WHERE id = ? AND user_id = ?
    `).run(
      rule.name ?? existing.name,
      rule.code !== undefined ? (rule.code === '*' ? '*' : cleanCode(rule.code)) : existing.code,
      rule.metric ?? existing.metric,
      rule.threshold !== undefined ? Number(rule.threshold) : Number(existing.threshold),
      rule.enabled !== undefined ? (rule.enabled ? 1 : 0) : existing.enabled,
      id,
      userId
    );
  } else {
    db.prepare(`
      INSERT INTO alert_rules (id, user_id, name, code, metric, threshold, enabled, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      userId,
      rule.name || '自定义监控规则',
      rule.code ? (rule.code === '*' ? '*' : cleanCode(rule.code)) : '*',
      rule.metric || 'changePct',
      Number(rule.threshold ?? 5),
      rule.enabled ?? true ? 1 : 0,
      nowIsoLocal()
    );
  }
  return dbGetAlerts(userId);
}

export function dbDeleteMonitorRule(id: string, userId = 'u_desk_admin'): AlertsStorage {
  const db = getDb();
  db.prepare(`DELETE FROM alert_rules WHERE id = ? AND user_id = ?`).run(id, userId);
  return dbGetAlerts(userId);
}

// ================= V7 Fu Peng 24h Intel SQLite Helpers =================

export interface FupengIntelDbItem {
  id: string;
  publishedAt: string;
  capturedAt: string;
  sourceChannel: string;
  title: string;
  summary: string;
  url: string;
  pillar: string;
  stance: '看多配置' | '超配防御' | '警惕拥挤去杠杆' | '对冲回避';
  confidenceScore: number;
  mappedTargets: {
    symbol: string;
    name: string;
    direction: '做多' | '做空' | '门控观察';
  }[];
}

export function dbUpsertFupengIntelItems(items: FupengIntelDbItem[]): { inserted: number; total: number } {
  if (!Array.isArray(items) || items.length === 0) {
    return { inserted: 0, total: dbGetFupengIntelCount() };
  }

  let inserted = 0;
  runInTransaction((tx) => {
    const findStmt = tx.prepare(`SELECT id FROM fupeng_intel_items WHERE id = ? OR url = ? LIMIT 1`);
    const insStmt = tx.prepare(`
      INSERT INTO fupeng_intel_items
        (id, published_at, captured_at, source_channel, title, summary, url, pillar, stance, confidence_score, mapped_targets_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const updStmt = tx.prepare(`
      UPDATE fupeng_intel_items
      SET published_at = ?, captured_at = ?, source_channel = ?, title = ?, summary = ?, pillar = ?, stance = ?, confidence_score = ?, mapped_targets_json = ?
      WHERE id = ?
    `);

    for (const item of items) {
      const id = String(item.id || `fp_${crypto.randomBytes(6).toString('hex')}`);
      const url = String(item.url || '').trim() || `local://fupeng/${id}`;
      const mappedJson = JSON.stringify(Array.isArray(item.mappedTargets) ? item.mappedTargets : []);
      const existing = findStmt.get(id, url) as { id: string } | undefined;

      if (existing) {
        updStmt.run(
          String(item.publishedAt || nowIsoLocal()),
          String(item.capturedAt || nowIsoLocal()),
          String(item.sourceChannel || '全网资讯'),
          String(item.title || '').slice(0, 300),
          String(item.summary || '').slice(0, 2000),
          String(item.pillar || '逆全球化·黄金硬通货重估'),
          String(item.stance || '看多配置'),
          Number(item.confidenceScore || 80),
          mappedJson,
          existing.id
        );
      } else {
        insStmt.run(
          id,
          String(item.publishedAt || nowIsoLocal()),
          String(item.capturedAt || nowIsoLocal()),
          String(item.sourceChannel || '全网资讯'),
          String(item.title || '').slice(0, 300),
          String(item.summary || '').slice(0, 2000),
          url,
          String(item.pillar || '逆全球化·黄金硬通货重估'),
          String(item.stance || '看多配置'),
          Number(item.confidenceScore || 80),
          mappedJson
        );
        inserted++;
      }
    }
  });

  return { inserted, total: dbGetFupengIntelCount() };
}

export function dbListFupengIntel(limit = 100, pillar?: string): FupengIntelDbItem[] {
  const db = getDb();
  const safeLimit = Math.max(1, Math.min(500, Math.round(Number(limit) || 100)));
  const usePillar = pillar && pillar !== 'all' && pillar !== '全部';
  const rows = (usePillar
    ? db.prepare(`
        SELECT * FROM fupeng_intel_items
        WHERE pillar = ?
        ORDER BY published_at DESC, captured_at DESC
        LIMIT ?
      `).all(pillar, safeLimit)
    : db.prepare(`
        SELECT * FROM fupeng_intel_items
        ORDER BY published_at DESC, captured_at DESC
        LIMIT ?
      `).all(safeLimit)) as any[];

  return rows.map((r) => {
    let mappedTargets: FupengIntelDbItem['mappedTargets'] = [];
    try {
      const parsed = JSON.parse(r.mapped_targets_json || '[]');
      if (Array.isArray(parsed)) mappedTargets = parsed;
    } catch {
      mappedTargets = [];
    }
    return {
      id: String(r.id),
      publishedAt: String(r.published_at),
      capturedAt: String(r.captured_at),
      sourceChannel: String(r.source_channel),
      title: String(r.title),
      summary: String(r.summary),
      url: String(r.url),
      pillar: String(r.pillar),
      stance: (r.stance || '看多配置') as FupengIntelDbItem['stance'],
      confidenceScore: Number(r.confidence_score || 80),
      mappedTargets,
    };
  });
}

export function dbGetFupengIntelCount(): number {
  const db = getDb();
  const row = db.prepare(`SELECT COUNT(*) AS cnt FROM fupeng_intel_items`).get() as { cnt: number };
  return Number(row?.cnt || 0);
}

export function dbGetOmsPolicy(userId = 'u_desk_admin'): OmsExecutionPolicy {
  const db = getDb();
  const uid = userId || 'u_desk_admin';
  const row = db
    .prepare(`SELECT * FROM oms_execution_policy WHERE user_id = ?`)
    .get(uid) as any;
  if (!row) {
    const now = nowIsoLocal();
    db.prepare(`
      INSERT OR IGNORE INTO oms_execution_policy
        (user_id, auto_follow_4of4, auto_stop_loss_guard, auto_alloc_pct, max_daily_auto_orders, default_slippage_bps, updated_at)
      VALUES (?, 0, 1, 10, 3, 1.5, ?)
    `).run(uid, now);
    return {
      userId: uid,
      autoFollow4of4: false,
      autoStopLossGuard: true,
      autoAllocPct: 10,
      maxDailyAutoOrders: 3,
      defaultSlippageBps: 1.5,
      updatedAt: now,
    };
  }
  return {
    userId: String(row.user_id),
    autoFollow4of4: Number(row.auto_follow_4of4) === 1,
    autoStopLossGuard: Number(row.auto_stop_loss_guard) === 1,
    autoAllocPct: Number(row.auto_alloc_pct || 10),
    maxDailyAutoOrders: Number(row.max_daily_auto_orders || 3),
    defaultSlippageBps: Number(row.default_slippage_bps || 1.5),
    updatedAt: String(row.updated_at || nowIsoLocal()),
  };
}

export function dbSaveOmsPolicy(
  userId: string,
  patch: Partial<OmsExecutionPolicy>
): OmsExecutionPolicy {
  const current = dbGetOmsPolicy(userId);
  const next: OmsExecutionPolicy = {
    userId: current.userId,
    autoFollow4of4:
      patch.autoFollow4of4 !== undefined ? Boolean(patch.autoFollow4of4) : current.autoFollow4of4,
    autoStopLossGuard:
      patch.autoStopLossGuard !== undefined
        ? Boolean(patch.autoStopLossGuard)
        : current.autoStopLossGuard,
    autoAllocPct:
      patch.autoAllocPct !== undefined
        ? Math.max(2, Math.min(35, Number(patch.autoAllocPct) || 10))
        : current.autoAllocPct,
    maxDailyAutoOrders:
      patch.maxDailyAutoOrders !== undefined
        ? Math.max(1, Math.min(10, Math.round(Number(patch.maxDailyAutoOrders) || 3)))
        : current.maxDailyAutoOrders,
    defaultSlippageBps:
      patch.defaultSlippageBps !== undefined
        ? Math.max(0, Math.min(30, Number(patch.defaultSlippageBps) || 1.5))
        : current.defaultSlippageBps,
    updatedAt: nowIsoLocal(),
  };

  const db = getDb();
  db.prepare(`
    INSERT INTO oms_execution_policy
      (user_id, auto_follow_4of4, auto_stop_loss_guard, auto_alloc_pct, max_daily_auto_orders, default_slippage_bps, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      auto_follow_4of4 = excluded.auto_follow_4of4,
      auto_stop_loss_guard = excluded.auto_stop_loss_guard,
      auto_alloc_pct = excluded.auto_alloc_pct,
      max_daily_auto_orders = excluded.max_daily_auto_orders,
      default_slippage_bps = excluded.default_slippage_bps,
      updated_at = excluded.updated_at
  `).run(
    next.userId,
    next.autoFollow4of4 ? 1 : 0,
    next.autoStopLossGuard ? 1 : 0,
    next.autoAllocPct,
    next.maxDailyAutoOrders,
    next.defaultSlippageBps,
    next.updatedAt
  );

  return next;
}

