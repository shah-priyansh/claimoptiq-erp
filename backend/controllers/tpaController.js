const prisma = require('../config/prisma');
const { toResponse } = require('../utils/toResponse');
const { sanitizeStatusAutomation, parseStatusAutomationCell } = require('../utils/statusAutomation');

const pickFields = (body) => {
  const data = {};
  if (body.name !== undefined) data.name = String(body.name).trim();
  if (body.address !== undefined) data.address = String(body.address || '').trim();
  if (body.contactPerson !== undefined) data.contactPerson = String(body.contactPerson || '').trim();
  if (body.mobile !== undefined) data.mobile = String(body.mobile || '').trim();
  if (body.email !== undefined) data.email = String(body.email || '').trim();
  if (body.isActive !== undefined) data.isActive = !!body.isActive;
  if (body.statusAutomation !== undefined) data.statusAutomation = sanitizeStatusAutomation(body.statusAutomation);
  return data;
};

exports.create = async (req, res) => {
  try {
    const data = pickFields(req.body);
    if (!data.name) return res.status(400).json({ message: 'Name is required' });
    const existing = await prisma.tPA.findUnique({ where: { name: data.name } });
    if (existing) return res.status(400).json({ message: 'TPA already exists' });
    const item = await prisma.tPA.create({ data });
    res.status(201).json(toResponse(item));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.getAll = async (req, res) => {
  try {
    // Default: active only (dropdowns/master list). `?active=all` returns inactive
    // too so the claim-import preview can match soft-deleted TPAs it will
    // reactivate on import; `?active=true|false` filters explicitly.
    const { active } = req.query;
    const where = active === 'all'
      ? {}
      : { isActive: active === undefined ? true : active === 'true' };
    const items = await prisma.tPA.findMany({
      where,
      orderBy: { name: 'asc' },
    });
    res.json(toResponse(items));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.update = async (req, res) => {
  try {
    const item = await prisma.tPA.update({
      where: { id: req.params.id },
      data: pickFields(req.body),
    });
    res.json(toResponse(item));
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'Not found' });
    if (error.code === 'P2002') return res.status(400).json({ message: 'TPA name already exists' });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Merge one TPA into another to consolidate duplicate masters (same company
// entered twice). Moves every claim from `sourceId` to `targetId`, swaps the id
// inside hospital over-limit TPA lists, then deletes the source. One transaction
// so a failure leaves the data untouched.
exports.merge = async (req, res) => {
  try {
    const { sourceId, targetId } = req.body;
    if (!sourceId || !targetId) return res.status(400).json({ message: 'Pick both the TPA to keep and the one to remove' });
    if (sourceId === targetId) return res.status(400).json({ message: 'Cannot merge a TPA into itself' });

    const [source, target] = await Promise.all([
      prisma.tPA.findUnique({ where: { id: sourceId }, select: { id: true, name: true } }),
      prisma.tPA.findUnique({ where: { id: targetId }, select: { id: true, name: true } }),
    ]);
    if (!source || !target) return res.status(404).json({ message: 'TPA not found' });

    const result = await prisma.$transaction(async (tx) => {
      const claims = await tx.claim.updateMany({ where: { tpaId: sourceId }, data: { tpaId: targetId } });
      // overLimitTpaIds is a JSON array (no FK), so swap the id in place.
      const svcs = await tx.hospitalBillingService.findMany({ select: { id: true, overLimitTpaIds: true } });
      let services = 0;
      for (const s of svcs) {
        const arr = Array.isArray(s.overLimitTpaIds) ? s.overLimitTpaIds : [];
        if (arr.includes(sourceId)) {
          const next = [...new Set(arr.map((id) => (id === sourceId ? targetId : id)))];
          await tx.hospitalBillingService.update({ where: { id: s.id }, data: { overLimitTpaIds: next } });
          services += 1;
        }
      }
      await tx.tPA.delete({ where: { id: sourceId } });
      return { claims: claims.count, services };
    });

    res.json({ message: `Merged "${source.name}" into "${target.name}" — ${result.claims} claim(s) moved`, ...result });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.bulkImport = async (req, res) => {
  try {
    const { rows } = req.body;
    const mode = req.body.mode === 'replace' ? 'replace' : 'skip';
    if (!Array.isArray(rows) || !rows.length) {
      return res.status(400).json({ message: 'rows (non-empty array) is required' });
    }
    if (rows.length > 2000) return res.status(400).json({ message: 'Maximum 2000 rows per import' });

    const existing = await prisma.tPA.findMany({ select: { id: true, name: true, isActive: true } });
    const statusRows = await prisma.claimStatus.findMany({ select: { slug: true } });
    const validSlugs = new Set(statusRows.map(s => s.slug));
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

      if (rowErrors.length) { errors.push({ row: rowNum, name, errors: rowErrors }); continue; }

      const activeExisting = activeMap.get(key);
      if (activeExisting && mode === 'skip') {
        seenInBatch.add(key);
        skipped.push({ row: rowNum, id: activeExisting.id, name });
        continue;
      }

      try {
        const data = pickFields({ name, address: row.address, contactPerson: row.contactPerson, mobile: row.mobile, email: row.email });
        data.statusAutomation = parseStatusAutomationCell(row.statusAutomation, validSlugs);
        const inactive = inactiveMap.get(key);
        if (activeExisting) {
          const item = await prisma.tPA.update({
            where: { id: activeExisting.id },
            data,
            select: { id: true, name: true },
          });
          seenInBatch.add(key);
          updated.push({ row: rowNum, id: item.id, name: item.name });
        } else if (inactive) {
          const item = await prisma.tPA.update({
            where: { id: inactive.id },
            data: { ...data, isActive: true },
            select: { id: true, name: true },
          });
          seenInBatch.add(key);
          updated.push({ row: rowNum, id: item.id, name: item.name });
        } else {
          const item = await prisma.tPA.create({ data, select: { id: true, name: true } });
          seenInBatch.add(key);
          created.push({ row: rowNum, id: item.id, name: item.name });
        }
      } catch (e) {
        errors.push({ row: rowNum, name, errors: [e.message || 'Failed to save'] });
      }
    }
    const successCount = created.length + updated.length;
    res.status(errors.length && !successCount && !skipped.length ? 400 : 200).json({
      message: `Imported ${successCount} of ${rows.length} TPA(s)`,
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

// Bulk-apply one Status Automation config to many TPAs at once. Replaces
// (overwrites) each selected TPA's statusAutomation with the given rule set.
// An empty/omitted rule set clears automation on the selected rows.
exports.bulkStatusAutomation = async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || !ids.length) {
      return res.status(400).json({ message: 'ids (non-empty array) is required' });
    }
    const statusRows = await prisma.claimStatus.findMany({ select: { slug: true } });
    const validSlugs = new Set(statusRows.map((s) => s.slug));
    const statusAutomation = sanitizeStatusAutomation(req.body.statusAutomation, validSlugs);
    const result = await prisma.tPA.updateMany({
      where: { id: { in: ids }, isActive: true },
      data: { statusAutomation },
    });
    res.json({ message: `Status automation applied to ${result.count} TPA(s)`, count: result.count });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.remove = async (req, res) => {
  try {
    await prisma.tPA.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });
    res.json({ message: 'Deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
