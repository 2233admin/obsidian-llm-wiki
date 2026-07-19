import type {
  LocalIssueApplyReceipt,
  LocalIssueReceiptPort,
  Sha256Digest,
} from './contracts.js';

export class InMemoryLocalIssueReceiptStore implements LocalIssueReceiptPort {
  readonly #receipts = new Map<Sha256Digest, LocalIssueApplyReceipt>();

  get(
    _projectId: import('./contracts.js').ProjectId,
    transitionTokenDigest: Sha256Digest,
  ): LocalIssueApplyReceipt | undefined {
    const receipt = this.#receipts.get(transitionTokenDigest);
    return receipt ? structuredClone(receipt) : undefined;
  }

  put(receipt: LocalIssueApplyReceipt): void {
    this.#receipts.set(receipt.transitionTokenDigest, structuredClone(receipt));
  }
}
