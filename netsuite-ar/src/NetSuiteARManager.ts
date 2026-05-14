import axios from 'axios';
import { Customer, TokenDetails, ARQuery } from './types';

export class NetSuiteARManager {
  private baseUrl: string;
  private suiteqlEndpoint: string;
  private headers: Record<string, string>;

  constructor(accountId: string, tokenDetails: TokenDetails) {
    this.baseUrl = `https://${accountId}.suitetalk.api.netsuite.com/services/rest`;
    this.suiteqlEndpoint = `${this.baseUrl}/query/v1/suiteql`;
    this.headers = {
      Authorization: `Bearer ${tokenDetails.token}`,
      'Content-Type': 'application/json',
    };
  }

  async getTopLevelCustomers(): Promise<Customer[]> {
    const query = `SELECT id, entityid FROM customer WHERE parent IS NULL`;
    const customers: Customer[] = [];
    let offset = 0;
    const limit = 1000;

    while (true) {
      const response = await axios.post(
        `${this.suiteqlEndpoint}?limit=${limit}&offset=${offset}`,
        { q: query },
        { headers: this.headers }
      );
      const page = response.data;
      customers.push(...(page.items ?? []));
      if (!page.hasMore) break;
      offset += limit;
    }

    return customers;
  }

  async calculateCumulativeAR(parentId: number): Promise<number | null> {
    const query = `
      SELECT SUM(amountremaining) AS total_ar
      FROM transaction
      WHERE type = 'CustInvc'
      AND (entity = ${parentId} OR entity IN (SELECT id FROM customer WHERE parent = ${parentId}))
      AND status = 'open'
      AND mainline = 'T'
    `;

    try {
      const response = await axios.post(
        this.suiteqlEndpoint,
        { q: query },
        { headers: this.headers }
      );
      const data: ARQuery = response.data.items?.[0] ?? { total_ar: 0 };
      return Number(data.total_ar ?? 0);
    } catch (error) {
      console.error(`Failed to calculate AR for parent ${parentId}:`, error);
      return null;
    }
  }

  async updateParentRecord(parentId: number, amount: number): Promise<void> {
    const endpoint = `${this.baseUrl}/record/v1/customer/${parentId}`;

    try {
      const response = await axios.patch(
        endpoint,
        { custentity_cumulative_ar: amount },
        { headers: this.headers }
      );
      if (response.status === 204) {
        console.info(`Updated parent ${parentId} with $${amount}`);
      } else {
        console.error(`Unexpected status for parent ${parentId}: ${response.status}`);
      }
    } catch (error) {
      console.error(`Failed to update parent ${parentId}:`, error);
    }
  }

  async runARConsolidation(): Promise<void> {
    const customers = await this.getTopLevelCustomers();
    for (const customer of customers) {
      const totalAmount = await this.calculateCumulativeAR(customer.id);
      if (totalAmount !== null) {
        await this.updateParentRecord(customer.id, totalAmount);
      }
    }
  }
}

