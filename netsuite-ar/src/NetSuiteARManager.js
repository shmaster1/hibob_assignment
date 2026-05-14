const axios = require('axios');

class NetSuiteARManager {
  constructor(accountId, tokenDetails) {
    this.baseUrl = `https://${accountId}.suitetalk.api.netsuite.com/services/rest`;
    this.suiteqlEndpoint = `${this.baseUrl}/query/v1/suiteql`;
    this.headers = {
      Authorization: `Bearer ${tokenDetails.token}`,
      'Content-Type': 'application/json',
    };
  }

  async getTopLevelCustomers() {
    const query = `SELECT id, entityid FROM customer WHERE parent IS NULL`;
    const customers = [];
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

  async calculateCumulativeAR(parentId) {
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
      const data = response.data.items?.[0] ?? { total_ar: 0 };
      return Number(data.total_ar ?? 0);
    } catch (error) {
      console.error(`Failed to calculate AR for parent ${parentId}:`, error);
      return null;
    }
  }

  async updateParentRecord(parentId, amount) {
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

  async runARConsolidation() {
    const customers = await this.getTopLevelCustomers();
    for (const customer of customers) {
      const totalAmount = await this.calculateCumulativeAR(customer.id);
      if (totalAmount !== null) {
        await this.updateParentRecord(customer.id, totalAmount);
      }
    }
  }
}

module.exports = { NetSuiteARManager };

