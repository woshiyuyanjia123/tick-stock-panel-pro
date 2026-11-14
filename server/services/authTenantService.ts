import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Request } from 'express';
import {
  DB_PATH,
  DB_WAL_PATH,
  getDb,
  hashScryptPassword,
  runInTransaction,
  SQLITE_TABLE_CATALOG,
  sha256Hex,
  verifyScryptPassword,
  type SaasPlanTier,
  type SaasSeatRole,
  type SaasUserProfile,
} from '../db/sqliteDb';
import { APP_ROOT_DIR } from '../utils/httpCache';
import { getBeijingTimeInfo } from '../utils/marketHelpers';

export interface SaasAuthResponse {
  token: string;
  user: SaasUserProfile;
  availableDemoSeats: SaasUserProfile[];
}

export interface SaasApiKeyItem {
  id: string;
  name: string;
  keyPrefix: string;
  rawKeyOnce?: string;
  scopes: string[];
  lastUsedAt?: string | null;
  createdAt: string;
}

export interface SqliteTableStat {
  tableName: string;
  rowCount: number;
  description: string;
}

export interface StreamJobStat {
  name: string;
  intervalSec: number;
  lastRunAt: string | null;
  runCount: number;
  status: 'idle' | 'running' | 'ok' | 'error';
  lastDetail?: string;
}

export interface SaasSystemDiagnostics {
  version: string;
  dbPath: string;
  journalMode: string;
  dbSizeBytes: number;
  walSizeBytes: number;
  tables: SqliteTableStat[];
  stream: {
    connectedClients: number;
    totalFramesPushed: number;
    uptimeSec: number;
    jobs: StreamJobStat[];
  };
  desktopClient: {
    exePath: string;
    exeExists: boolean;
    launchCommand: string;
  };
  currentUser: SaasUserProfile;
  availableSeats: SaasUserProfile[];
  apiKeys: SaasApiKeyItem[];
}

function nowBj(): string {
  const bj = getBeijingTimeInfo();
  return `${bj.dateStr} ${bj.timeStr}`;
}

function mapUserRow(row: any): SaasUserProfile {
  return {
    id: String(row.id),
    username: String(row.username),
    displayName: String(row.display_name),
    planTier: (row.plan_tier || 'pro') as SaasPlanTier,
    seatRole: (row.seat_role || 'pm') as SaasSeatRole,
    createdAt: String(row.created_at),
  };
}

export function getUserById(userId: string): SaasUserProfile | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId) as any;
  return row ? mapUserRow(row) : null;
}

export function getDefaultAdminUser(): SaasUserProfile {
  const user = getUserById('u_desk_admin');
  if (user) return user;
  return {
    id: 'u_desk_admin',
    username: 'desk_admin',
    displayName: '首席量化台 (本地旗舰席位)',
    planTier: 'institutional',
    seatRole: 'admin',
    createdAt: '2026-11-06 09:00:00',
  };
}

export function getAvailableSeats(): SaasUserProfile[] {
  const db = getDb();
  const rows = db.prepare(`SELECT * FROM users ORDER BY created_at ASC`).all() as any[];
  return rows.map(mapUserRow);
}

export function issueSessionToken(userId: string): string {
  const db = getDb();
  const token = `tsp_sess_${crypto.randomBytes(24).toString('hex')}`;
  const createdAt = nowBj();
  const expDate = new Date(Date.now() + 30 * 86_400_000);
  const expiresAt = expDate.toISOString().replace('T', ' ').slice(0, 19);
  db.prepare(`
    INSERT INTO sessions (token, user_id, created_at, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(token, userId, createdAt, expiresAt);
  return token;
}

export function resolveTenantByApiKey(rawKey: string): SaasUserProfile | null {
  const clean = String(rawKey || '').trim();
  if (!clean) return null;
  const db = getDb();
  const keyHash = sha256Hex(clean);
  const row = db.prepare(`
    SELECT k.id AS key_id, u.*
    FROM api_keys k
    JOIN users u ON u.id = k.user_id
    WHERE k.key_hash = ?
  `).get(keyHash) as any;
  if (!row) return null;

  db.prepare(`UPDATE api_keys SET last_used_at = ? WHERE id = ?`).run(nowBj(), row.key_id);
  return mapUserRow(row);
}

export function resolveTenantBySession(token: string): SaasUserProfile | null {
  const clean = String(token || '').trim();
  if (!clean) return null;
  const db = getDb();
  const row = db.prepare(`
    SELECT s.expires_at, u.*
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ?
  `).get(clean) as any;
  if (!row) return null;
  return mapUserRow(row);
}

export function resolveTenantUser(req: Request): SaasUserProfile {
  const headers = req?.headers || {};
  const query = (req?.query || {}) as Record<string, unknown>;

  // 1. OpenAPI Key header (`x-tsp-api-key`) or query `?apiKey=`
  const apiKeyHeader = String(headers['x-tsp-api-key'] || query.apiKey || '').trim();
  if (apiKeyHeader) {
    const byKey = resolveTenantByApiKey(apiKeyHeader);
    if (byKey) return byKey;
  }

  // 2. Authorization: Bearer <token or tsp_live_...>
  const authHeader = String(headers.authorization || '').trim();
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    const bearerToken = authHeader.slice(7).trim();
    if (bearerToken.startsWith('tsp_live_')) {
      const byKey = resolveTenantByApiKey(bearerToken);
      if (byKey) return byKey;
    } else if (bearerToken) {
      const bySess = resolveTenantBySession(bearerToken);
      if (bySess) return bySess;
    }
  }

  // 2b. Query token for EventSource / download links
  const queryToken = String(query.token || '').trim();
  if (queryToken) {
    const bySess = queryToken.startsWith('tsp_live_')
      ? resolveTenantByApiKey(queryToken)
      : resolveTenantBySession(queryToken);
    if (bySess) return bySess;
  }

  // 3. Explicit seat header (`x-tsp-tenant-user`) or query `?tenantUser=`
  const tenantHint = String(headers['x-tsp-tenant-user'] || query.tenantUser || '').trim();
  if (tenantHint) {
    const db = getDb();
    const row = db.prepare(`
      SELECT * FROM users WHERE id = ? OR username = ?
    `).get(tenantHint, tenantHint) as any;
    if (row) return mapUserRow(row);
  }

  // 4. Local desktop fallback
  return getDefaultAdminUser();
}

export function loginSaasUser(payload: { username: string; password?: string }): SaasAuthResponse {
  const username = String(payload?.username || '').trim();
  if (!username) {
    throw new Error('请输入用户名或席位标识');
  }

  const db = getDb();
  const row = db.prepare(`
    SELECT * FROM users WHERE username = ? OR id = ?
  `).get(username, username) as any;

  if (!row) {
    throw new Error(`账号不存在: ${username}`);
  }

  const isBuiltInSeat = row.id === 'u_desk_admin' || row.id === 'u_macro_pm';
  const pwd = payload.password !== undefined ? String(payload.password) : '';
  if (!isBuiltInSeat || pwd.length > 0) {
    if (!verifyScryptPassword(pwd, String(row.password_hash))) {
      throw new Error('登录密码校验失败');
    }
  }

  const user = mapUserRow(row);
  const token = issueSessionToken(user.id);
  return {
    token,
    user,
    availableDemoSeats: getAvailableSeats(),
  };
}

export function registerSaasUser(payload: {
  username: string;
  displayName?: string;
  password: string;
  planTier?: SaasPlanTier;
}): SaasAuthResponse {
  const username = String(payload?.username || '').trim();
  const displayName = String(payload?.displayName || username).trim();
  const password = String(payload?.password || '');
  const planTier: SaasPlanTier =
    payload?.planTier === 'free' || payload?.planTier === 'institutional'
      ? payload.planTier
      : 'pro';

  if (username.length < 2 || username.length > 32) {
    throw new Error('用户名长度需在 2 到 32 个字符之间');
  }
  if (!/^[a-zA-Z0-9_\-\u4e00-\u9fa5]+$/.test(username)) {
    throw new Error('用户名仅支持中英文、数字、下划线或短横线');
  }
  if (password.length < 4) {
    throw new Error('密码长度至少为 4 位');
  }

  const db = getDb();
  const dup = db.prepare(`SELECT id FROM users WHERE username = ?`).get(username);
  if (dup) {
    throw new Error(`用户名 "${username}" 已被占用`);
  }

  const userId = `u_${crypto.randomBytes(6).toString('hex')}`;
  const createdAt = nowBj();
  const passwordHash = hashScryptPassword(password);
  const seatRole: SaasSeatRole = planTier === 'institutional' ? 'admin' : 'pm';
  const initialCap = planTier === 'institutional' ? 2_000_000 : planTier === 'pro' ? 1_000_000 : 200_000;

  runInTransaction((tx) => {
    tx.prepare(`
      INSERT INTO users (id, username, display_name, password_hash, plan_tier, seat_role, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(userId, username, displayName || username, passwordHash, planTier, seatRole, createdAt);

    // Initialize 100% isolated watchlist group & starter paper portfolio for the new tenant
    tx.prepare(`
      INSERT INTO watchlist_groups (id, user_id, name, sort_order, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(`wg_${crypto.randomBytes(6).toString('hex')}`, userId, '核心自选', 1, createdAt);

    const pfId = `pf_${crypto.randomBytes(6).toString('hex')}`;
    tx.prepare(`
      INSERT INTO paper_portfolios (id, user_id, name, initial_capital, cash_balance, realized_pnl, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(pfId, userId, `${displayName || username} 模拟舱`, initialCap, initialCap, 0, createdAt);

    tx.prepare(`
      INSERT INTO paper_nav_points (portfolio_id, timestamp, total_equity, return_pct, cash_balance)
      VALUES (?, ?, ?, ?, ?)
    `).run(pfId, createdAt.slice(0, 16), initialCap, 0, initialCap);
  });

  const user = getUserById(userId)!;
  const token = issueSessionToken(userId);
  return {
    token,
    user,
    availableDemoSeats: getAvailableSeats(),
  };
}

export function switchDemoSeat(userIdOrUsername: string): SaasAuthResponse {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM users WHERE id = ? OR username = ?`).get(userIdOrUsername, userIdOrUsername) as any;
  if (!row) {
    throw new Error(`未找到目标席位: ${userIdOrUsername}`);
  }
  const user = mapUserRow(row);
  const token = issueSessionToken(user.id);
  return {
    token,
    user,
    availableDemoSeats: getAvailableSeats(),
  };
}

export function listApiKeys(userId: string): SaasApiKeyItem[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, name, key_prefix, scopes_json, last_used_at, created_at
    FROM api_keys
    WHERE user_id = ?
    ORDER BY created_at DESC, rowid DESC
  `).all(userId) as any[];

  return rows.map((r) => {
    let scopes: string[] = [];
    try {
      scopes = JSON.parse(r.scopes_json || '[]');
    } catch {
      scopes = ['read:market'];
    }
    return {
      id: String(r.id),
      name: String(r.name),
      keyPrefix: String(r.key_prefix),
      scopes,
      lastUsedAt: r.last_used_at || null,
      createdAt: String(r.created_at),
    };
  });
}

export function createApiKey(
  userId: string,
  name: string,
  scopes: string[] = ['read:market', 'read:paper', 'write:paper', 'read:archive']
): SaasApiKeyItem {
  const db = getDb();
  const cleanName = String(name || '量化API密钥').trim().slice(0, 48) || '量化API密钥';
  const id = `key_${crypto.randomBytes(6).toString('hex')}`;
  const rawKey = `tsp_live_${crypto.randomBytes(20).toString('hex')}`;
  const keyPrefix = `${rawKey.slice(0, 16)}...`;
  const keyHash = sha256Hex(rawKey);
  const createdAt = nowBj();

  db.prepare(`
    INSERT INTO api_keys (id, user_id, name, key_prefix, key_hash, scopes_json, last_used_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, userId, cleanName, keyPrefix, keyHash, JSON.stringify(scopes), null, createdAt);

  return {
    id,
    name: cleanName,
    keyPrefix,
    rawKeyOnce: rawKey,
    scopes,
    lastUsedAt: null,
    createdAt,
  };
}

export function revokeApiKey(userId: string, keyId: string): boolean {
  const db = getDb();
  const info = db.prepare(`DELETE FROM api_keys WHERE id = ? AND user_id = ?`).run(keyId, userId);
  return Number(info.changes || 0) > 0;
}

export function getSqliteDiagnostics(
  currentUser?: SaasUserProfile,
  streamDiag?: SaasSystemDiagnostics['stream']
): SaasSystemDiagnostics {
  const db = getDb();
  const user = currentUser || getDefaultAdminUser();
  const modeRow = db.prepare('PRAGMA journal_mode').get() as { journal_mode?: string } | undefined;
  const journalMode = String(modeRow?.journal_mode || 'wal').toLowerCase();

  let dbSizeBytes = 0;
  let walSizeBytes = 0;
  try {
    if (fs.existsSync(DB_PATH)) dbSizeBytes = fs.statSync(DB_PATH).size;
    if (fs.existsSync(DB_WAL_PATH)) walSizeBytes = fs.statSync(DB_WAL_PATH).size;
  } catch {
    // ignore stat errors
  }

  const tables: SqliteTableStat[] = SQLITE_TABLE_CATALOG.map((meta) => {
    try {
      const cntRow = db.prepare(`SELECT COUNT(*) AS cnt FROM ${meta.tableName}`).get() as { cnt: number };
      return {
        tableName: meta.tableName,
        rowCount: Number(cntRow?.cnt || 0),
        description: meta.description,
      };
    } catch {
      return {
        tableName: meta.tableName,
        rowCount: 0,
        description: meta.description,
      };
    }
  });

  const exePath =
    process.env.TSP_DESKTOP_BIN ||
    (process.platform === 'darwin'
      ? '/Applications/TICK STOCK PANEL Pro.app'
      : path.resolve(APP_ROOT_DIR, 'TSP_Pro_Desktop.exe'));
  const exeExists = Boolean(process.env.TSP_ELECTRON_SHELL === '1' || fs.existsSync(exePath));

  return {
    version: 'v1.1.0-enterprise',
    dbPath: DB_PATH,
    journalMode,
    dbSizeBytes,
    walSizeBytes,
    tables,
    stream: streamDiag || {
      connectedClients: 0,
      totalFramesPushed: 0,
      uptimeSec: Math.round(process.uptime()),
      jobs: [],
    },
    desktopClient: {
      exePath,
      exeExists,
      launchCommand: 'TSP_Pro_Desktop.exe',
    },
    currentUser: user,
    availableSeats: getAvailableSeats(),
    apiKeys: listApiKeys(user.id),
  };
}
