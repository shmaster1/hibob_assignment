import axios from 'axios';
import { NetSuiteARManager } from './NetSuiteARManager';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const manager = new NetSuiteARManager('test-account', { token: 'fake-token' });

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getTopLevelCustomers', () => {
  it('returns customers when API responds successfully', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        items: [
          { id: 1, entityid: '1 (HiBob HQ)' },
          { id: 4, entityid: '4 (Wix HQ)' },
          { id: 7, entityid: '7 (Monday.com)' },
        ],
        hasMore: false,
      },
    });

    const result = await manager.getTopLevelCustomers();
    expect(result).toHaveLength(3);
    expect(result[0].id).toBe(1);
  });

  it('fetches all pages when hasMore is true', async () => {
    mockedAxios.post
      .mockResolvedValueOnce({
        data: {
          items: [{ id: 1, entityid: '1 (HiBob HQ)' }],
          hasMore: true,
        },
      })
      .mockResolvedValueOnce({
        data: {
          items: [{ id: 4, entityid: '4 (Wix HQ)' }],
          hasMore: false,
        },
      });

    const result = await manager.getTopLevelCustomers();
    expect(result).toHaveLength(2);
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
  });

  it('throws when API fails', async () => {
    mockedAxios.post.mockRejectedValueOnce(new Error('Network error'));
    await expect(manager.getTopLevelCustomers()).rejects.toThrow('Network error');
  });
});

describe('calculateCumulativeAR', () => {
  it('returns summed AR for a parent and its children', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: { items: [{ total_ar: 23000 }] },
    });

    const result = await manager.calculateCumulativeAR(1);
    expect(result).toBe(23000);
  });

  it('returns 0 when customer has no open invoices', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: { items: [{ total_ar: null }] },
    });

    const result = await manager.calculateCumulativeAR(7);
    expect(result).toBe(0);
  });

  it('returns null when API fails so the update is skipped', async () => {
    mockedAxios.post.mockRejectedValueOnce(new Error('Timeout'));

    const result = await manager.calculateCumulativeAR(1);
    expect(result).toBeNull();
  });
});

describe('updateParentRecord', () => {
  it('logs success on 204 response', async () => {
    mockedAxios.patch.mockResolvedValueOnce({ status: 204 });
    const spy = jest.spyOn(console, 'info').mockImplementation(() => {});

    await manager.updateParentRecord(1, 23000);
    expect(spy).toHaveBeenCalledWith('Updated parent 1 with $23000');
    spy.mockRestore();
  });

  it('logs error on unexpected status', async () => {
    mockedAxios.patch.mockResolvedValueOnce({ status: 500 });
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await manager.updateParentRecord(1, 23000);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('Unexpected status'));
    spy.mockRestore();
  });
});

describe('runARConsolidation', () => {
  it('skips update when calculateCumulativeAR returns null', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: { items: [{ id: 1, entityid: '1 (HiBob HQ)' }], hasMore: false },
    });
    mockedAxios.post.mockRejectedValueOnce(new Error('AR query failed'));

    const patchSpy = jest.spyOn(mockedAxios, 'patch');
    await manager.runARConsolidation();
    expect(patchSpy).not.toHaveBeenCalled();
  });

  it('processes all customers and updates each one', async () => {
    mockedAxios.post
      .mockResolvedValueOnce({
        data: {
          items: [
            { id: 1, entityid: '1 (HiBob HQ)' },
            { id: 7, entityid: '7 (Monday.com)' },
          ],
          hasMore: false,
        },
      })
      .mockResolvedValueOnce({ data: { items: [{ total_ar: 23000 }] } })
      .mockResolvedValueOnce({ data: { items: [{ total_ar: 5000 }] } });

    mockedAxios.patch.mockResolvedValue({ status: 204 });

    await manager.runARConsolidation();
    expect(mockedAxios.patch).toHaveBeenCalledTimes(2);
  });
});
