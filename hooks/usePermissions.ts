import { useAuth } from '../contexts/AuthContext';
import { can, type Capability } from '../utils/permissions';

export function usePermissions() {
  const { currentUser } = useAuth();
  const role = currentUser?.role;
  const disabled = currentUser?.disabled === true;
  return {
    role: role ?? null,
    isDisabled: disabled,
    can: (capability: Capability) => {
      if (disabled) return false;
      return can(role, capability);
    },
  };
}
