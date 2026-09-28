// services/api/products.ts — REQ-ARCH1-2 (ARCH-1 step 2/9)
// وحدة المنتجات/التصنيفات/الباركود + مرجع سعر الشراء (PURCHASE-PRICE-REF)،
// منقولة حرفيًا من services/api.ts (نقل بنيوي، صفر تغيير منطقي).
// الدوال المساعدة الأربع تبقى خاصة بالوحدة (غير مُصدَّرة).
import {
    collection,
    query,
    where,
    orderBy,
    limit,
    startAfter,
    getDocs,
    getDoc,
    doc,
    addDoc,
    updateDoc,
    deleteField,
    serverTimestamp,
} from "firebase/firestore";
import type { QueryConstraint, QueryDocumentSnapshot } from "firebase/firestore";
import type { Product } from '../../types';
import { toast } from 'react-hot-toast';
import { withInFlightGuard } from '../inflight';
import {
    db,
    assertOnline,
    isOfflineGuardError,
} from './core';

const normalizeArabic = (str: string): string => {
    if (!str) return '';
    return str
        .replace(/[أإآ]/g, 'ا')
        .replace(/ة/g, 'ه')
        .toLowerCase();
};

// Moved from ProductsPage.tsx (REQ-SEC1-3) to sit next to normalizeArabic:
// builds the prefix tokens for searchableIndex. Single source from now on.
const generatePrefixes = (word: string): string[] => {
    const prefixes: string[] = [];
    for (let i = 2; i <= word.length; i++) {
        prefixes.push(word.slice(0, i));
    }
    return prefixes;
};

const buildSearchableIndex = (name: string, code: string): string[] => {
    const nameTokens = normalizeArabic(name).split(' ').filter(Boolean);
    const codeToken = normalizeArabic(code);
    return [...new Set([
        ...nameTokens.flatMap(t => generatePrefixes(t)),
        ...generatePrefixes(codeToken)
    ])];
};

// REQ-SEC1-3 (AUDIT-SEC-1): validated product upsert with a CLOSED
// whitelist. Only known Product fields are destructured — id, createdAt,
// searchableIndex-from-caller, CartItem extras (buyQuantity/priceType) or
// anything else smuggled in `productData` never reach Firestore.
// searchableIndex is always rebuilt here (single source); createdAt is
// serverTimestamp() on create and preserved on update.
export const saveProduct = withInFlightGuard(async (
    productData: Omit<Product, 'id' | 'createdAt' | 'searchableIndex'> | Product
): Promise<string | void> => {
    await assertOnline();
    const data: any = productData || {};
    const {
        code, name, categoryId, quantity, minQuantity,
        price, retailCashPrice, retailCreditPrice,
        wholesaleCashPrice, wholesaleCreditPrice, barcode,
    } = data;

    const text = (v: any, field: string): string => {
        if (v === undefined || v === null || !String(v).trim()) {
            throw new Error(`حقل المنتج مطلوب: ${field}`);
        }
        return String(v).trim();
    };
    const num = (v: any, field: string, required: boolean): number | undefined => {
        if (v === undefined || v === null || v === '') {
            if (required) throw new Error(`حقل المنتج مطلوب: ${field}`);
            return undefined;
        }
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0) {
            throw new Error(`قيمة غير صالحة لحقل المنتج: ${field}`);
        }
        return n;
    };

    const clean: any = {
        code: text(code, 'الكود'),
        name: text(name, 'الاسم'),
        categoryId: text(categoryId, 'التصنيف'),
        quantity: num(quantity, 'الكمية', true),
        price: num(price, 'السعر', true),
    };
    const minQ = num(minQuantity, 'الحد الأدنى للمخزون', false);
    if (minQ !== undefined) clean.minQuantity = minQ;
    const priceFields: Record<string, any> = {
        retailCashPrice, retailCreditPrice, wholesaleCashPrice, wholesaleCreditPrice,
    };
    for (const [field, value] of Object.entries(priceFields)) {
        const n = num(value, field, false);
        if (n !== undefined) clean[field] = n;
    }
    // REQ-BARCODE: barcode اختياري — سلسلة مُقلّمة فقط، لا تدخل searchableIndex.
    // (addProduct/updateProduct المذكورة في REQ هي saveProduct هنا — مسار الحفظ الوحيد.)
    // مسح الحقل صراحة (سلسلة فارغة) يحذفه من المستند حتى لا يبقى باركود قديم.
    if (barcode !== undefined && barcode !== null && String(barcode).trim() !== '') {
        clean.barcode = String(barcode).trim();
    } else if ('id' in data && data.id && 'barcode' in data) {
        clean.barcode = deleteField();
    }
    clean.searchableIndex = buildSearchableIndex(clean.name, clean.code);

    try {
        if ('id' in data && data.id) {
            await updateDoc(doc(db, 'products', data.id), clean);
            return;
        }
        const docRef = await addDoc(collection(db, 'products'), {
            ...clean,
            createdAt: serverTimestamp(),
        });
        return docRef.id;
    } catch (e: any) {
        // Re-throw our own validation errors untouched (clear Arabic text);
        // only wrap unexpected Firestore failures.
        if (isOfflineGuardError(e)) throw e;
        if (e?.message && /حقل المنتج|المنتج مطلوب/.test(e.message)) throw e;
        console.error("Error saving product: ", e);
        throw new Error("Failed to save product");
    }
});

// REQ-SEC1-4 (AUDIT-SEC-1): single-field category creation. The signature
// itself ((name: string)) makes smuggling extra fields structurally
// impossible — there is no `data` object to destructure. Always stores the
// trimmed name. NOTE: no duplicate check (would need a racy pre-read;
// out of scope — same as before).
export const addCategory = withInFlightGuard(async (name: string): Promise<string> => {
    await assertOnline();
    const trimmed = String(name ?? '').trim();
    if (!trimmed) {
        throw new Error("اسم التصنيف لا يمكن أن يكون فارغًا");
    }
    try {
        const docRef = await addDoc(collection(db, 'categories'), { name: trimmed });
        return docRef.id;
    } catch (e) {
        if (isOfflineGuardError(e)) throw e;
        console.error("Error adding category: ", e);
        throw new Error("Failed to add category");
    }
});

// REQ-BARCODE: فحص وجود سحابي لباركود مرشّح قبل الحفظ (يُستدعى فقط عند
// التصادم المحلي — نادر جدًا). مساواة على حقل واحد: لا فهرس مركّب مطلوب.
export const checkBarcodeExistsCloud = async (code: string): Promise<boolean> => {
    try {
        const q = query(collection(db, 'products'), where('barcode', '==', code), limit(1));
        const snap = await getDocs(q);
        return !snap.empty;
    } catch (e) {
        console.error("Error checking barcode existence:", e);
        // عند فشل الشبكة: لا نمنع الحفظ — التفرّد المحلي كافٍ كحد أدنى
        // (مخاطرة التصادم موثّقة كمقبولة أدنى في REQ-BARCODE).
        return false;
    }
};

// REQ-BARCODE-FIX-1 (AC-1): جلب منتج بباركوده سحابيًا — احتياطي مسار المسح
// في POS عند miss محلي (pagination gap: المنتج موجود لكنه خارج أول 30
// محمّلًا). نفس نمط checkBarcodeExistsCloud تمامًا (مساواة على حقل واحد +
// limit(1) — لا فهرس مركّب)، لكنه يُرجع المستند نفسه لا boolean.
// ملاحظة مقصودة: بلا try/catch — فشل الشبكة يجب أن يصل للمتصل (POSPage)
// ليُظهر رسالة "تعذّر التحقق" المميزة عن "غير موجود" (AC-4).
export const getProductByBarcodeCloud = async (code: string): Promise<Product | null> => {
    const normalized = (code ?? '').trim();
    if (!normalized) return null;
    const q = query(collection(db, 'products'), where('barcode', '==', normalized), limit(1));
    const snap = await getDocs(q);
    if (snap.empty) return null;
    const d = snap.docs[0];
    return { id: d.id, ...d.data() } as Product;
};

// FIX-REQ-DASHBOARD-09: جلب مباشر بالـ id — لا يستخدم searchableIndex إطلاقًا
export const getProductById = async (id: string): Promise<Product | null> => {
    const trimmed = (id ?? '').trim();
    if (!trimmed) return null;
    const snap = await getDoc(doc(db, 'products', trimmed));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() } as Product;
};

// Products API - Paginated
const PRODUCTS_PAGE_SIZE = 30;
export const getProductsPaginated = async (
    filters: { searchQuery?: string; categoryId?: string },
    lastVisible: QueryDocumentSnapshot | null
): Promise<{ products: Product[], lastDoc: QueryDocumentSnapshot | null }> => {
    try {
        const constraints: QueryConstraint[] = [];
        const hasSearch = filters.searchQuery && filters.searchQuery.trim() !== '';
        const hasCategory = !!filters.categoryId;

        if (hasSearch) {
            const normalizedQuery = normalizeArabic(filters.searchQuery!);
            constraints.push(where('searchableIndex', 'array-contains', normalizedQuery));
        }

        if (hasCategory) {
            constraints.push(where('categoryId', '==', filters.categoryId));
        }

        constraints.push(orderBy('name'));
        constraints.push(limit(PRODUCTS_PAGE_SIZE));

        if (lastVisible) {
            constraints.push(startAfter(lastVisible));
        }

        const q = query(collection(db, 'products'), ...constraints);
        const documentSnapshots = await getDocs(q);

        const products = documentSnapshots.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product));

        const lastDoc = documentSnapshots.docs[documentSnapshots.docs.length - 1] || null;

        return { products, lastDoc };
    } catch (error) {
        console.error("Error fetching paginated products: ", error);
        toast.error("حدث خطأ أثناء تحميل المنتجات.");
        return { products: [], lastDoc: null };
    }
};

// PURCHASE-PRICE-REF: عتبة الانحراف ±40% (symmetric).
// التقلب الطبيعي للموردين عادة <20%؛ أخطاء الإدخال (صفر زائد/ناقص، سعر بيع بدل شراء)
// كلها >40% بفارق مريح. ثابت مسمى واحد قابل للضبط لاحقًا من قياس حي.
export const PURCHASE_PRICE_DEVIATION_THRESHOLD = 0.4;

// Pure وقابلة للاختبار بلا Firestore. الغائب/الصفر/غير الصالح = أول شراء → false (تأسيس بلا فحص).
export function isPurchasePriceDeviated(
    ref: unknown,
    price: number,
    threshold: number = PURCHASE_PRICE_DEVIATION_THRESHOLD,
): boolean {
    if (typeof ref !== 'number' || !Number.isFinite(ref) || ref <= 0) return false;
    if (typeof price !== 'number' || !Number.isFinite(price)) return false;
    return Math.abs(price - ref) / ref > threshold;
}
