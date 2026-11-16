import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const defaultPath = resolve(root, 'data', 'resolver-quota.json');
const dayKey = () => new Date().toISOString().slice(0, 10);
const monthKey = () => dayKey().slice(0, 7);
const blank = () => ({ version: 1, daily: {}, monthly: {} });

export class SearchQuota {
  constructor({ path = defaultPath, dailyCap = 50, providerCaps = {} } = {}) {
    this.path = path;
    this.dailyCap = dailyCap;
    this.providerCaps = providerCaps;
    this.state = this.#load();
  }
  #load() {
    try { const value = JSON.parse(readFileSync(this.path, 'utf8')); return value?.version === 1 ? value : blank(); }
    catch { return blank(); }
  }
  #save() {
    mkdirSync(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.state, null, 2));
    renameSync(temporary, this.path);
  }
  canSpend(provider, cost = 1) {
    this.state = this.#load();
    const dayCount = this.state.daily[dayKey()] ?? 0;
    const monthCount = this.state.monthly[monthKey()]?.[provider] ?? 0;
    return dayCount + cost <= this.dailyCap && monthCount + cost <= (this.providerCaps[provider] ?? 0);
  }
  spend(provider, cost = 1, role = 'web') {
    mkdirSync(dirname(this.path), { recursive: true });
    let lock;
    try { lock = openSync(`${this.path}.lock`, 'wx'); } catch { return false; }
    try {
    if (!this.canSpend(provider, cost)) return false;
    this.state.daily[dayKey()] = (this.state.daily[dayKey()] ?? 0) + cost;
    this.state.monthly[monthKey()] ??= {};
    this.state.monthly[monthKey()][provider] = (this.state.monthly[monthKey()][provider] ?? 0) + cost;
    this.state.calls ??= {};
    this.state.calls[monthKey()] ??= {};
    const callKey = `${provider}${role === 'image' ? 'Image' : role === 'scrape' ? 'Scrape' : 'Web'}Calls`;
    this.state.calls[monthKey()][callKey] = (this.state.calls[monthKey()][callKey] ?? 0) + 1;
    for (const key of Object.keys(this.state.daily)) if (key < dayKey()) delete this.state.daily[key];
    for (const key of Object.keys(this.state.monthly)) if (key < monthKey()) delete this.state.monthly[key];
    this.#save();
    return true;
    } finally { closeSync(lock); unlinkSync(`${this.path}.lock`); }
  }
  getDailyUsage() { return this.state.daily[dayKey()] ?? 0; }
}
