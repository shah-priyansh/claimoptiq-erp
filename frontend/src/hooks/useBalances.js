import { useState, useCallback } from 'react';
import { getCashBankBalancesAPI } from '../services/api';

/**
 * Hook to fetch and manage cash/bank balances
 * @returns {Object} { balances, loading, fetchBalances, refreshBalances }
 */
export const useBalances = () => {
  const [balances, setBalances] = useState({
    cash: 0,
    bank: 0,
    upi: 0,
    total: 0,
  });
  const [loading, setLoading] = useState(false);

  /**
   * Fetch balances from API
   */
  const fetchBalances = useCallback(async () => {
    setLoading(true);
    try {
      const response = await getCashBankBalancesAPI();
      setBalances(response.data);
      return response.data;
    } catch (error) {
      console.error('Failed to fetch balances:', error);
      setBalances({ cash: 0, bank: 0, upi: 0, total: 0 });
      throw error;
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Refresh balances (alias for fetchBalances, for semantic clarity)
   */
  const refreshBalances = useCallback(async () => {
    return fetchBalances();
  }, [fetchBalances]);

  return { balances, loading, fetchBalances, refreshBalances };
};

export default useBalances;
