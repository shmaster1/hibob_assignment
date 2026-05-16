/**
 * @NScriptType ScheduledScript
 * @NApiVersion 2.1
 */
define(['N/query', 'N/record', 'N/log'], (query, record, log) => {

  function getTopLevelCustomers() {
    const results = query.runSuiteQL({
      query: `
        SELECT c.id, c.name,
               CASE WHEN EXISTS (SELECT 1 FROM customer s WHERE s.parent = c.id)
                    THEN 'T' ELSE 'F' END AS isParent
        FROM customer c
        WHERE c.parent IS NULL
      `
    });
    return results.asMappedResults();
  }

  function calculateCumulativeAR(parentId, isParent) {
    const sql = isParent === 'T'
      ? `SELECT SUM(amountremaining) AS total_ar
         FROM transaction
         WHERE type = 'CustInvc'
           AND (entity = ? OR entity IN (SELECT id FROM customer WHERE parent = ?))
           AND status = 'Open'
           AND mainline = 'T'`
      : `SELECT SUM(amountremaining) AS total_ar
         FROM transaction
         WHERE type = 'CustInvc'
           AND entity = ?
           AND status = 'Open'
           AND mainline = 'T'`;
    try {
      const params = isParent === 'T' ? [parentId, parentId] : [parentId];
      const results = query.runSuiteQL({ query: sql, params });
      const rows = results.asMappedResults();
      return Number(rows[0]?.total_ar ?? 0);
    } catch (e) {
      log.error({ title: `AR calculation failed for customer ${parentId}`, details: e.message });
      return null;
    }
  }

  function updateParentRecord(parentId, amount) {
    try {
      record.submitFields({
        type: record.Type.CUSTOMER,
        id: parentId,
        values: { custentity_cumulative_ar: amount }
      });
      log.audit({ title: 'AR Updated', details: `Customer ${parentId} updated with $${amount}` });
    } catch (e) {
      log.error({ title: `Update failed for customer ${parentId}`, details: e.message });
    }
  }

  function execute() {
    const customers = getTopLevelCustomers();
    for (const customer of customers) {
      const total = calculateCumulativeAR(customer.id, customer.isParent);
      if (total !== null) {
        updateParentRecord(customer.id, total);
      }
    }
  }

  return { execute };
});
