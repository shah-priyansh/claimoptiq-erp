const { randomUUID } = require('crypto');
const prisma = require('../config/prisma');
const { toResponse } = require('../utils/toResponse');
const { getUserHospitalId, getReferenceHospitalIds } = require('../utils/hospitalScope');

// Dropdown "all hospitals" endpoint gets hit on every page that renders a
// hospital SearchableSelect. The payload is tiny + rarely changes, so we
// cache it per active-state (?active=true|false|all) for 2 minutes. Any
// hospital create/update/delete below busts the cache.
const _dropdownCache = new Map();
const DROPDOWN_CACHE_TTL = 2 * 60 * 1000;
const bustDropdownCache = () => { _dropdownCache.clear(); };

const isValidPhone = (v) => /^[6-9]\d{9}$/.test((v || '').trim());
const isValidEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((v || '').trim());
const isValidPincode = (v) => /^[1-9][0-9]{5}$/.test((v || '').trim());

const hospitalInclude = {
  // Legacy flat relation — spans EVERY rate version once a hospital has more
  // than one (base + dated), so it must never be handed back to a client
  // as-is (that would silently merge versions' services together). Kept in
  // the include only so `pickBaseBillingServices` below can derive the
  // back-compat `billingServices` field without a second round-trip; always
  // overwritten before the response goes out.
  billingServices: { include: { slabs: { orderBy: { order: 'asc' } } } },
  rateVersions: {
    include: { billingServices: { include: { slabs: { orderBy: { order: 'asc' } } } } },
    orderBy: { effectiveFromMonth: 'asc' },
  },
  doctors: true,
  reference: { select: { id: true, name: true, commissionRate: true, isActive: true } },
};

// Overwrites the flat `billingServices` field (see comment above) with just
// the BASE version's services (effectiveFromMonth === null) so any consumer
// still reading `hospital.billingServices` keeps seeing exactly what it saw
// before rate versions existed, while `rateVersions` carries the full
// effective-dated picture. Safe to call on a single hospital or an array.
const pickBaseBillingServices = (hospital) => {
  if (Array.isArray(hospital)) return hospital.map(pickBaseBillingServices);
  if (!hospital || !Array.isArray(hospital.rateVersions)) return hospital;
  const base = hospital.rateVersions.find((v) => v.effectiveFromMonth === null);
  return { ...hospital, billingServices: base ? base.billingServices : [] };
};

const hospitalListInclude = {
  billingServices: { select: { id: true } },
  doctors: { select: { id: true } },
  reference: { select: { id: true, name: true } },
  parent: { select: { id: true, name: true } },
  _count: { select: { branches: true } },
};

// Tiny include for dropdown callsites — only the fields a SearchableSelect
// renders. Cuts the response by ~99% vs the full hospitalInclude, so
// dropdowns can fetch every hospital in one shot without dragging billing
// services / slabs over the wire. Doctors (id + name) are included because
// the claim form uses this endpoint to populate its per-hospital Doctor
// dropdown — stripping them here made the claim form think every hospital
// had zero doctors.
const hospitalDropdownSelect = {
  id: true, name: true, invoiceName: true, isActive: true, isDirect: true, referenceBy: true,
  // Parent link so the frontend can badge branches, scope the invoice claim
  // pool, and guard the parent picker (a branch can't be someone's parent).
  parentHospitalId: true,
  // Canonical reference name from the master (when the hospital is linked) so
  // the claims "All References" filter can dedupe on the master's casing
  // rather than the denormalised referenceBy text, which can drift in case.
  reference: { select: { name: true } },
  doctors: { select: { id: true, name: true } },
};

const validateHospitalFields = (body) => {
  if (body.phone && !isValidPhone(body.phone)) return 'Enter a valid 10-digit Indian mobile number (starts with 6-9)';
  if (body.email && !isValidEmail(body.email)) return 'Enter a valid email address';
  if (body.pincode && !isValidPincode(body.pincode)) return 'Enter a valid 6-digit Indian pincode';
  if (Array.isArray(body.doctors)) {
    for (let i = 0; i < body.doctors.length; i++) {
      const d = body.doctors[i];
      if (!d.name || !d.name.trim()) return `Doctor #${i + 1}: Name is required`;
      if (d.phone && !isValidPhone(d.phone)) return `Doctor #${i + 1}: Enter a valid 10-digit mobile number`;
      if (d.email && !isValidEmail(d.email)) return `Doctor #${i + 1}: Enter a valid email address`;
    }
  }
  return null;
};

const buildHospitalData = async (body) => {
  let referenceId =
    body.referenceId === '' || body.referenceId === null
      ? null
      : body.referenceId === undefined
        ? undefined
        : body.referenceId;
  // When a caller (e.g. the hospital CSV import) supplies only free-text
  // `referenceBy` and no explicit referenceId, resolve the text to the Reference
  // master by name and link the FK. Without this the referenceId stays null and
  // the reference-commission engine skips the hospital entirely. Text that
  // matches no master leaves the FK null (free-text only, as before).
  if (referenceId === undefined && typeof body.referenceBy === 'string' && body.referenceBy.trim()) {
    const match = await prisma.reference.findFirst({
      where: { name: { equals: body.referenceBy.trim(), mode: 'insensitive' } },
      select: { id: true },
    });
    if (match) referenceId = match.id;
  }
  let referenceByFromRef;
  if (referenceId) {
    const ref = await prisma.reference.findUnique({ where: { id: referenceId }, select: { name: true } });
    if (!ref) {
      const err = new Error('Reference not found');
      err.status = 400;
      throw err;
    }
    referenceByFromRef = ref.name;
  } else if (referenceId === null) {
    referenceByFromRef = '';
  }
  const data = {
    name: body.name,
    contact: body.contact || '',
    email: body.email || '',
    phone: body.phone || '',
    address: body.address || '',
    city: body.city || '',
    state: body.state || '',
    pincode: body.pincode || '',
    isActive: body.isActive !== undefined ? body.isActive : true,
    isDirect: body.isDirect !== undefined ? !!body.isDirect : false,
  };
  // Digits only — see hospitalBillSequence.js (parseBillStart ignores
  // anything else). Left untouched when the caller doesn't send it (e.g. the
  // CSV import flow only ever supplies contact fields) so re-importing a
  // hospital never silently wipes its configured bill-start number.
  if (body.hospitalBillStartNo !== undefined) {
    data.hospitalBillStartNo = /^\d*$/.test(body.hospitalBillStartNo) ? body.hospitalBillStartNo : '';
  }
  // Legal/billing name used on generated invoices (see Hospital.invoiceName).
  // Guarded like hospitalBillStartNo so callers that omit it (e.g. CSV import,
  // which only sends contact fields) never silently wipe a configured value.
  if (body.invoiceName !== undefined) {
    data.invoiceName = typeof body.invoiceName === 'string' ? body.invoiceName.trim() : '';
  }
  // Per-hospital GST / TDS / invoicePrefix were retired 2026-06-16 — all
  // three are now single platform-wide settings in Site Settings → Invoice
  // Template. Any legacy clients still sending those fields are silently
  // dropped (we just don't write them onto `data`).
  if (referenceId !== undefined) data.referenceId = referenceId;
  if (body.referenceBy !== undefined) data.referenceBy = body.referenceBy || '';
  else if (referenceByFromRef !== undefined) data.referenceBy = referenceByFromRef;
  else data.referenceBy = '';
  // Optional parent (branch) link. '' / null clear it; undefined leaves it
  // untouched. Validity (one level, no cycle, active parent) is checked by
  // validateParentAssignment before the write.
  if (body.parentHospitalId !== undefined) {
    data.parentHospitalId =
      body.parentHospitalId === '' || body.parentHospitalId === null ? null : body.parentHospitalId;
  }
  return data;
};

// Guards the one-level branch hierarchy. Returns an error message string if the
// requested parent assignment is invalid, else null. `selfId` is undefined on
// create (a brand-new hospital has no id and no branches yet).
const validateParentAssignment = async (parentHospitalId, selfId) => {
  if (parentHospitalId === undefined || parentHospitalId === null || parentHospitalId === '') return null;
  if (selfId && parentHospitalId === selfId) return 'A hospital cannot be its own parent';
  const parent = await prisma.hospital.findUnique({
    where: { id: parentHospitalId },
    select: { id: true, isActive: true, parentHospitalId: true },
  });
  if (!parent) return 'Parent hospital not found';
  if (!parent.isActive) return 'Parent hospital is inactive';
  // The chosen parent must be a top-level hospital. This also blocks a 2-node
  // cycle (A→B while B→A): B would already carry parentHospitalId = A.
  if (parent.parentHospitalId) return 'Chosen parent is itself a branch — only one level of hierarchy is allowed';
  if (selfId) {
    const branchCount = await prisma.hospital.count({ where: { parentHospitalId: selfId } });
    if (branchCount > 0) return 'This hospital has its own branches, so it cannot become a branch of another hospital';
  }
  return null;
};

const buildBillingServices = (services) =>
  (services || []).map((s) => ({
    serviceName: s.serviceName,
    billingType: s.billingType,
    fixedAmount: s.fixedAmount || 0,
    claimLimit: s.claimLimit || 0,
    overLimitBehavior: s.overLimitBehavior || 'per_claim',
    overLimitPerClaimAmount: s.overLimitPerClaimAmount || 0,
    overLimitInsuranceWise: Boolean(s.overLimitInsuranceWise),
    overLimitInsurerIds: Array.isArray(s.overLimitInsurerIds) ? s.overLimitInsurerIds : [],
    overLimitTpaIds: Array.isArray(s.overLimitTpaIds) ? s.overLimitTpaIds : [],
    calculationBasis: s.calculationBasis || 'none',
    percentageRate: s.percentageRate || 0,
    slabMode: s.slabMode || 'slab_wise',
    slabRangeStart: s.slabRangeStart || 0,
    slabIncrementRange: s.slabIncrementRange || 0,
    slabIncrementPrice: s.slabIncrementPrice || 0,
    isActive: s.isActive !== undefined ? s.isActive : true,
    slabs: {
      create: (s.slabs || []).map((slab, i) => ({
        rangeStart: slab.rangeStart || 0,
        rangeEnd: slab.rangeEnd || 0,
        price: slab.price || 0,
        order: i,
      })),
    },
  }));

// HospitalBillingService carries TWO required FKs: hospitalId (direct to
// Hospital) and rateVersionId (direct to HospitalRateVersion). Nesting
// `billingServices: { create: [...] }` under a rateVersion create only
// auto-wires rateVersionId (the immediate parent relation) — Prisma does
// NOT transitively infer hospitalId from the rateVersion's own hospital,
// since it's a separate, sibling relation on the same model. Every
// billingServices nested-create below must therefore stamp hospitalId
// explicitly via this helper, or Prisma throws "Argument `hospital` is
// missing."
const withHospitalId = (services, hospitalId) => services.map((s) => ({ ...s, hospitalId }));

const buildDoctors = (doctors) =>
  (doctors || []).map((d) => ({
    name: d.name.trim(),
    specialization: d.specialization || '',
    phone: d.phone || '',
    email: d.email || '',
  }));

// Normalizes a payload `effectiveFromMonth` (ISO date/month string, Date, or
// null/undefined/'') to a UTC first-of-month DateTime, matching the base
// version's `null` convention and the DB's `@@unique([hospitalId,
// effectiveFromMonth])` constraint. Date-only / month-only ISO strings
// (`"2026-11-01"`, `"2026-11"`) parse as UTC already, so re-deriving the
// UTC y/m and rebuilding with Date.UTC just drops any time-of-day instead of
// shifting the calendar month.
const normalizeEffectiveFromMonth = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    const err = new Error('Invalid rate version effective month');
    err.status = 400;
    throw err;
  }
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
};

// Validates + normalizes a `rateVersions` payload shared by create/update.
// Throws a 400-flagged error for a duplicate month rather than letting it
// fall through to the DB's unique constraint as an opaque Prisma P2002.
// Does NOT enforce "exactly one base" — callers add/preserve the base
// themselves (create vs. update need different fallback behavior for a
// missing base).
const normalizeRateVersionsPayload = (versions) => {
  const seen = new Set();
  return (versions || []).map((v) => {
    const effectiveFromMonth = normalizeEffectiveFromMonth(v.effectiveFromMonth);
    const key = effectiveFromMonth === null ? 'base' : effectiveFromMonth.toISOString();
    if (seen.has(key)) {
      const err = new Error(
        effectiveFromMonth === null
          ? 'Only one base rate version (no effective month) is allowed'
          : `Two rate versions share the same effective month (${key.slice(0, 7)})`
      );
      err.status = 400;
      throw err;
    }
    seen.add(key);
    return { effectiveFromMonth, note: v.note || null, billingServices: v.billingServices };
  });
};

exports.bulkImportHospitals = async (req, res) => {
  try {
    const { rows } = req.body;
    const mode = req.body.mode === 'replace' ? 'replace' : 'skip';
    if (!Array.isArray(rows) || !rows.length) {
      return res.status(400).json({ message: 'rows (non-empty array) is required' });
    }
    if (rows.length > 2000) return res.status(400).json({ message: 'Maximum 2000 rows per import' });

    const existing = await prisma.hospital.findMany({ select: { id: true, name: true, isActive: true } });
    const activeMap = new Map();
    const inactiveMap = new Map();
    for (const e of existing) {
      const key = e.name.trim().toLowerCase();
      (e.isActive ? activeMap : inactiveMap).set(key, e);
    }

    const seenInBatch = new Set();
    const created = [];
    const updated = [];
    const skipped = [];
    const errors = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || {};
      const rowNum = i + 2;
      const name = String(row.name || '').trim();
      const key = name.toLowerCase();
      const rowErrors = [];
      if (!name) rowErrors.push('Name is required');
      else if (seenInBatch.has(key)) rowErrors.push(`"${name}" is duplicated in the file`);
      const fieldErr = validateHospitalFields({ phone: row.phone, email: row.email, pincode: row.pincode });
      if (fieldErr) rowErrors.push(fieldErr);

      if (rowErrors.length) { errors.push({ row: rowNum, name, errors: rowErrors }); continue; }

      const activeExisting = activeMap.get(key);
      if (activeExisting && mode === 'skip') {
        seenInBatch.add(key);
        skipped.push({ row: rowNum, id: activeExisting.id, name });
        continue;
      }

      try {
        const data = await buildHospitalData({
          name, contact: row.contact, email: row.email, phone: row.phone, address: row.address,
          city: row.city, state: row.state, pincode: row.pincode, referenceBy: row.referenceBy,
        });
        const inactive = inactiveMap.get(key);
        if (activeExisting) {
          const hospital = await prisma.hospital.update({
            where: { id: activeExisting.id },
            data,
            select: { id: true, name: true },
          });
          seenInBatch.add(key);
          updated.push({ row: rowNum, id: hospital.id, name: hospital.name });
        } else if (inactive) {
          const hospital = await prisma.hospital.update({
            where: { id: inactive.id },
            data: { ...data, isActive: true },
            select: { id: true, name: true },
          });
          seenInBatch.add(key);
          updated.push({ row: rowNum, id: hospital.id, name: hospital.name });
        } else {
          // Every hospital must always have exactly one base rate version
          // (effectiveFromMonth: null) — see createHospital. The import
          // template carries no billing-service columns today, so this seeds
          // an empty base version in practice, but we still route any
          // `row.billingServices` (if a future caller supplies them) through
          // the same buildBillingServices/withHospitalId pre-generated-id
          // pattern as createHospital, so nested services get the correct
          // hospitalId stamp.
          const hospitalId = randomUUID();
          const hospital = await prisma.hospital.create({
            data: {
              id: hospitalId,
              ...data,
              rateVersions: {
                create: {
                  effectiveFromMonth: null,
                  billingServices: { create: withHospitalId(buildBillingServices(row.billingServices), hospitalId) },
                },
              },
            },
            select: { id: true, name: true },
          });
          seenInBatch.add(key);
          created.push({ row: rowNum, id: hospital.id, name: hospital.name });
        }
      } catch (e) {
        errors.push({ row: rowNum, name, errors: [e.message || 'Failed to save'] });
      }
    }
    const successCount = created.length + updated.length;
    if (successCount) bustDropdownCache();
    res.status(errors.length && !successCount && !skipped.length ? 400 : 200).json({
      message: `Imported ${successCount} of ${rows.length} hospital(s)`,
      created, updated, skipped, errors,
      totalRows: rows.length,
      successCount,
      createdCount: created.length,
      updatedCount: updated.length,
      skippedCount: skipped.length,
      errorCount: errors.length,
      mode,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.invalidateHospitalDropdownCache = bustDropdownCache;

exports.createHospital = async (req, res) => {
  try {
    const err = validateHospitalFields(req.body);
    if (err) return res.status(400).json({ message: err });
    const parentErr = await validateParentAssignment(req.body.parentHospitalId, undefined);
    if (parentErr) return res.status(400).json({ message: parentErr });

    // `rateVersions` (Task 7 UI) takes priority over the legacy flat
    // `billingServices` array; a caller that still sends only the legacy
    // shape (CSV import, older bundles) gets it wrapped into a single base
    // version so every hospital always ends up with exactly one
    // effectiveFromMonth:null version, same as before rate versions existed.
    const rawVersions = Array.isArray(req.body.rateVersions) && req.body.rateVersions.length
      ? req.body.rateVersions
      : [{ effectiveFromMonth: null, billingServices: req.body.billingServices }];
    const normalizedVersions = normalizeRateVersionsPayload(rawVersions);
    if (!normalizedVersions.some((v) => v.effectiveFromMonth === null)) {
      normalizedVersions.unshift({ effectiveFromMonth: null, note: null, billingServices: [] });
    }

    // Pre-generate the id so it can be stamped onto each nested billing
    // service below (see withHospitalId) — the hospital doesn't exist yet,
    // but HospitalBillingService.hospitalId is required and Prisma can't
    // infer it through the rateVersion grandparent relation.
    const hospitalId = randomUUID();
    const hospital = await prisma.hospital.create({
      data: {
        id: hospitalId,
        ...(await buildHospitalData(req.body)),
        rateVersions: {
          create: normalizedVersions.map((v) => ({
            effectiveFromMonth: v.effectiveFromMonth,
            note: v.note,
            billingServices: { create: withHospitalId(buildBillingServices(v.billingServices), hospitalId) },
          })),
        },
        doctors: { create: buildDoctors(req.body.doctors) },
      },
      include: hospitalInclude,
    });
    bustDropdownCache();
    res.status(201).json(toResponse(pickBaseBillingServices(hospital)));
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ message: error.message });
    if (error.code === 'P2002') {
      return res.status(400).json({ message: 'Two rate versions share the same effective month' });
    }
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.getHospitals = async (req, res) => {
  try {
    const { search, active, page, limit = 100, all } = req.query;
    const where = {};

    if (active !== undefined) where.isActive = active === 'true';
    if (search) where.name = { contains: search, mode: 'insensitive' };
    const userHospId = getUserHospitalId(req.user);
    if (userHospId) {
      where.id = userHospId;
    } else if (req.user.referenceId) {
      // Reference-scoped login: only the hospitals under their reference,
      // same scoping used for Claims / Hospital Final Bills.
      where.id = { in: await getReferenceHospitalIds(req.user) };
    }

    // Dropdown / "fetch everything" mode — pagination is explicitly
    // bypassed and we serve a minimal payload so the response stays cheap
    // even with hundreds of hospitals. Cached per (userHospId/referenceId,
    // search, active) key so repeat page loads / dropdown remounts are
    // near-free.
    if (all === 'true' || all === '1') {
      const scopeKey = userHospId || (req.user.referenceId ? `ref:${req.user.referenceId}` : 'admin');
      const cacheKey = `${scopeKey}|${search || ''}|${active ?? 'all'}`;
      const cached = _dropdownCache.get(cacheKey);
      if (cached && cached.expiry > Date.now()) {
        return res.json(cached.payload);
      }
      const hospitals = await prisma.hospital.findMany({
        where,
        select: hospitalDropdownSelect,
        orderBy: { name: 'asc' },
      });
      const payload = toResponse(hospitals);
      _dropdownCache.set(cacheKey, { payload, expiry: Date.now() + DROPDOWN_CACHE_TTL });
      return res.json(payload);
    }

    if (page !== undefined) {
      const skip = (Number(page) - 1) * Number(limit);
      const [hospitals, total] = await Promise.all([
        prisma.hospital.findMany({
          where,
          include: hospitalListInclude,
          orderBy: { name: 'asc' },
          skip,
          take: Number(limit),
        }),
        prisma.hospital.count({ where }),
      ]);
      return res.json({
        hospitals: toResponse(hospitals),
        total,
        pages: Math.ceil(total / Number(limit)),
      });
    }

    const hospitals = await prisma.hospital.findMany({
      where,
      include: hospitalInclude,
      orderBy: { name: 'asc' },
    });
    res.json(toResponse(pickBaseBillingServices(hospitals)));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.getHospital = async (req, res) => {
  try {
    const userHospitalId = req.user.hospitalId || req.user.hospital?.id;
    if (userHospitalId && req.params.id !== userHospitalId) {
      return res.status(403).json({ message: 'You can only view your own hospital' });
    }

    const hospital = await prisma.hospital.findUnique({
      where: { id: req.params.id },
      include: hospitalInclude,
    });
    if (!hospital) return res.status(404).json({ message: 'Hospital not found' });
    res.json(toResponse(pickBaseBillingServices(hospital)));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.updateHospital = async (req, res) => {
  try {
    const err = validateHospitalFields(req.body);
    if (err) return res.status(400).json({ message: err });

    const existing = await prisma.hospital.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ message: 'Hospital not found' });
    // Only validate the parent link when it actually changes — an unrelated
    // save (e.g. staff editing contact details) shouldn't re-run the guard
    // against a link that was already valid.
    const nextParent = req.body.parentHospitalId;
    if (nextParent !== undefined && (nextParent || null) !== (existing.parentHospitalId || null)) {
      const parentErr = await validateParentAssignment(nextParent, req.params.id);
      if (parentErr) return res.status(400).json({ message: parentErr });
    }

    const hospitalData = await buildHospitalData(req.body);
    const hasRateVersionsPayload = Array.isArray(req.body.rateVersions);

    // Wrapped in a transaction so a hospital is never left with zero rate
    // versions between the delete and the recreate below. The doctor
    // delete+recreate MUST live inside this transaction too: the recreate is
    // nested on `tx.hospital.update` at the end, so if anything in here
    // throws (e.g. a duplicate-month 400 from normalizeRateVersionsPayload,
    // or a P2002 race) the delete has to roll back with it — otherwise a
    // rejected update that changes nothing else would still silently wipe the
    // hospital's entire doctors list.
    const hospital = await prisma.$transaction(async (tx) => {
      await tx.hospitalDoctor.deleteMany({ where: { hospitalId: req.params.id } });

      if (hasRateVersionsPayload) {
        // Full version replace (Task 7 UI): delete every existing version
        // for this hospital — cascade removes their billingServices + slabs
        // — then recreate from the payload.
        const normalizedVersions = normalizeRateVersionsPayload(req.body.rateVersions);
        if (!normalizedVersions.some((v) => v.effectiveFromMonth === null)) {
          // Payload dropped the base entirely — never let a save delete it.
          // Preserve the hospital's EXISTING base version's services instead
          // of erroring, so an omitted base behaves like "leave it alone"
          // rather than wiping a hospital's current rates.
          const currentBase = await tx.hospitalRateVersion.findFirst({
            where: { hospitalId: req.params.id, effectiveFromMonth: null },
            include: { billingServices: { include: { slabs: { orderBy: { order: 'asc' } } } } },
          });
          normalizedVersions.unshift({
            effectiveFromMonth: null,
            note: currentBase?.note ?? null,
            billingServices: currentBase ? currentBase.billingServices : [],
          });
        }

        await tx.hospitalRateVersion.deleteMany({ where: { hospitalId: req.params.id } });
        for (const v of normalizedVersions) {
          await tx.hospitalRateVersion.create({
            data: {
              hospitalId: req.params.id,
              effectiveFromMonth: v.effectiveFromMonth,
              note: v.note,
              billingServices: { create: withHospitalId(buildBillingServices(v.billingServices), req.params.id) },
            },
          });
        }
      } else {
        // Legacy payload (no rateVersions key): replace ONLY the base
        // version's services, leaving any dated versions created via the
        // newer UI untouched. `buildBillingServices(undefined) -> []`
        // mirrors the pre-rate-versions behavior, where an update call that
        // omitted `billingServices` entirely wiped the hospital's services.
        let base = await tx.hospitalRateVersion.findFirst({
          where: { hospitalId: req.params.id, effectiveFromMonth: null },
        });
        if (base) {
          await tx.hospitalBillingService.deleteMany({ where: { rateVersionId: base.id } });
        } else {
          base = await tx.hospitalRateVersion.create({
            data: { hospitalId: req.params.id, effectiveFromMonth: null },
          });
        }
        await tx.hospitalRateVersion.update({
          where: { id: base.id },
          data: { billingServices: { create: withHospitalId(buildBillingServices(req.body.billingServices), req.params.id) } },
        });
      }

      return tx.hospital.update({
        where: { id: req.params.id },
        data: {
          ...hospitalData,
          doctors: { create: buildDoctors(req.body.doctors) },
        },
        include: hospitalInclude,
      });
    });

    bustDropdownCache();
    res.json(toResponse(pickBaseBillingServices(hospital)));
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ message: error.message });
    if (error.code === 'P2002') {
      return res.status(400).json({ message: 'Two rate versions share the same effective month' });
    }
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Status-only toggle for the Hospitals list. Kept separate from updateHospital
// because that endpoint is a full replace that wipes billing services/doctors
// and blanks unspecified scalar fields — a partial { isActive } body there
// would be destructive. This touches nothing but the isActive flag.
exports.setHospitalStatus = async (req, res) => {
  try {
    const { isActive } = req.body;
    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ message: 'isActive (boolean) is required' });
    }
    const existing = await prisma.hospital.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ message: 'Hospital not found' });

    const hospital = await prisma.hospital.update({
      where: { id: req.params.id },
      data: { isActive },
      include: hospitalInclude,
    });
    bustDropdownCache();
    res.json(toResponse(pickBaseBillingServices(hospital)));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Smart delete: if nothing depends on the hospital, hard-delete it (its own
// billing services + doctors cascade away with it). If it's referenced by any
// claim, user, invoice, document submission or cash/bank entry, we can't remove
// it without orphaning or breaking those records, so we deactivate instead.
exports.deleteHospital = async (req, res) => {
  try {
    const id = req.params.id;
    const hospital = await prisma.hospital.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        _count: {
          select: { claims: true, users: true, invoices: true, submissions: true, cashBankEntries: true },
        },
      },
    });
    if (!hospital) return res.status(404).json({ message: 'Hospital not found' });

    const c = hospital._count;
    const linkedCount = c.claims + c.users + c.invoices + c.submissions + c.cashBankEntries;

    if (linkedCount === 0) {
      await prisma.hospital.delete({ where: { id } });
      bustDropdownCache();
      return res.json({ message: `Hospital "${hospital.name}" deleted`, deleted: true });
    }

    await prisma.hospital.update({ where: { id }, data: { isActive: false } });
    bustDropdownCache();
    return res.json({
      message: `Hospital "${hospital.name}" is linked to existing records — deactivated instead of deleting`,
      deleted: false,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Bulk soft-delete every active hospital. Hard-delete would break the FK from
// claims/invoices/users that reference hospitals, so this mirrors the
// single-hospital delete (isActive=false) but applied across the board.
exports.deleteAllHospitals = async (req, res) => {
  try {
    if (req.body?.confirm !== 'DELETE_ALL') {
      return res.status(400).json({ message: 'Confirmation required' });
    }
    const result = await prisma.hospital.updateMany({
      where: { isActive: true },
      data: { isActive: false },
    });
    bustDropdownCache();
    res.json({ message: `${result.count} hospital(s) deactivated`, count: result.count });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Inline doctor add — used from the claim form so staff can register a new
// panel doctor without leaving the claim flow. Permission is deliberately
// wider than `hospitals:edit` (claim creators need it too), gated at the
// route layer.
exports.addHospitalDoctor = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, specialization, phone, email } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Doctor name is required' });
    }
    if (phone && !isValidPhone(phone)) {
      return res.status(400).json({ message: 'Enter a valid 10-digit Indian mobile number' });
    }
    if (email && !isValidEmail(email)) {
      return res.status(400).json({ message: 'Enter a valid email address' });
    }
    const hospital = await prisma.hospital.findUnique({ where: { id }, select: { id: true } });
    if (!hospital) return res.status(404).json({ message: 'Hospital not found' });

    const doctor = await prisma.hospitalDoctor.create({
      data: {
        hospitalId: id,
        name: name.trim(),
        specialization: specialization || '',
        phone: phone || '',
        email: email || '',
      },
    });
    bustDropdownCache();
    res.status(201).json(toResponse(doctor));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
