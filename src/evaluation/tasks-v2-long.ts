// Generators for the long fixture files used by the v2 long-file and long-context
// tasks. The files are built at setup time from a fixed seed, so every run sees
// byte-identical content, and nothing large is stored in the repository.
//
// The filler is deliberately boring: it never mentions the facts a task needs,
// so the only way to find them is to read the section that holds them.

/** Small deterministic pseudo-random generator (a linear congruential generator). */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)] as T;
}

interface SentenceBank {
  subjects: readonly string[];
  verbs: readonly string[];
  objects: readonly string[];
  tails: readonly string[];
}

function sentence(random: () => number, bank: SentenceBank): string {
  return `${pick(random, bank.subjects)} ${pick(random, bank.verbs)} ${pick(random, bank.objects)} ${pick(random, bank.tails)}.`;
}

function paragraph(random: () => number, bank: SentenceBank): string {
  const count = 3 + Math.floor(random() * 3);
  return Array.from({ length: count }, () => sentence(random, bank)).join(' ');
}

/** A section of filler: a heading, a few paragraphs and sometimes a small table. */
type FillerSection = (random: () => number, index: number) => string;

export interface KeySection {
  /** The exact heading line, e.g. '## Invoice numbers (current format)'. */
  heading: string;
  body: string;
  /** Where the section starts, as a fraction of the document (0 = top, 1 = bottom). */
  at: number;
}

/**
 * Builds a markdown document of at least `targetChars` characters: filler
 * sections with the key sections inserted at the requested positions.
 */
export function buildDocument(options: { title: string; intro: string; seed: number; targetChars: number; filler: FillerSection; keys: KeySection[] }): string {
  const random = seeded(options.seed);
  const filler: string[] = [];
  let length = 0;
  while (length < options.targetChars) {
    const section = options.filler(random, filler.length + 1);
    filler.push(section);
    length += section.length + 2;
  }
  const sections = [...filler];
  // Insert from the bottom up so earlier insert positions stay valid.
  for (const key of [...options.keys].sort((a, b) => b.at - a.at)) {
    const index = Math.round(key.at * filler.length);
    sections.splice(index, 0, `${key.heading}\n\n${key.body}`);
  }
  return `# ${options.title}\n\n${options.intro}\n\n${sections.join('\n\n')}\n`;
}

function table(random: () => number, header: string[], rowCount: number, cell: (random: () => number, column: number) => string): string {
  const lines = [`| ${header.join(' | ')} |`, `|${header.map(() => '---').join('|')}|`];
  for (let row = 0; row < rowCount; row += 1) lines.push(`| ${header.map((_, column) => cell(random, column)).join(' | ')} |`);
  return lines.join('\n');
}

// ---------------------------------------------------------------- V13 billing handbook

const billingBank: SentenceBank = {
  subjects: ['The billing team', 'Finance operations', 'The account owner', 'A customer success manager', 'The automated scheduler', 'The regional controller', 'The collections desk'],
  verbs: ['reviews', 'approves', 'records', 'reconciles', 'flags', 'archives', 'escalates', 'confirms'],
  objects: ['every credit note', 'the monthly statement', 'disputed charges', 'prorated adjustments', 'usage overages', 'refund requests', 'the payment schedule', 'purchase order references'],
  tails: ['before the period closes', 'within five business days', 'when the customer asks in writing', 'for enterprise accounts only', 'unless a manager has signed off', 'at the end of each quarter', 'after the ledger has been reconciled'],
};

const billingTopics = ['Payment terms', 'Credit notes', 'Late fees', 'Tax rounding', 'Refund approvals', 'Currency conversion', 'Dispute handling', 'Proration', 'Usage metering', 'Account suspension', 'Discount stacking', 'Billing contacts', 'Purchase orders', 'Statement delivery', 'Write-offs', 'Deposit handling'];

const billingFiller: FillerSection = (random, index) => {
  const topic = pick(random, billingTopics);
  const parts = [`## ${index}. ${topic}: rule B-${100 + index}`, paragraph(random, billingBank), paragraph(random, billingBank)];
  if (random() < 0.5) {
    parts.push(table(random, ['Plan', 'Threshold', 'Action'], 4, (r, column) => (column === 0 ? pick(r, ['Starter', 'Team', 'Business', 'Enterprise']) : column === 1 ? `${Math.floor(r() * 90 + 10)} days` : pick(r, ['email reminder', 'manager review', 'hold new orders', 'no action']))));
  }
  parts.push(paragraph(random, billingBank));
  return parts.join('\n\n');
};

export const INVOICE_FORMAT_HEADING = '## Invoice numbers (current format)';

export function billingRulesDocument(): string {
  return buildDocument({
    title: 'Billing rules handbook',
    intro: 'This handbook collects the rules the billing team follows. Rules are numbered; when two rules disagree, the one marked current wins.',
    seed: 1301,
    targetChars: 60_000,
    filler: billingFiller,
    keys: [
      {
        heading: '## Invoice numbers (legacy format, retired 2024)',
        body: 'Before 2025, invoice numbers were written as the two-digit year, a slash and the sequence number, for example 24/1234. This format is retired: do not use it for new invoices. The current format is described later in this handbook.',
        at: 0.08,
      },
      {
        heading: INVOICE_FORMAT_HEADING,
        body: [
          'Since 1 January 2025 every new invoice number has the form `INV-<year>-<sequence>-<check>`:',
          '',
          '- `<year>` is the four-digit calendar year.',
          '- `<sequence>` is the invoice\'s sequence number within that year, padded with leading zeros to exactly six digits.',
          '- `<check>` is one check letter. Add up the decimal digits of the sequence number and take the remainder after dividing by 10. Use that remainder as an index (0 = first letter) into the letters A B C D E F G H J K (the letter I is skipped so it cannot be confused with 1).',
          '',
          'Sequence numbers start at 1 and must not exceed 999999. Any other sequence number, including one that is not a whole number, is an error and no invoice number may be produced for it.',
          '',
          'Example: year 2025, sequence 1234. The digit sum is 10, the remainder is 0, so the check letter is A and the invoice number is INV-2025-001234-A.',
        ].join('\n'),
        at: 0.5,
      },
    ],
  });
}

// ---------------------------------------------------------------- V14 ledger client

const ledgerResources = [
  ['Account', 'accounts'], ['Journal', 'journals'], ['Period', 'periods'], ['CurrencyRate', 'currency-rates'], ['AuditEvent', 'audit-events'],
  ['Reconciliation', 'reconciliations'], ['CostCentre', 'cost-centres'], ['TaxCode', 'tax-codes'], ['Budget', 'budgets'], ['Vendor', 'vendors'],
  ['Payout', 'payouts'], ['Statement', 'statements'], ['Attachment', 'attachments'], ['Approval', 'approvals'], ['Schedule', 'schedules'],
  ['Allocation', 'allocations'], ['Accrual', 'accruals'], ['Dimension', 'dimensions'], ['Template', 'templates'], ['Export', 'exports'],
  ['Mapping', 'mappings'], ['Snapshot', 'snapshots'], ['Lock', 'locks'], ['Note', 'notes'], ['Tag', 'tags'], ['Webhook', 'webhooks'],
  ['ImportJob', 'import-jobs'], ['Rule', 'rules'], ['Forecast', 'forecasts'], ['Entity', 'entities'],
] as const;

function ledgerMethods(resources: ReadonlyArray<readonly [string, string]>): string {
  const blocks: string[] = [];
  for (const [type, collection] of resources) {
    blocks.push(
      [
        '  /**',
        `   * Lists the ${collection} stored for \`scope\`. Archived ${collection} are left out unless`,
        '   * `includeArchived` is true. Results are sorted by id.',
        '   */',
        `  public list${type}s(scope: string, includeArchived = false): string[] {`,
        `    return this.keysFor('${collection}', scope, includeArchived);`,
        '  }',
        '',
        '  /**',
        `   * Returns one ${type.toLowerCase()} record, or undefined when \`id\` is unknown in \`scope\`.`,
        '   */',
        `  public get${type}(scope: string, id: string): Record<string, unknown> | undefined {`,
        `    return this.getRecord('${collection}', scope, id);`,
        '  }',
        '',
        '  /**',
        `   * Creates or replaces a ${type.toLowerCase()} record. The record is stored as a copy, so later`,
        '   * changes to `fields` do not affect it.',
        '   */',
        `  public save${type}(scope: string, id: string, fields: Record<string, unknown>): void {`,
        `    this.putRecord('${collection}', scope, id, fields);`,
        '  }',
        '',
        '  /**',
        `   * Archives a ${type.toLowerCase()} record. Archived records stay readable but are hidden from list${type}s.`,
        '   */',
        `  public archive${type}(scope: string, id: string): boolean {`,
        `    return this.setArchived('${collection}', scope, id, true);`,
        '  }',
        '',
        '  /**',
        `   * Restores an archived ${type.toLowerCase()} record. Returns false when there was nothing to restore.`,
        '   */',
        `  public restore${type}(scope: string, id: string): boolean {`,
        `    return this.setArchived('${collection}', scope, id, false);`,
        '  }',
      ].join('\n'),
    );
  }
  return blocks.join('\n\n');
}

const postEntryMethod = [
  '  /**',
  '   * Posts one entry to an account. This replaces the v2 `post()` method.',
  '   *',
  '   * The input object has exactly these fields:',
  '   * - `accountId`: the account to post to (for a customer, the customer id).',
  "   * - `kind`: 'debit' when money is taken from the account, 'credit' when money is given back to it.",
  '   * - `amountCents`: a positive whole number of cents. The direction comes from `kind`, never from the',
  '   *   sign of the amount, so a debit of 12.50 dollars is { kind: \'debit\', amountCents: 1250 }.',
  '   * - `memo`: a short description that is stored with the entry.',
  '   *',
  '   * Throws when any field is missing or invalid.',
  '   */',
  "  public postEntry(input: { accountId: string; kind: 'debit' | 'credit'; amountCents: number; memo: string }): void {",
  "    const validKind = input.kind === 'debit' || input.kind === 'credit';",
  "    if (!input.accountId || !validKind || !Number.isInteger(input.amountCents) || input.amountCents <= 0 || typeof input.memo !== 'string') {",
  "      throw new Error('Invalid ledger entry.');",
  '    }',
  '    this.stored.push({ accountId: input.accountId, kind: input.kind, amountCents: input.amountCents, memo: input.memo });',
  '  }',
].join('\n');

export function ledgerClientSource(): string {
  const half = Math.floor(ledgerResources.length / 2);
  return [
    '// Ledger client, API version 3 (in-memory implementation used in development and tests).',
    '',
    'export interface StoredEntry {',
    '  accountId: string;',
    '  kind: string;',
    '  amountCents: number;',
    '  memo: string;',
    '}',
    '',
    'interface StoredRecord {',
    '  fields: Record<string, unknown>;',
    '  archived: boolean;',
    '}',
    '',
    'export class LedgerClient {',
    '  private readonly stored: StoredEntry[] = [];',
    '  private readonly records = new Map<string, StoredRecord>();',
    '',
    '  /** Every entry posted so far, oldest first. Returns copies. */',
    '  public entries(): StoredEntry[] {',
    '    return this.stored.map((entry) => ({ ...entry }));',
    '  }',
    '',
    '  /** @deprecated Removed in v3. It only remains so that old callers fail with a clear message. */',
    '  public post(_accountId: string, _amount: number): never {',
    "    throw new Error('post() was removed in ledger v3; use postEntry() instead.');",
    '  }',
    '',
    '  private key(collection: string, scope: string, id: string): string {',
    "    return collection + '/' + scope + '/' + id;",
    '  }',
    '',
    '  private keysFor(collection: string, scope: string, includeArchived: boolean): string[] {',
    "    const prefix = collection + '/' + scope + '/';",
    '    return [...this.records.entries()]',
    '      .filter(([key, record]) => key.startsWith(prefix) && (includeArchived || !record.archived))',
    '      .map(([key]) => key.slice(prefix.length))',
    '      .sort();',
    '  }',
    '',
    '  private getRecord(collection: string, scope: string, id: string): Record<string, unknown> | undefined {',
    '    const record = this.records.get(this.key(collection, scope, id));',
    '    return record ? { ...record.fields } : undefined;',
    '  }',
    '',
    '  private putRecord(collection: string, scope: string, id: string, fields: Record<string, unknown>): void {',
    '    this.records.set(this.key(collection, scope, id), { fields: { ...fields }, archived: false });',
    '  }',
    '',
    '  private setArchived(collection: string, scope: string, id: string, archived: boolean): boolean {',
    '    const record = this.records.get(this.key(collection, scope, id));',
    '    if (!record || record.archived === archived) return false;',
    '    record.archived = archived;',
    '    return true;',
    '  }',
    '',
    ledgerMethods(ledgerResources.slice(0, half)),
    '',
    postEntryMethod,
    '',
    ledgerMethods(ledgerResources.slice(half)),
    '}',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------- V15 report modules

const productAdjectives = ['Walnut', 'Oak', 'Steel', 'Copper', 'Linen', 'Ceramic', 'Bamboo', 'Glass', 'Slate', 'Cork', 'Brass', 'Felt'];
const productNouns = ['desk organiser', 'lamp', 'bookend', 'coaster set', 'pen tray', 'planter', 'clock', 'notebook', 'mug', 'shelf', 'tray', 'frame'];
const warehouseCities = ['Leeds', 'Lyon', 'Porto', 'Gdansk', 'Bremen', 'Turin', 'Ghent', 'Malmo', 'Cork', 'Brno', 'Bilbao', 'Graz'];
const departments = ['Finance', 'Support', 'Platform', 'Design', 'Sales', 'Legal', 'Research', 'Facilities'];

function rows(count: number, start: number, row: (index: number, random: () => number) => string, seed: number): string {
  const random = seeded(seed);
  return Array.from({ length: count }, (_, offset) => `  ${row(start + offset, random)},`).join('\n');
}

const pad = (value: number, width: number): string => String(value).padStart(width, '0');

function salesRow(index: number, random: () => number): string {
  return `['SKU-${pad(index, 5)}', '${pick(random, productAdjectives)} ${pick(random, productNouns)}', ${Math.floor(random() * 9000 + 500)}]`;
}

function binRow(index: number, random: () => number): string {
  return `['BIN-${pad(index, 5)}', '${pick(random, warehouseCities)}', 'aisle ${Math.floor(random() * 40 + 1)}', ${Math.floor(random() * 500)}]`;
}

function staffRow(index: number, random: () => number): string {
  return `['E${pad(index, 5)}', '${pick(random, departments)}', 'grade ${Math.floor(random() * 9 + 1)}', ${2015 + Math.floor(random() * 11)}]`;
}

/** How many table rows each half of a report file gets: about 62K characters per file. */
const REPORT_ROWS = 700;

export function salesReportSource(): string {
  return [
    "import { legacyFormat } from '../money';",
    '',
    '/** One line of the daily sales report, e.g. "Oak lamp: 3 x <unit price> = <line total>". */',
    'export function salesLine(sku: string, units: number, unitCents: number): string {',
    "  return productName(sku) + ': ' + units + ' x ' + legacyFormat(unitCents) + ' = ' + legacyFormat(units * unitCents);",
    '}',
    '',
    '/** Product catalogue, first half: [sku, name, list price in cents]. Generated from the product database. */',
    'const PRODUCTS_A: Array<[string, string, number]> = [',
    rows(REPORT_ROWS, 1, salesRow, 1501),
    '];',
    '',
    '/** The total line for one sales region in the weekly summary. */',
    'export function regionTotal(region: string, amountsCents: number[]): string {',
    '  const total = amountsCents.reduce((sum, value) => sum + value, 0);',
    "  return 'Region ' + region + ': ' + legacyFormat(total);",
    '}',
    '',
    '/** Product catalogue, second half. */',
    'const PRODUCTS_B: Array<[string, string, number]> = [',
    rows(REPORT_ROWS, REPORT_ROWS + 1, salesRow, 1502),
    '];',
    '',
    'const NAMES = new Map([...PRODUCTS_A, ...PRODUCTS_B].map(([sku, name]) => [sku, name] as const));',
    '',
    '/** The catalogue name of a product, or "Unknown product". */',
    'export function productName(sku: string): string {',
    "  return NAMES.get(sku) ?? 'Unknown product';",
    '}',
    '',
  ].join('\n');
}

export function inventoryReportSource(): string {
  return [
    "import { legacyFormat } from '../money';",
    '',
    '/** Stock value line for one warehouse in the inventory report. */',
    'export function stockValueLine(warehouse: string, valueCents: number): string {',
    "  return 'Stock at ' + warehouse + ': ' + legacyFormat(valueCents);",
    '}',
    '',
    '/** Bin locations, first half: [bin, city, aisle, capacity]. Generated from the warehouse system. */',
    'const BINS_A: Array<[string, string, string, number]> = [',
    rows(REPORT_ROWS, 1, binRow, 1503),
    '];',
    '',
    '/** Cost of reordering `quantity` units of a product, as shown in the reorder report. */',
    'export function reorderCostLine(sku: string, quantity: number, unitCents: number): string {',
    "  return 'Reorder ' + quantity + ' x ' + sku + ': ' + legacyFormat(quantity * unitCents);",
    '}',
    '',
    '/** Bin locations, second half. */',
    'const BINS_B: Array<[string, string, string, number]> = [',
    rows(REPORT_ROWS, REPORT_ROWS + 1, binRow, 1504),
    '];',
    '',
    '/** Number of bins known for a city. */',
    'export function binCount(city: string): number {',
    '  return [...BINS_A, ...BINS_B].filter(([, binCity]) => binCity === city).length;',
    '}',
    '',
  ].join('\n');
}

export function payrollReportSource(): string {
  return [
    "import { legacyFormat } from '../money';",
    '',
    '/** One payslip line: employee id and gross pay. */',
    'export function payslipLine(employeeId: string, grossCents: number): string {',
    "  return employeeId + ' gross pay ' + legacyFormat(grossCents);",
    '}',
    '',
    '/** Staff directory, first half: [employee id, department, grade, start year]. Generated from HR data. */',
    'const STAFF_A: Array<[string, string, string, number]> = [',
    rows(REPORT_ROWS, 1, staffRow, 1505),
    '];',
    '',
    '/** One bonus line in the year-end payroll report. */',
    'export function bonusLine(employeeId: string, bonusCents: number): string {',
    "  return 'Bonus for ' + employeeId + ': ' + legacyFormat(bonusCents);",
    '}',
    '',
    '/** Staff directory, second half. */',
    'const STAFF_B: Array<[string, string, string, number]> = [',
    rows(REPORT_ROWS, REPORT_ROWS + 1, staffRow, 1506),
    '];',
    '',
    '/** The department of an employee, or undefined. */',
    'export function departmentOf(employeeId: string): string | undefined {',
    '  return [...STAFF_A, ...STAFF_B].find(([id]) => id === employeeId)?.[1];',
    '}',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------- V16 gateway documentation

const gatewayBank: SentenceBank = {
  subjects: ['The gateway', 'A merchant integration', 'The settlement service', 'The fraud screen', 'A connected account', 'The reporting API', 'The webhook dispatcher'],
  verbs: ['returns', 'validates', 'stores', 'signs', 'rejects', 'reconciles', 'publishes', 'normalises'],
  objects: ['the authorisation response', 'webhook payloads', 'settlement batches', 'card-present transactions', 'merchant metadata', 'payout reports', 'refund objects', 'dispute evidence'],
  tails: ['for every live-mode request', "in the merchant's settlement currency", 'within one business day', 'when the request is signed', 'for test-mode keys as well', 'after the batch is closed', 'unless the merchant opted out'],
};

const gatewayEndpoints = ['payments', 'refunds', 'payouts', 'disputes', 'customers', 'mandates', 'balances', 'settlements', 'webhooks', 'reports'];
const gatewayActions = ['create', 'retrieve', 'list', 'update', 'cancel', 'capture', 'confirm', 'export'];
const errorWords = ['card', 'mandate', 'payout', 'customer', 'currency', 'amount', 'merchant', 'webhook', 'balance', 'refund'];
const errorProblems = ['not_found', 'invalid', 'expired', 'locked', 'mismatch', 'unsupported', 'duplicate', 'missing'];
const finalStatuses = [400, 401, 402, 403, 404, 410, 422];

const gatewayEndpointFiller: FillerSection = (random, index) => {
  const endpoint = pick(random, gatewayEndpoints);
  const action = pick(random, gatewayActions);
  return [
    `### ${index}. ${action} ${endpoint} (POST /v3/${endpoint}/${action})`,
    paragraph(random, gatewayBank),
    table(random, ['Field', 'Type', 'Required', 'Notes'], 5, (r, column) => (column === 0 ? `${pick(r, errorWords)}_${pick(r, ['id', 'reference', 'label', 'code', 'note'])}` : column === 1 ? pick(r, ['string', 'integer', 'boolean', 'object']) : column === 2 ? pick(r, ['yes', 'no']) : pick(r, ['max 64 characters', 'ISO 4217 code', 'set by the gateway', 'defaults to false', 'must be unique per merchant']))),
    paragraph(random, gatewayBank),
  ].join('\n\n');
};

const gatewayErrorFiller: FillerSection = (random, index) => {
  const code = `${pick(random, errorWords)}_${pick(random, errorProblems)}`;
  return [
    `### ${index}. Error \`${code}\``,
    `HTTP status: ${pick(random, finalStatuses)}.`,
    paragraph(random, gatewayBank),
    paragraph(random, gatewayBank),
  ].join('\n\n');
};

export const RETRY_HEADINGS = {
  budget: '## Client retry budget',
  statuses: '## Retryable statuses',
  backoff: '## Backoff schedule',
} as const;

export function gatewayOverviewDocument(): string {
  return buildDocument({
    title: 'Payments gateway v3: overview',
    intro: 'This document describes the v3 payments gateway API for merchant integrations. Part 2 lists status codes and errors; part 3 describes timing.',
    seed: 1601,
    targetChars: 100_000,
    filler: gatewayEndpointFiller,
    keys: [{
      heading: RETRY_HEADINGS.budget,
      body: 'A v3 client attempts a request at most 4 times in total: the first attempt plus up to 3 retries. After the fourth attempt the client must report the last error to its caller and stop.',
      at: 0.5,
    }],
  });
}

export function gatewayStatusDocument(): string {
  return buildDocument({
    title: 'Payments gateway v3: status codes and errors',
    intro: 'Every error response has a JSON body with a machine-readable `code`. This reference lists the codes in no particular order.',
    seed: 1602,
    targetChars: 100_000,
    filler: gatewayErrorFiller,
    keys: [
      {
        heading: '## Legacy v1 client behaviour (removed)',
        body: 'The v1 SDKs retried 500, 502, 503 and 504 with a fixed delay of one second. That behaviour was removed in 2024 and must not be used by v3 clients; the current list is in the section "Retryable statuses".',
        at: 0.06,
      },
      {
        heading: RETRY_HEADINGS.statuses,
        body: 'Only these HTTP statuses may be retried by a v3 client: 409, 425, 429, 503 and 522. Every other status, including 500, 502 and 504, is final and must not be retried.',
        at: 0.5,
      },
    ],
  });
}

export function gatewayBackoffDocument(): string {
  return buildDocument({
    title: 'Payments gateway v3: timing, limits and backoff',
    intro: 'This part describes request limits and how long a client waits between attempts.',
    seed: 1603,
    targetChars: 100_000,
    filler: gatewayEndpointFiller,
    keys: [{
      heading: RETRY_HEADINGS.backoff,
      body: 'Before retry number n (n = 1 for the first retry) a v3 client waits 350 ms multiplied by 3 to the power (n - 1), but never longer than 9000 ms. So the first retry waits 350 ms and the second waits 1050 ms. No random jitter is added.',
      at: 0.5,
    }],
  });
}

// ---------------------------------------------------------------- V17 protocol documentation

const protocolBank: SentenceBank = {
  subjects: ['The device', 'The base station', 'A sensor node', 'The gateway firmware', 'The pairing service', 'A repeater'],
  verbs: ['sends', 'acknowledges', 'buffers', 'discards', 'forwards', 'timestamps', 'records'],
  objects: ['status messages', 'configuration updates', 'sensor readings', 'firmware chunks', 'pairing requests', 'heartbeat messages', 'alarm events'],
  tails: ['once per reporting interval', 'when the link is idle', 'after a successful pairing', 'unless the queue is full', 'in the order they were received', 'while the device is charging'],
};

const messageNames = ['DeviceStatus', 'SensorReading', 'ConfigUpdate', 'FirmwareChunk', 'PairRequest', 'Heartbeat', 'AlarmEvent', 'ClockSync', 'BatteryReport', 'LinkQuality'];

const protocolFiller: FillerSection = (random, index) => {
  const id = Math.floor(random() * 200 + 16).toString(16).toUpperCase();
  return [
    `### ${index}. Message type 0x${id}: ${pick(random, messageNames)}`,
    paragraph(random, protocolBank),
    table(random, ['Field', 'Offset', 'Size', 'Description'], 5, (r, column) => (column === 0 ? pick(r, ['flags', 'reading', 'unit', 'channel', 'sequence', 'level', 'interval']) : column === 1 ? String(Math.floor(r() * 30)) : column === 2 ? pick(r, ['1', '2', '4']) : pick(r, ['unsigned', 'signed, two\'s complement', 'bit field', 'reserved, send 0']))),
    paragraph(random, protocolBank),
  ].join('\n\n');
};

export const PROTOCOL_HEADINGS = {
  header: '## Frame header',
  escaping: '## Byte stuffing',
  checksum: '## Frame checksum',
} as const;

export function framingDocument(): string {
  return buildDocument({
    title: 'Sensor link protocol v2, part 1: framing and message types',
    intro: 'A frame carries one message. Part 2 describes byte stuffing and part 3 the checksum.',
    seed: 1701,
    targetChars: 100_000,
    filler: protocolFiller,
    keys: [
      {
        heading: '## v1 frames (retired)',
        body: 'Protocol v1 used a one-byte length and the start byte 0xAA. v1 frames are no longer accepted by any receiver and must not be produced.',
        at: 0.05,
      },
      {
        heading: PROTOCOL_HEADINGS.header,
        body: 'Every v2 frame starts with the start byte 0x7E, followed by the payload length as an unsigned 16-bit big-endian integer (high byte first). The length counts the payload bytes before byte stuffing. A payload longer than 65535 bytes cannot be framed: the encoder must throw a RangeError. Example: a 5-byte payload has the header 7E 00 05.',
        at: 0.5,
      },
    ],
  });
}

export function escapingDocument(): string {
  return buildDocument({
    title: 'Sensor link protocol v2, part 2: byte stuffing',
    intro: 'Receivers find frame boundaries by looking for the start byte, so the payload must never contain it.',
    seed: 1702,
    targetChars: 100_000,
    filler: protocolFiller,
    keys: [{
      heading: PROTOCOL_HEADINGS.escaping,
      body: 'Inside the payload, each byte 0x7E and each byte 0x7D is replaced by two bytes: 0x7D followed by the original byte XOR 0x20. So 0x7E becomes 7D 5E and 0x7D becomes 7D 5D. No other byte is changed. The header and the checksum are never stuffed. Example: the payload 41 7E is sent as 41 7D 5E.',
      at: 0.5,
    }],
  });
}

export function checksumDocument(): string {
  return buildDocument({
    title: 'Sensor link protocol v2, part 3: checksum',
    intro: 'Every frame ends with a checksum so receivers can drop corrupted frames.',
    seed: 1703,
    targetChars: 100_000,
    filler: protocolFiller,
    keys: [
      {
        heading: '## CRC-8 (protocol v1, retired)',
        body: 'Protocol v1 frames ended with a single CRC-8 byte (polynomial 0x07). v2 frames do not use CRC-8.',
        at: 0.05,
      },
      {
        heading: PROTOCOL_HEADINGS.checksum,
        body: 'The v2 checksum is Fletcher-16 over the payload before byte stuffing. Start with sum1 = 0 and sum2 = 0. For each payload byte, in order: sum1 = (sum1 + byte) mod 255, then sum2 = (sum2 + sum1) mod 255. The frame ends with two bytes: sum2 first, then sum1. Example: for the payload 10 20 the sums end as sum1 = 0x30 and sum2 = 0x40, so the frame ends with 40 30.',
        at: 0.5,
      },
    ],
  });
}
