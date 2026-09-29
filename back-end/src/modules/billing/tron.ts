import config from "../../config";

/**
 * Reading USDT transfers into our TRON wallet, from TronGrid.
 *
 * Only transfers of the configured contract are returned, checked by
 * contract address: anyone can deploy a worthless token and call it "USDT",
 * and its transfers must never count as payment. Only confirmed (solidified)
 * transfers are read, so a transfer cannot be paid for and then vanish.
 */

export type IncomingTransfer = {
  txHash: string;
  /** Position among our transfers in the same transaction (usually 0). */
  eventIndex: number;
  from: string;
  to: string;
  tokenContract: string;
  units: number;
  blockTime: Date;
};

export interface TronSource {
  /** Confirmed transfers of `contract` to `address` since `since`, oldest first. */
  incoming(address: string, contract: string, since: Date): Promise<IncomingTransfer[]>;
  /** The block a transaction is in. Asked only for transfers not seen before. */
  blockNumberOf(txHash: string): Promise<number>;
}

type Trc20Row = {
  transaction_id: string;
  token_info: { address: string; decimals: number; symbol: string };
  block_timestamp: number;
  from: string;
  to: string;
  type: string;
  value: string;
};

export class TronGrid implements TronSource {
  constructor(
    private readonly baseUrl = config.crypto.tronGridUrl,
    private readonly apiKey = config.crypto.tronGridApiKey,
  ) {}

  private async get<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, {
      ...init,
      headers: {
        accept: "application/json",
        ...(this.apiKey ? { "TRON-PRO-API-KEY": this.apiKey } : {}),
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`TronGrid answered HTTP ${response.status}`);
    return (await response.json()) as T;
  }

  /** The trc20 listing leaves the block out; the transaction's info has it. */
  async blockNumberOf(txHash: string) {
    const info = await this.get<{ blockNumber?: number }>(`${this.baseUrl}/wallet/gettransactioninfobyid`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: txHash }),
    });
    return info.blockNumber ?? 0;
  }

  async incoming(address: string, contract: string, since: Date) {
    const rows: Trc20Row[] = [];
    let url: string | undefined =
      `${this.baseUrl}/v1/accounts/${address}/transactions/trc20?` +
      new URLSearchParams({
        only_to: "true",
        only_confirmed: "true",
        contract_address: contract,
        min_timestamp: String(since.getTime()),
        order_by: "block_timestamp,asc",
        limit: "200",
      });
    for (let page = 0; url && page < 20; page += 1) {
      const body: { data: Trc20Row[]; meta?: { links?: { next?: string } } } = await this.get(url);
      rows.push(...body.data);
      url = body.meta?.links?.next;
    }

    const seen = new Map<string, number>();
    const transfers: IncomingTransfer[] = [];
    for (const row of rows) {
      // Checked again here, whatever the query asked for.
      if (row.type !== "Transfer" || row.to !== address || row.token_info.address !== contract) continue;
      const units = Number(row.value);
      if (!Number.isSafeInteger(units) || units <= 0) continue;
      const eventIndex = seen.get(row.transaction_id) ?? 0;
      seen.set(row.transaction_id, eventIndex + 1);
      transfers.push({
        txHash: row.transaction_id,
        eventIndex,
        from: row.from,
        to: row.to,
        tokenContract: row.token_info.address,
        units,
        blockTime: new Date(row.block_timestamp),
      });
    }
    return transfers;
  }
}

let source: TronSource | undefined;

export const tronSource = (): TronSource => (source ??= new TronGrid());

/** Test seam. */
export const setTronSource = (replacement: TronSource | null) => {
  source = replacement ?? undefined;
};
