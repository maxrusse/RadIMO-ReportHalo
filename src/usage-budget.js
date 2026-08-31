const fs = require("node:fs/promises");

// Deliberately conservative local guardrails for the first API build. Change only
// in this file until a user-facing settings screen is designed and tested.
const DEFAULT_DAILY_TOKEN_LIMIT = 250_000;
const DEFAULT_MONTHLY_TOKEN_LIMIT = 2_000_000;
const DEFAULT_USD_TO_EUR = 0.92;

// Public list prices used only for a local estimate. Azure prices can differ by
// region, contract, deployment, and billing tier, so the estimate is never an invoice.
const MODEL_PRICING_USD_PER_MILLION = Object.freeze({
  "gpt-5.6-luna": Object.freeze({ input: 0.20, cachedInput: 0.02, output: 1.20 }),
});

function finitePositive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function tokenCount(value) {
  if (value === null || value === undefined) return 0;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return Math.max(0, Math.ceil(Buffer.byteLength(String(text || ""), "utf8") / 4));
}

function dateKeys(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return { day: `${year}-${month}-${day}`, month: `${year}-${month}` };
}

function numeric(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function emptyStore() {
  return { version: 1, days: {}, months: {} };
}

function normalizeStore(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    version: 1,
    days: source.days && typeof source.days === "object" ? source.days : {},
    months: source.months && typeof source.months === "object" ? source.months : {},
  };
}

function normalizeUsage(responseUsage, fallbackInput, fallbackOutput) {
  const usage = responseUsage && typeof responseUsage === "object" ? responseUsage : {};
  const inputTokens = Math.max(0, Math.round(numeric(usage.input_tokens) || fallbackInput));
  const outputTokens = Math.max(0, Math.round(numeric(usage.output_tokens) || fallbackOutput));
  const cachedInputTokens = Math.min(inputTokens, Math.max(0, Math.round(numeric(usage.input_tokens_details?.cached_tokens))));
  return { inputTokens, outputTokens, cachedInputTokens, totalTokens: inputTokens + outputTokens };
}

function estimateCostEur({ model, inputTokens, cachedInputTokens = 0, outputTokens, usdToEur = DEFAULT_USD_TO_EUR } = {}) {
  const modelName = String(model || "").trim();
  const pricing = MODEL_PRICING_USD_PER_MILLION[modelName];
  if (!pricing) return { usd: null, eur: null, pricing: null, pricingModel: "unknown", pricingKnown: false };
  const input = Math.max(0, numeric(inputTokens));
  const cached = Math.min(input, Math.max(0, numeric(cachedInputTokens)));
  const output = Math.max(0, numeric(outputTokens));
  const usd = ((input - cached) * pricing.input + cached * pricing.cachedInput + output * pricing.output) / 1_000_000;
  return {
    usd,
    eur: usd * finitePositive(usdToEur, DEFAULT_USD_TO_EUR),
    pricing,
    pricingModel: modelName,
    pricingKnown: true,
  };
}

class UsageBudget {
  constructor({ filePath, dailyLimit = DEFAULT_DAILY_TOKEN_LIMIT, monthlyLimit = DEFAULT_MONTHLY_TOKEN_LIMIT, usdToEur = DEFAULT_USD_TO_EUR } = {}) {
    if (!filePath) throw new Error("Usage budget storage path is required.");
    this.filePath = filePath;
    this.dailyLimit = Math.max(1, Math.round(finitePositive(dailyLimit, DEFAULT_DAILY_TOKEN_LIMIT)));
    this.monthlyLimit = Math.max(1, Math.round(finitePositive(monthlyLimit, DEFAULT_MONTHLY_TOKEN_LIMIT)));
    this.usdToEur = finitePositive(usdToEur, DEFAULT_USD_TO_EUR);
    this.operationQueue = Promise.resolve();
    this.nextReservationId = 1;
    this.reservations = new Map();
  }

  #enqueue(operation) {
    const result = this.operationQueue.then(operation);
    this.operationQueue = result.catch(() => {});
    return result;
  }

  async #read() {
    try {
      return normalizeStore(JSON.parse(await fs.readFile(this.filePath, "utf8")));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      return emptyStore();
    }
  }

  async #write(store) {
    await fs.mkdir(require("node:path").dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(store, null, 2), { encoding: "utf8", mode: 0o600 });
  }

  async #check({ estimatedInputTokens = 0, reservedOutputTokens = 0 } = {}) {
    const { day, month } = dateKeys();
    const store = await this.#read();
    const daily = store.days[day] || { tokens: 0, estimatedEur: 0, requests: 0 };
    const monthly = store.months[month] || { tokens: 0, estimatedEur: 0, requests: 0 };
    const requested = Math.max(0, Math.round(numeric(estimatedInputTokens) + numeric(reservedOutputTokens)));
    const reserved = [...this.reservations.values()].filter((item) => item.day === day && item.month === month).reduce((total, item) => total + item.tokens, 0);
    const dailyRemaining = Math.max(0, this.dailyLimit - numeric(daily.tokens) - reserved);
    const monthlyRemaining = Math.max(0, this.monthlyLimit - numeric(monthly.tokens) - reserved);
    if (numeric(daily.tokens) + reserved + requested > this.dailyLimit) {
      throw new Error(`Lokales Tageslimit erreicht (${this.dailyLimit.toLocaleString("de-DE")} Token).`);
    }
    if (numeric(monthly.tokens) + reserved + requested > this.monthlyLimit) {
      throw new Error(`Lokales Monatslimit erreicht (${this.monthlyLimit.toLocaleString("de-DE")} Token).`);
    }
    const reservationId = `budget-${Date.now()}-${this.nextReservationId++}`;
    this.reservations.set(reservationId, { day, month, tokens: requested });
    return { requested, dailyRemaining: Math.max(0, dailyRemaining - requested), monthlyRemaining: Math.max(0, monthlyRemaining - requested), reservationId };
  }

  check(args = {}) {
    return this.#enqueue(() => this.#check(args));
  }

  release(reservationId) {
    if (!reservationId) return Promise.resolve(false);
    return this.#enqueue(() => this.reservations.delete(String(reservationId)));
  }

  record(args = {}) {
    return this.#enqueue(() => this.#record(args));
  }

  async #record({ model, usage, estimatedInputTokens = 0, estimatedOutputTokens = 0, reservationId = null } = {}) {
    try {
      const normalized = normalizeUsage(usage, estimatedInputTokens, estimatedOutputTokens);
      const estimate = estimateCostEur({ model, ...normalized, usdToEur: this.usdToEur });
      const { day, month } = dateKeys();
      const store = await this.#read();
      const daily = store.days[day] || { tokens: 0, estimatedEur: 0, requests: 0 };
      const monthly = store.months[month] || { tokens: 0, estimatedEur: 0, requests: 0 };
      for (const bucket of [daily, monthly]) {
        bucket.tokens = numeric(bucket.tokens) + normalized.totalTokens;
      bucket.estimatedEur = numeric(bucket.estimatedEur) + numeric(estimate.eur);
      bucket.pricingKnown = bucket.pricingKnown !== false && estimate.pricingKnown !== false;
        bucket.requests = numeric(bucket.requests) + 1;
      }
      store.days[day] = daily;
      store.months[month] = monthly;
      await this.#write(store);
      return { ...normalized, ...estimate, day, month };
    } finally {
      if (reservationId) this.reservations.delete(String(reservationId));
    }
  }

  async status() {
    return this.#enqueue(async () => {
      const { day, month } = dateKeys();
      const store = await this.#read();
      const daily = store.days[day] || { tokens: 0, estimatedEur: 0, requests: 0 };
      const monthly = store.months[month] || { tokens: 0, estimatedEur: 0, requests: 0 };
      const reserved = [...this.reservations.values()].filter((item) => item.day === day && item.month === month).reduce((total, item) => total + item.tokens, 0);
      return {
        enabled: true,
        currency: "EUR",
        estimateOnly: true,
        usdToEur: this.usdToEur,
        limits: { dailyTokens: this.dailyLimit, monthlyTokens: this.monthlyLimit },
        pricingKnown: daily.pricingKnown !== false && monthly.pricingKnown !== false,
        daily: { tokens: numeric(daily.tokens), reserved, remaining: Math.max(0, this.dailyLimit - numeric(daily.tokens) - reserved), estimatedEur: numeric(daily.estimatedEur), requests: numeric(daily.requests) },
        monthly: { tokens: numeric(monthly.tokens), reserved, remaining: Math.max(0, this.monthlyLimit - numeric(monthly.tokens) - reserved), estimatedEur: numeric(monthly.estimatedEur), requests: numeric(monthly.requests) },
      };
    });
  }
}

module.exports = {
  DEFAULT_DAILY_TOKEN_LIMIT,
  DEFAULT_MONTHLY_TOKEN_LIMIT,
  DEFAULT_USD_TO_EUR,
  MODEL_PRICING_USD_PER_MILLION,
  UsageBudget,
  dateKeys,
  estimateCostEur,
  tokenCount,
};
