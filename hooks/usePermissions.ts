import { useCallback, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { effectiveCan, type Capability } from '../utils/permissions';

export function usePermissions() {
  const { currentUser } = useAuth();

  const can = useCallback((capability: Capability) => {
    const role = (currentUser as any)?.role;
    const disabled = (currentUser as any)?.disabled === true;
    const grants = (currentUser as any)?.capGrants;
    const denies = (currentUser as any)?.capDenies;
    return effectiveCan(role, capability, { grants, denies }, { disabled });
  }, [currentUser]);

  return useMemo(() => ({
    role: (currentUser as any)?.role ?? null,
    isDisabled: (currentUser as any)?.disabled === true,
    can,
  }), [currentUser, can]);
}
