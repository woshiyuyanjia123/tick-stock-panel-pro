import fs from 'node:fs';
import path from 'node:path';
import type { AiConfig, AlertTriggerEvent, MonitorRule, WatchlistItem } from '../../src/types/market';
import {
  dbCreateWatchlistGroup,
  dbDeleteMonitorRule,
  dbGetAlerts,
  dbGetWatchlist,
  dbGetWatchlistGroups,
  dbRemoveWatchlist,
  dbSaveAlerts,
  dbUpsertMonitorRule,
  dbUpsertWatchlist,
  type WatchlistGroupCount,
} from '../db/sqliteDb';
import { DATA_DIR } from '../utils/httpCache';

const AI_CONFIG_FILE = path.join(DATA_DIR, 'ai_config.json');

function readJsonSafe<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJsonSafe(filePath: string, data: unknown): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

export function getWatchlistGroups(userId = 'u_desk_admin'): WatchlistGroupCount[] {
  return dbGetWatchlistGroups(userId);
}

export function createWatchlistGroup(name: string, userId = 'u_desk_admin'): WatchlistGroupCount[] {
  return dbCreateWatchlistGroup(name, userId);
}

export function getStoredWatchlist(userId = 'u_desk_admin', groupName?: string): WatchlistItem[] {
  return dbGetWatchlist(userId, groupName);
}

export function upsertStoredWatchlist(
  item: Partial<WatchlistItem> & { code: string; groupName?: string },
  userId = 'u_desk_admin'
): WatchlistItem[] {
  return dbUpsertWatchlist(item, userId);
}

export function removeStoredWatchlist(code: string, userId = 'u_desk_admin'): WatchlistItem[] {
  return dbRemoveWatchlist(code, userId);
}

export interface AlertsStorage {
  rules: MonitorRule[];
  events: AlertTriggerEvent[];
}

export function getAlertsStorage(userId = 'u_desk_admin'): AlertsStorage {
  return dbGetAlerts(userId);
}

export function saveAlertsStorage(data: AlertsStorage, userId = 'u_desk_admin'): AlertsStorage {
  return dbSaveAlerts(data, userId);
}

export function upsertMonitorRule(rule: Partial<MonitorRule>, userId = 'u_desk_admin'): AlertsStorage {
  return dbUpsertMonitorRule(rule, userId);
}

export function deleteMonitorRuleById(id: string, userId = 'u_desk_admin'): AlertsStorage {
  return dbDeleteMonitorRule(id, userId);
}

const DEFAULT_AI_CONFIG: AiConfig = {
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-flash',
};

export function getStoredAiConfig(): AiConfig {
  if (!fs.existsSync(AI_CONFIG_FILE)) {
    writeJsonSafe(AI_CONFIG_FILE, DEFAULT_AI_CONFIG);
    return DEFAULT_AI_CONFIG;
  }
  return readJsonSafe<AiConfig>(AI_CONFIG_FILE, DEFAULT_AI_CONFIG);
}

export function saveStoredAiConfig(cfg: Partial<AiConfig>): AiConfig {
  const prev = getStoredAiConfig();
  const next: AiConfig = {
    baseUrl: (cfg.baseUrl ?? prev.baseUrl).trim() || DEFAULT_AI_CONFIG.baseUrl,
    apiKey: cfg.apiKey !== undefined && !cfg.apiKey.includes('****') ? cfg.apiKey.trim() : prev.apiKey,
    model: (cfg.model ?? prev.model).trim() || DEFAULT_AI_CONFIG.model,
  };
  writeJsonSafe(AI_CONFIG_FILE, next);
  return next;
}

export function getPublicAiConfig(): AiConfig {
  const cfg = getStoredAiConfig();
  const hasKey = Boolean(cfg.apiKey && cfg.apiKey.length > 6);
  const maskedKey = hasKey
    ? `${cfg.apiKey.slice(0, 4)}****${cfg.apiKey.slice(-4)}`
    : '';
  return {
    baseUrl: cfg.baseUrl,
    apiKey: maskedKey,
    model: cfg.model,
    hasKey,
    maskedKey,
  };
}
