import { useCallback, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { effectiveCan, type Capability } from '../utils/permissions';

export function usePermissions() {
  const { currentUser } = useAuth();
  const role = currentUser?.role;
  const disabled = currentUser?.disabled === true;
  const grants = (currentUser as any)?.capGrants;
  const denies = (currentUser as any)?.capDenies;

  const can = useCallback((capability: Capability) => {
    return effectiveCan(role, capability, { grants, denies }, { disabled });
  }, [role, disabled, JSON.stringify(grants), JSON.stringify(denies)]);

  return useMemo(() => ({
    role: role ?? null,
    isDisabled: disabled,
    can,
  }), [role, disabled, can]);
}
