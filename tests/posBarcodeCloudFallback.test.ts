// REQ-BARCODE-FIX-1 — fallback سحابي عند miss محلي (pagination gap).
// وحدات خالصة (vitest، بلا Emulator): تُختبر resolveBarcodeScan — نفس المنطق
// المستخرج الذي يستخدمه handleBarcodeScan في POSPage حرفيًا — بحقن
// localLookup/cloudLookup وهميين، لا نسخة موازية للمنطق.
import { describe, it, expect, vi } from 'vitest';
import { resolveBarcodeScan } from '../utils/barcodeResolution';
import { withCloudTimeout } from '../utils/barcodeResolution';
import type { Product } from '../types';

const mkProduct = (id: string, barcode: string, quantity = 10, extra: Record<string, unknown> = {}): Product => ({
  id,
  code: `C-${id}`,
  name: `منتج ${id}`,
  price: 25,
  quantity,
  categoryId: 'cat-1',
  createdAt: Date.now(),
  searchableIndex: [],
  barcode,
  ...extra,
} as Product);

// المحمّل محليًا: منتج واحد فقط (محاكاة أول صفحة pagination)
const loadedLocal: Product[] = [mkProduct('local-1', 'MKTLOCAL0000001')];
// موجود سحابيًا لكن خارج الصفحة المحمّلة
const cloudOnly = mkProduct('cloud-9', 'MKTCLOUD0000009');

const localLookup = (code: string): Product | undefined =>
  loadedLocal.find((p) => p.barcode === code);

describe('REQ-BARCODE-FIX-1: fallback سحابي عند miss محلي', () => {
  it('miss محلي + نتيجة سحابية ناجحة → found ويُستدعى handleAddToCart (محاكاة ربط المعالج)', async () => {
    const cloudLookup = vi.fn(async (): Promise<Product | null> => cloudOnly);
    const outcome = await resolveBarcodeScan('MKTCLOUD0000009', localLookup, cloudLookup);
    expect(cloudLookup).toHaveBeenCalledTimes(1);
    expect(cloudLookup).toHaveBeenCalledWith('MKTCLOUD0000009');
    expect(outcome.status).toBe('found');
    // نفس ربط handleBarcodeScan: found → إضافة للسلة
    const added: Product[] = [];
    if (outcome.status === 'found') added.push(outcome.product);
    expect(added).toHaveLength(1);
    expect(added[0].id).toBe('cloud-9');
  });

  it('miss محلي + miss سحابي (null) → not-found فقط بعد فشل الاستعلامين', async () => {
    const cloudLookup = vi.fn(async (): Promise<Product | null> => null);
    const outcome = await resolveBarcodeScan('MKTNOPE00000000', localLookup, cloudLookup);
    // إثبات أن السحابة استُشيرت فعلًا قبل الحكم (لا حكم محلي متسرّع)
    expect(cloudLookup).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ status: 'not-found' });
  });

  it('فشل شبكي في الاستعلام السحابي → cloud-error (رسالة مميزة، لا not-found)', async () => {
    const cloudLookup = vi.fn(async (): Promise<Product | null> => {
      throw new Error('network-request-failed');
    });
    const outcome = await resolveBarcodeScan('MKTCLOUD0000009', localLookup, cloudLookup);
    expect(outcome.status).toBe('cloud-error');
    expect(outcome.status).not.toBe('not-found');
  });

  it('إصابة محلية → السحابة لا تُستدعى إطلاقًا (بلا قراءات زائدة)', async () => {
    const cloudLookup = vi.fn(async (): Promise<Product | null> => cloudOnly);
    const outcome = await resolveBarcodeScan('MKTLOCAL0000001', localLookup, cloudLookup);
    expect(cloudLookup).not.toHaveBeenCalled();
    expect(outcome.status).toBe('found');
    if (outcome.status === 'found') expect(outcome.product.id).toBe('local-1');
  });

  it('إصابة محلية محظورة (نافد) → blocked بلا استعلام سحابي', async () => {
    const localWithDepleted = [...loadedLocal, mkProduct('local-0', 'MKTLOCAL0000000', 0)];
    const lookup = (code: string) => localWithDepleted.find((p) => p.barcode === code);
    const cloudLookup = vi.fn(async (): Promise<Product | null> => cloudOnly);
    const outcome = await resolveBarcodeScan('MKTLOCAL0000000', lookup, cloudLookup);
    expect(cloudLookup).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      status: 'blocked',
      reason: 'out-of-stock',
      product: expect.objectContaining({ id: 'local-0' }),
    });
  });

  it('AC-5: نتيجة سحابية نافدة → نفس الحارس blocked/out-of-stock (لا منطق موازٍ)', async () => {
    const depletedCloud = mkProduct('cloud-0', 'MKTCLOUD0000000', 0);
    const cloudLookup = vi.fn(async (): Promise<Product | null> => depletedCloud);
    const outcome = await resolveBarcodeScan('MKTCLOUD0000000', localLookup, cloudLookup);
    expect(outcome.status).toBe('blocked');
    if (outcome.status === 'blocked') {
      expect(outcome.reason).toBe('out-of-stock');
      expect(outcome.product.id).toBe('cloud-0');
    }
  });

  it('AC-5: نتيجة سحابية sellable=false → blocked/not-sellable', async () => {
    const unsellableCloud = mkProduct('cloud-x', 'MKTCLOUD00000X', 5, { sellable: false });
    const cloudLookup = vi.fn(async (): Promise<Product | null> => unsellableCloud);
    const outcome = await resolveBarcodeScan('MKTCLOUD00000X', localLookup, cloudLookup);
    expect(outcome.status).toBe('blocked');
    if (outcome.status === 'blocked') expect(outcome.reason).toBe('not-sellable');
  });

  it('FIX-3: استعلام سحابي معلّق للأبد → cloud-error بعد المهلة (لا تجميد للمسح)', async () => {
    const hanging = vi.fn((): Promise<Product | null> => new Promise(() => {}));
    const outcome = await resolveBarcodeScan('MKTNOPE00000000', localLookup, () =>
      withCloudTimeout(hanging()),
    );
    expect(hanging).toHaveBeenCalledTimes(1);
    expect(outcome.status).toBe('cloud-error');
  }, 15000);
});
