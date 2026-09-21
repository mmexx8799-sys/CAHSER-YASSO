import React, { useState, useEffect, useMemo } from 'react';
import { useConfirmation } from './ConfirmationProvider';
import { UserRole } from '../types';
import type { User } from '../types';
import { can, OVERRIDABLE_CAPS } from '../utils/permissions';
import { effectiveCan } from '../utils/permissions';
import { CAP_LABELS_AR, statesToLists, listsToStates, type CapStates } from '../utils/capOverrides';
import { collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { getDB } from '../services/firebase';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  user: User | null;
  onSave: (grants: string[], denies: string[]) => Promise<void>;
}

export const PermissionEditorModal: React.FC<Props> = ({ isOpen, onClose, user, onSave }) => {
  const { confirm } = useConfirmation();
  const [states, setStates] = useState<CapStates>({});
  const [saving, setSaving] = useState(false);
  const [audit, setAudit] = useState<any[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  useEffect(() => {
    if (isOpen && user) {
      setStates(listsToStates(user.capGrants, user.capDenies, user.role));
      // fetch last 5 audit
      setAuditLoading(true);
      const q = query(collection(getDB(), 'permissionAudit'), where('targetUid', '==', user.uid), orderBy('at', 'desc'), limit(5));
      getDocs(q).then(snap => {
        setAudit(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      }).catch(() => setAudit([])).finally(() => setAuditLoading(false));
    }
  }, [isOpen, user]);

  const role = user?.role;
  const isAccountant = role === UserRole.Accountant;

  const { grantsPreview, deniesPreview } = useMemo(() => {
    const g: string[] = [];
    const d: string[] = [];
    for (const [cap, st] of Object.entries(states)) {
      if (st === 'grant') g.push(cap);
      if (st === 'deny') d.push(cap);
    }
    return { grantsPreview: g, deniesPreview: d };
  }, [states]);

  if (!isOpen || !user) return null;

  const handleChange = (cap: string, val: CapStates[string]) => {
    setStates(prev => ({ ...prev, [cap]: val }));
  };

  const handleSave = async () => {
    const { grants, denies } = statesToLists(role, states);
    const beforeGrants = user.capGrants || [];
    const beforeDenies = user.capDenies || [];
    const addedGrants = grants.filter(c => !beforeGrants.includes(c));
    const removedGrants = beforeGrants.filter(c => !grants.includes(c));
    const addedDenies = denies.filter(c => !beforeDenies.includes(c));
    const removedDenies = beforeDenies.filter(c => !denies.includes(c));
    const lines: string[] = [];
    if (addedGrants.length) lines.push(`منح: ${addedGrants.map(c => CAP_LABELS_AR[c] || c).join(', ')}`);
    if (removedGrants.length) lines.push(`إلغاء منح: ${removedGrants.map(c => CAP_LABELS_AR[c] || c).join(', ')}`);
    if (addedDenies.length) lines.push(`منع: ${addedDenies.map(c => CAP_LABELS_AR[c] || c).join(', ')}`);
    if (removedDenies.length) lines.push(`إلغاء منع: ${removedDenies.map(c => CAP_LABELS_AR[c] || c).join(', ')}`);
    if (lines.length === 0) {
      onClose();
      return;
    }
    const ok = await confirm({ title: 'تأكيد تحديث الصلاحيات', message: lines.join('\n') });
    if (!ok) return;
    setSaving(true);
    try {
      await onSave(grants, denies);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const renderCap = (cap: string) => {
    const base = can(role as any, cap as any);
    const tier = (OVERRIDABLE_CAPS as any)[cap];
    const state = states[cap] || 'default';
    const effective = effectiveCan(role as any, cap as any, { grants: grantsPreview, denies: deniesPreview }, { disabled: !!user.disabled });
    const isWrite = tier === 'rules';
    const disableGrant = (base && state !== 'grant') || (isAccountant && isWrite);
    const disableDeny = !base;
    return (
      <div key={cap} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-2 border-b border-gray-100 dark:border-gray-700">
        <div className="flex-1">
          <p className="font-medium text-sm text-gray-900 dark:text-gray-100">{CAP_LABELS_AR[cap] || cap} <span className="text-xs text-gray-500">({cap})</span></p>
          <p className="text-xs text-gray-600 dark:text-gray-400">افتراضي: {base ? '✓' : '✗'} → فعلي: {effective ? '✓' : '✗'} {tier === 'ui' && <span className="ml-2 px-1.5 py-0.5 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200 rounded text-xs">إخفاء واجهة فقط</span>}</p>
        </div>
        <div className="flex gap-1">
          <label className={`px-2 py-1 rounded text-xs cursor-pointer ${state==='default'?'bg-gray-200 dark:bg-gray-700':''}`}><input type="radio" name={cap} checked={state==='default'} onChange={()=>handleChange(cap,'default')} className="ml-1" />افتراضي</label>
          <label className={`px-2 py-1 rounded text-xs ${disableGrant?'opacity-40 cursor-not-allowed': 'cursor-pointer'} ${state==='grant'?'bg-green-100 dark:bg-green-900/30':''}`}><input type="radio" name={cap} checked={state==='grant'} onChange={()=>handleChange(cap,'grant')} disabled={!!disableGrant} className="ml-1" />منح</label>
          <label className={`px-2 py-1 rounded text-xs ${disableDeny?'opacity-40 cursor-not-allowed': 'cursor-pointer'} ${state==='deny'?'bg-red-100 dark:bg-red-900/30':''}`}><input type="radio" name={cap} checked={state==='deny'} onChange={()=>handleChange(cap,'deny')} disabled={!!disableDeny} className="ml-1" />منع</label>
        </div>
      </div>
    );
  };

  const rulesCaps = Object.entries(OVERRIDABLE_CAPS).filter(([,t])=>t==='rules').map(([c])=>c);
  const uiCaps = Object.entries(OVERRIDABLE_CAPS).filter(([,t])=>t==='ui').map(([c])=>c);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-start z-50 p-4 overflow-y-auto">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-4 w-full max-w-2xl my-8">
        <h2 className="text-lg font-bold mb-2 text-gray-900 dark:text-gray-100">صلاحيات {user.email} ({user.role})</h2>
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded p-2 mb-3 text-xs text-yellow-800 dark:text-yellow-200">
          <p><strong>تُفرض في القواعد:</strong> تمنع الفعل فعلًا. <strong>إخفاء واجهة فقط:</strong> تخفي الزر/التبويب لكن القراءة مفتوحة (لا حماية حقيقية).</p>
        </div>
        <div className="mb-3">
          <h3 className="font-semibold text-sm mb-1">تُفرض في القواعد</h3>
          {rulesCaps.map(renderCap)}
        </div>
        <div className="mb-3">
          <h3 className="font-semibold text-sm mb-1">إخفاء واجهة فقط</h3>
          {uiCaps.map(renderCap)}
        </div>
        <div className="border-t pt-3 mt-3">
          <h3 className="font-semibold text-sm mb-1">سجل التغييرات (آخر 5)</h3>
          {auditLoading ? <p className="text-xs">جاري التحميل...</p> : audit.length===0 ? <p className="text-xs text-gray-500">لا يوجد سجل</p> : audit.map(a=>(
            <div key={a.id} className="text-xs py-1 border-b border-gray-100 dark:border-gray-700">
              <span>{a.by} → {a.targetUid}</span> <span className="text-gray-500">{a.at?.toDate?.()?.toLocaleString?.() || ''}</span>
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-4 py-2 bg-gray-200 dark:bg-gray-700 rounded" disabled={saving}>إلغاء</button>
          <button onClick={handleSave} className="px-4 py-2 bg-primary-600 text-white rounded" disabled={saving}>{saving?'جاري الحفظ...':'حفظ'}</button>
        </div>
      </div>
    </div>
  );
};
