import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LabAPI } from '../api'

/** Format a numeric string in Indian style: 198000 → 1,98,000 */
function formatIndianNumber(raw) {
  if (raw == null) return ''
  const str = String(raw).trim()
  if (!str) return ''
  const cleaned = str.replace(/,/g, '')
  const match = cleaned.match(/^(-?)(\d+)(?:\.(\d+))?$/)
  if (!match) return str

  const sign = match[1]
  let intPart = match[2]
  const decPart = match[3]
  // Keep leading zeros only if the whole integer is zeros
  intPart = intPart.replace(/^0+(?=\d)/, '') || '0'

  let formatted
  if (intPart.length <= 3) {
    formatted = intPart
  } else {
    const last3 = intPart.slice(-3)
    let rest = intPart.slice(0, -3)
    const groups = []
    while (rest.length > 2) {
      groups.unshift(rest.slice(-2))
      rest = rest.slice(0, -2)
    }
    if (rest) groups.unshift(rest)
    formatted = `${groups.join(',')},${last3}`
  }
  return `${sign}${formatted}${decPart != null ? `.${decPart}` : ''}`
}

function valuesFromBooking(detail) {
  const next = {}
  ;(detail?.tests || []).forEach((entry) => {
    ;(entry.results || []).forEach((r) => {
      next[r.id] = formatIndianNumber(r.value || '')
    })
  })
  return next
}

function parseNumber(raw) {
  if (raw == null || raw === '') return null
  const cleaned = String(raw).replace(/,/g, '').trim().replace(/^[<≤>≥]=?\s*/, '')
  if (!cleaned) return null
  const num = Number(cleaned)
  return Number.isFinite(num) ? num : null
}

/** Drop a leading < or > so lipid results can be stored as the number alone. */
function bareNumericResult(raw) {
  const text = String(raw ?? '').trim()
  const stripped = text.replace(/^[<≤>≥]=?\s*/, '')
  if (stripped !== text && /^-?\d+(\.\d+)?$/.test(stripped.replace(/,/g, ''))) return stripped
  return text
}

const WIDAL_ROWS = [
  'SALMONELLA TYPHI O',
  'SALMONELLA TYPHI H',
  'SALMONELLA PARATYPHI (AH)',
  'SALMONELLA PARATYPHI (BH)',
]
const WIDAL_COLS = ['1/20', '1/40', '1/80', '1/160', '1/320']
const WIDAL_RESULT = 'RESULT'

function isWidalTest(test) {
  if (!test) return false
  if (test.layout === 'widal_matrix') return true
  const name = String(test.name || '').trim().toLowerCase()
  return name === 'widal test' || name === 'widal'
}

function widalCellName(row, col) {
  return `${row} @ ${col}`
}

function cycleAgglutination(current) {
  const v = String(current || '').trim()
  if (v === '+') return '-'
  if (v === '-') return ''
  return '+'
}

function normalizeParamName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** True for any Hb entry field — Female, Male, or generic (not MCH / MCHC / A1c). */
function isHaemoglobinParam(name) {
  const n = normalizeParamName(name)
  if (/mchc|mch\b|a1c|glycosylated|mean cell|corpuscular/.test(n)) return false
  // Same trigger for "Haemoglobin (Female)", "Haemoglobin (Male)", "HAEMOGLOBIN (Hb)", etc.
  return (
    /\bhaemoglobin\b/.test(n)
    || /\bhemoglobin\b/.test(n)
    || /(^|\s)hb(\s|$)/.test(n)
  )
}

/** Map CBC parameter → derived key from Hb. */
function cbcDerivedKey(name) {
  const n = normalizeParamName(name)
  if (/\bmcv\b|mean cell volume/.test(n)) return 'mcv'
  if (/\bmchc\b|corpuscular hb conc|mean corpuscular hb/.test(n)) return 'mchc'
  if (/\bmch\b|mean cell haemoglobin|mean cell hemoglobin/.test(n)) return 'mch'
  if (/packed cell volume|\bpcv\b|hematocrit|haematocrit/.test(n)) return 'pcv'
  if (/red blood cells|\brbc count\b|\brbc\b/.test(n) && !/width|absolute|nucleated/.test(n)) return 'rbc'
  return null
}

/**
 * Rule-of-three CBC estimates from Hb (g/dL), matching common lab software:
 *   PCV = Hb × 3
 *   RBC = Hb ÷ 3
 *   MCV = (PCV ÷ RBC) × 10
 *   MCH = (Hb ÷ RBC) × 10
 *   MCHC = (Hb ÷ PCV) × 100
 * Example: Hb 14 → RBC 4.67, PCV 42.00, MCV 89.94, MCH 29.98, MCHC 33.33
 */
function calcCbcFromHb(hb) {
  if (hb == null || !Number.isFinite(hb) || hb <= 0) return null
  // Round PCV/RBC first (same as common lab software), then derive indices.
  const pcv = Number((hb * 3).toFixed(2))
  const rbc = Number((hb / 3).toFixed(2))
  if (rbc <= 0 || pcv <= 0) return null
  return {
    rbc: rbc.toFixed(2),
    pcv: pcv.toFixed(2),
    mcv: ((pcv / rbc) * 10).toFixed(2),
    mch: ((hb / rbc) * 10).toFixed(2),
    mchc: ((hb / pcv) * 100).toFixed(2),
  }
}

function dlcPercentKey(name) {
  const n = normalizeParamName(name)
  if (/absolute/.test(n)) return null
  if (/neutrophil/.test(n)) return 'neutrophils'
  if (/lymphocyte/.test(n)) return 'lymphocytes'
  if (/monocyte/.test(n)) return 'monocytes'
  if (/eosinophil/.test(n)) return 'eosinophils'
  if (/basophil/.test(n)) return 'basophils'
  return null
}

function dlcAbsoluteKey(name) {
  const n = normalizeParamName(name)
  if (!/absolute/.test(n)) return null
  if (/neutrophil/.test(n)) return 'neutrophils'
  if (/lymphocyte/.test(n)) return 'lymphocytes'
  if (/monocyte/.test(n)) return 'monocytes'
  if (/eosinophil/.test(n)) return 'eosinophils'
  if (/basophil/.test(n)) return 'basophils'
  return null
}

function isWbcParam(name) {
  const n = normalizeParamName(name)
  return /total leucocytes|wbc count|(^|\s)wbc(\s|$)|(^|\s)tlc(\s|$)/.test(n)
}

/** Lab-style 2-digit DLC percent: 50, 20, 18, 12, 00 */
function formatDlcPercent(n) {
  const v = Math.max(0, Math.round(Number(n) || 0))
  return String(v).padStart(2, '0')
}

/**
 * Fill Monocytes / Eosinophils / Basophils so DLC totals 100%.
 * Works when Neutrophils and/or Lymphocytes are entered (missing treated as 0):
 *   Basophils = 0
 *   of remainder: Monocytes 60%, Eosinophils 40%
 * Examples:
 *   N=50, L=20 → M=18, E=12, B=00
 *   L=40 only  → M=36, E=24, B=00
 */
function calcDlcRemainder(neutrophils, lymphocytes) {
  const hasN = neutrophils != null && Number.isFinite(neutrophils)
  const hasL = lymphocytes != null && Number.isFinite(lymphocytes)
  if (!hasN && !hasL) return null
  const n = hasN ? neutrophils : 0
  const l = hasL ? lymphocytes : 0
  const rem = Math.round(100 - n - l)
  if (rem < 0) return null
  const monocytes = Math.round(rem * 0.6)
  const eosinophils = rem - monocytes
  return {
    monocytes: formatDlcPercent(monocytes),
    eosinophils: formatDlcPercent(eosinophils),
    basophils: formatDlcPercent(0),
  }
}

/** Protein / Albumin / Globulin / A:G fields on biochemistry panels. */
function proteinFieldKey(name) {
  const n = normalizeParamName(name)
  if (/c reactive|electrophoresis/.test(n)) return null
  if (
    /a g ratio/.test(n)
    || /albumin globulin ratio/.test(n)
    || (/ratio/.test(n) && /albumin|globulin|a g/.test(n))
  ) {
    return 'ag_ratio'
  }
  if (/globulin/.test(n) && !/albumin/.test(n)) return 'globulin'
  if (/albumin/.test(n) && !/globulin|ratio/.test(n)) return 'albumin'
  // PROTEIN TOTAL, PROTEIN - TOTAL, S.PROTEIN, etc.
  if (/protein/.test(n) && (/total/.test(n) || /(^|\s)s protein(\s|$)/.test(n))) {
    return 'protein'
  }
  return null
}

/** Bilirubin total / conjugated(direct) / unconjugated(indirect). */
function bilirubinFieldKey(name) {
  const n = normalizeParamName(name)
  if (!/bilirubin/.test(n)) return null
  // urine/qualitative single "Bilirubin" rows — skip
  if (n === 'bilirubin') return null
  if (/unconjugated|uconjugated|indirect/.test(n)) return 'unconjugated'
  if (/conjugated|direct/.test(n) && !/unconjugated|uconjugated|indirect/.test(n)) {
    return 'conjugated'
  }
  if (/total/.test(n) || /serum bilirubin/.test(n)) return 'total'
  return null
}

/** LFT enzymes: SGOT (AST), SGPT (ALT), and their ratio. */
function liverEnzymeKey(name) {
  const n = normalizeParamName(name)
  if (/ratio/.test(n) && /sgot|ast/.test(n) && /sgpt|alt/.test(n)) return 'ratio'
  if (/sgot\s*\/\s*sgpt|ast\s*\/\s*alt/.test(n)) return 'ratio'
  if (/(^|\s)sgot(\s|$)|aspartate|\bast\b/.test(n) && !/sgpt|alt|ratio/.test(n)) return 'sgot'
  if (/(^|\s)sgpt(\s|$)|alanine|\balt\b/.test(n) && !/sgot|ast|ratio/.test(n)) return 'sgpt'
  return null
}

/**
 * Renal fields.
 * From lab software screenshot (Urea=15, Crea=1):
 *   BUN = Urea × 28/60 → 7.00
 *   BLOOD UREA NITROGEN / CREATININE RATIO = BUN / Crea → 7.00
 *   Bun / Creatinine (short name) = Urea / Crea → 15.00
 */
function renalFieldKey(name) {
  const n = normalizeParamName(name)
  // Long BUN/Creatinine ratio (uses calculated BUN)
  if (/nitrogen/.test(n) && /creatinine/.test(n)) return 'bun_crea_ratio'
  if (/ratio/.test(n) && /bun|urea nitrogen/.test(n) && /creatinine/.test(n)) return 'bun_crea_ratio'
  // Short "Bun / Creatinine" (uses Urea ÷ Creatinine in reference software)
  if (/\bbun\b/.test(n) && /creatinine/.test(n) && !/nitrogen/.test(n)) return 'urea_crea_ratio'
  if (/urea/.test(n) && /creatinine/.test(n)) return 'urea_crea_ratio'
  if (/urea nitrogen|\bbun\b/.test(n) && !/creatinine/.test(n)) return 'bun'
  if (/urea/.test(n) && !/nitrogen|bun|creatinine/.test(n)) return 'urea'
  if (/creatinine/.test(n) && !/bun|urea|clearance/.test(n)) return 'creatinine'
  return null
}

/** HbA1c → Estimated Average Glucose (eAG = 28.7 × A1c − 46.7). */
function hba1cFieldKey(name) {
  const n = normalizeParamName(name)
  if (/estimated average glucose|\beag\b/.test(n)) return 'eag'
  if (/glycosylated|hba1c|hb a1c|hemoglobin a1c|haemoglobin a1c|\ba1c\b/.test(n)) {
    return 'a1c'
  }
  return null
}

/**
 * Prothrombin Time fields.
 * Inputs: CONTROL, TEST, (optional ISI)
 *   INDEX = Control / Test
 *   PTI = (Control / Test) × 100
 *   Patient Ratio = 100 / Test
 *   INR = (Test / Control) ^ ISI  (ISI defaults to 1 if blank)
 * Example: Control 12, Test 7 → Index 1.71, PTI 171.43, Ratio 14.29, INR 0.58
 */
function ptFieldKey(name) {
  const n = normalizeParamName(name)
  if (/^isi\b|isi value/.test(n)) return 'isi'
  if (/^inr\b|\binr\b/.test(n)) return 'inr'
  if (/^pti\b|\bpti\b|prothrombin time index/.test(n)) return 'pti'
  if (/patient ratio|pt ratio/.test(n)) return 'patient_ratio'
  if (/^index\b|\bindex\b/.test(n) && !/glyc|body|cardiac/.test(n)) return 'index'
  if (/^control\b|\bcontrol\b/.test(n)) return 'control'
  if (/^test\b|\btest\b/.test(n) && !/sensitivity|tolerance/.test(n)) return 'test'
  return null
}

/**
 * Lipid profile fields.
 * Inputs: TC, HDL, TG → VLDL, LDL, ratios, NON-HDL, Total Lipids
 */
function lipidFieldKey(name) {
  const n = normalizeParamName(name)
  if (/non hdl|nonhdl/.test(n)) return 'non_hdl'
  if (/vldl/.test(n)) return 'vldl'
  if (/ldl/.test(n) && /hdl/.test(n) && /ratio/.test(n)) return 'ldl_hdl_ratio'
  if (/cholesterol/.test(n) && /hdl/.test(n) && /ratio/.test(n)) return 'tc_hdl_ratio'
  if (/total lipid/.test(n)) return 'total_lipids'
  if (/ldl/.test(n) && !/hdl|ratio|vldl/.test(n)) return 'ldl'
  if (/hdl/.test(n) && !/ldl|ratio|non|vldl|total cholesterol/.test(n)) return 'hdl'
  if (/triglyceride/.test(n)) return 'tg'
  if (
    (/total cholesterol/.test(n) || /serum cholesterol/.test(n) || n === 'cholesterol')
    && !/hdl|ldl|ratio|vldl|non/.test(n)
  ) {
    return 'tc'
  }
  return null
}

/**
 * Lab autofill for CBC + Biochemistry:
 * - Hb (Female or Male): RBC / PCV / MCV / MCH / MCHC (+ mirror generic Hb)
 * - Neutrophils / Lymphocytes: Monocytes / Eosinophils / Basophils (sum 100)
 * - WBC + DLC %: Absolute counts
 * - Protein + Albumin → Globulin + A/G (empty protein treated as 0)
 *   Example: Protein 6, Albumin 3 → Globulin 3.00, A/G 1.00
 *   Example: Albumin 1 only → Globulin -1.00, A/G -1.00
 * - Bilirubin Total + Direct → Indirect
 * - SGOT + SGPT → SGOT/SGPT Ratio
 * - RFT: Urea → BUN (×28/60); BUN/Crea ratio; Urea/Crea ("Bun / Creatinine")
 *   Example: Urea 15, Crea 1 → BUN 7.00, BUN/Crea 7.00, Urea/Crea 15.00
 * - Prothrombin Time: Control + Test → Index, PTI, Patient Ratio, INR
 *   Example: Control 12, Test 7 → Index 1.71, PTI 171.43, Ratio 14.29, INR 0.58
 * - HbA1c → Estimated Average Glucose (28.7 × A1c − 46.7)
 *   Example: A1c 5 → eAG 96.80
 * - Lipid profile (TC, HDL, TG):
 *   VLDL = TG / 5
 *   LDL = TC − HDL − VLDL
 *   NON-HDL = TC − HDL
 *   TC/HDL, LDL/HDL ratios
 *   Total Lipids = 2×TC + TG
 *   Example: 200, 50, 150 → VLDL 30, LDL 120, ratios 4.00 / 2.40, NON-HDL 150, lipids 550
 */
function applyCbcAutofill(results, values, changedId, rawValue, lockedIds) {
  const list = results || []
  const changed = list.find((r) => r.id === changedId)
  let next = { ...values, [changedId]: rawValue }
  if (!changed) return { values: next, autofilledIds: [] }
  // Snapshot after applying the manual edit — anything else that changes is autofill.
  const afterManual = { ...next }
  const locked = lockedIds || new Set()
  const sameId = (a, b) => a != null && b != null && String(a) === String(b)
  const userLocked = (id) => locked.has(id) || locked.has(String(id)) || locked.has(Number(id))
  const unlock = (id) => {
    locked.delete(id)
    locked.delete(String(id))
    locked.delete(Number(id))
  }
  // Keep a typed result until one of its source fields changes. Editing the
  // calculated field itself never gets replaced on that same keystroke.
  const setCalc = (id, value, sourceIds) => {
    if (sameId(id, changedId)) return
    const sourceTouched = (sourceIds || []).some((sid) => {
      if (sid == null) return false
      if (sameId(sid, changedId)) return true
      return String(next[sid] ?? '') !== String(afterManual[sid] ?? '')
    })
    if (userLocked(id) && !sourceTouched) return
    if (sourceTouched) unlock(id)
    next[id] = value
  }

  // --- Haemoglobin → red-cell indices (same for Female & Male) ---
  if (isHaemoglobinParam(changed.name)) {
    const changedNorm = normalizeParamName(changed.name)
    const isGenderSpecific = /\bfemale\b|\bmale\b/.test(changedNorm)
    list.forEach((r) => {
      if (r.id === changedId || !isHaemoglobinParam(r.name)) return
      const n = normalizeParamName(r.name)
      const otherIsGender = /\bfemale\b|\bmale\b/.test(n)
      if (isGenderSpecific && !otherIsGender) setCalc(r.id, rawValue, [changedId])
    })
    const derived = calcCbcFromHb(parseNumber(rawValue))
    if (derived) {
      list.forEach((r) => {
        const key = cbcDerivedKey(r.name)
        if (!key || !derived[key]) return
        setCalc(r.id, formatIndianNumber(derived[key]), [changedId])
      })
    }
  }

  // --- DLC: N + L filled → auto M / E / B ---
  const byDlc = {}
  list.forEach((r) => {
    const key = dlcPercentKey(r.name)
    if (key) byDlc[key] = r
  })
  const nVal = byDlc.neutrophils
    ? parseNumber(byDlc.neutrophils.id === changedId ? rawValue : next[byDlc.neutrophils.id])
    : null
  const lVal = byDlc.lymphocytes
    ? parseNumber(byDlc.lymphocytes.id === changedId ? rawValue : next[byDlc.lymphocytes.id])
    : null
  const dlcRest = calcDlcRemainder(nVal, lVal)
  if (dlcRest) {
    ;['monocytes', 'eosinophils', 'basophils'].forEach((key) => {
      const row = byDlc[key]
      if (!row) return
      setCalc(row.id, dlcRest[key], [byDlc.neutrophils?.id, byDlc.lymphocytes?.id])
    })
  }

  // --- Absolute counts from WBC × % ---
  const wbcRow = list.find((r) => isWbcParam(r.name))
  const wbc = wbcRow
    ? parseNumber(wbcRow.id === changedId ? rawValue : next[wbcRow.id])
    : null
  if (wbc != null && wbc > 0) {
    const pct = {
      neutrophils: nVal,
      lymphocytes: lVal,
      monocytes: byDlc.monocytes ? parseNumber(next[byDlc.monocytes.id]) : null,
      eosinophils: byDlc.eosinophils ? parseNumber(next[byDlc.eosinophils.id]) : null,
      basophils: byDlc.basophils ? parseNumber(next[byDlc.basophils.id]) : null,
    }
    list.forEach((r) => {
      const key = dlcAbsoluteKey(r.name)
      if (!key || pct[key] == null) return
      setCalc(
        r.id,
        formatIndianNumber(String(Math.round((wbc * pct[key]) / 100))),
        [wbcRow?.id, byDlc[key]?.id],
      )
    })
  }

  // --- Protein: Globulin = Protein − Albumin; A/G = Albumin ÷ Globulin ---
  // Empty inputs treated as 0 (matches reference lab software on RFT).
  const byProtein = {}
  list.forEach((r) => {
    const key = proteinFieldKey(r.name)
    if (key) byProtein[key] = r
  })
  if (byProtein.albumin && byProtein.globulin) {
    const proteinRaw = byProtein.protein
      ? parseNumber(byProtein.protein.id === changedId ? rawValue : next[byProtein.protein.id])
      : null
    const albuminRaw = parseNumber(
      byProtein.albumin.id === changedId ? rawValue : next[byProtein.albumin.id],
    )
    if (proteinRaw != null || albuminRaw != null) {
      const protein = proteinRaw ?? 0
      const albumin = albuminRaw ?? 0
      const globulin = Number((protein - albumin).toFixed(2))
      const proteinSources = [byProtein.protein?.id, byProtein.albumin.id]
      setCalc(byProtein.globulin.id, formatIndianNumber(globulin.toFixed(2)), proteinSources)
      if (byProtein.ag_ratio && globulin !== 0) {
        setCalc(
          byProtein.ag_ratio.id,
          formatIndianNumber((albumin / globulin).toFixed(2)),
          [...proteinSources, byProtein.globulin.id],
        )
      } else if (byProtein.ag_ratio && globulin === 0) {
        setCalc(byProtein.ag_ratio.id, '', [...proteinSources, byProtein.globulin.id])
      }
    }
  }

  // --- Bilirubin: Indirect/Unconjugated = Total − Direct/Conjugated ---
  const byBili = {}
  list.forEach((r) => {
    const key = bilirubinFieldKey(r.name)
    if (key) byBili[key] = r
  })
  if (byBili.total && byBili.conjugated && byBili.unconjugated) {
    const total = parseNumber(
      byBili.total.id === changedId ? rawValue : next[byBili.total.id],
    )
    const conjugated = parseNumber(
      byBili.conjugated.id === changedId ? rawValue : next[byBili.conjugated.id],
    )
    if (total != null && conjugated != null) {
      const unconjugated = Number((total - conjugated).toFixed(2))
      setCalc(
        byBili.unconjugated.id,
        formatIndianNumber(unconjugated.toFixed(2)),
        [byBili.total.id, byBili.conjugated.id],
      )
    }
  }

  // --- LFT: SGOT/SGPT Ratio = SGOT ÷ SGPT ---
  const byLiver = {}
  list.forEach((r) => {
    const key = liverEnzymeKey(r.name)
    if (key) byLiver[key] = r
  })
  if (byLiver.sgot && byLiver.sgpt && byLiver.ratio) {
    const sgot = parseNumber(
      byLiver.sgot.id === changedId ? rawValue : next[byLiver.sgot.id],
    )
    const sgpt = parseNumber(
      byLiver.sgpt.id === changedId ? rawValue : next[byLiver.sgpt.id],
    )
    if (sgot != null && sgpt != null && sgpt !== 0) {
      setCalc(
        byLiver.ratio.id,
        formatIndianNumber((sgot / sgpt).toFixed(2)),
        [byLiver.sgot.id, byLiver.sgpt.id],
      )
    }
  }

  // --- RFT calculations ---
  const byRenal = {}
  list.forEach((r) => {
    const key = renalFieldKey(r.name)
    if (key) byRenal[key] = r
  })
  const readRenal = (key) => {
    const row = byRenal[key]
    if (!row) return null
    return parseNumber(row.id === changedId ? rawValue : next[row.id])
  }
  let urea = readRenal('urea')
  let bun = readRenal('bun')
  const crea = readRenal('creatinine')

  // BUN from Urea. A typed BUN stays until urea itself changes.
  if (byRenal.urea && byRenal.bun && urea != null) {
    const computedBun = Number(((urea * 28) / 60).toFixed(2))
    setCalc(
      byRenal.bun.id,
      formatIndianNumber(computedBun.toFixed(2)),
      [byRenal.urea.id],
    )
    bun = parseNumber(next[byRenal.bun.id])
  }

  // BLOOD UREA NITROGEN / CREATININE RATIO = BUN ÷ Creatinine
  if (byRenal.bun_crea_ratio && bun != null && crea != null && crea !== 0) {
    setCalc(
      byRenal.bun_crea_ratio.id,
      formatIndianNumber((bun / crea).toFixed(2)),
      [byRenal.urea?.id, byRenal.bun.id, byRenal.creatinine?.id],
    )
  }

  // Short "Bun / Creatinine" = Urea ÷ Creatinine (reference software behaviour)
  if (byRenal.urea_crea_ratio && urea != null && crea != null && crea !== 0) {
    setCalc(
      byRenal.urea_crea_ratio.id,
      formatIndianNumber((urea / crea).toFixed(2)),
      [byRenal.urea.id, byRenal.creatinine?.id],
    )
  }

  // --- HbA1c → Estimated Average Glucose ---
  const byA1c = {}
  list.forEach((r) => {
    const key = hba1cFieldKey(r.name)
    if (key) byA1c[key] = r
  })
  if (byA1c.a1c && byA1c.eag) {
    const a1c = parseNumber(
      byA1c.a1c.id === changedId ? rawValue : next[byA1c.a1c.id],
    )
    if (a1c != null) {
      // ADA formula: eAG (mg/dL) = 28.7 × A1c − 46.7
      const eag = Number((28.7 * a1c - 46.7).toFixed(2))
      setCalc(byA1c.eag.id, formatIndianNumber(eag.toFixed(2)), [byA1c.a1c.id])
    }
  }

  // --- Prothrombin Time ---
  const byPt = {}
  list.forEach((r) => {
    const key = ptFieldKey(r.name)
    if (key) byPt[key] = r
  })
  if (byPt.control && byPt.test) {
    const control = parseNumber(
      byPt.control.id === changedId ? rawValue : next[byPt.control.id],
    )
    const test = parseNumber(
      byPt.test.id === changedId ? rawValue : next[byPt.test.id],
    )
    const isiRaw = byPt.isi
      ? parseNumber(byPt.isi.id === changedId ? rawValue : next[byPt.isi.id])
      : null
    if (control != null && test != null && test !== 0 && control !== 0) {
      const index = Number((control / test).toFixed(2))
      const pti = Number(((control / test) * 100).toFixed(2))
      const patientRatio = Number((100 / test).toFixed(2))
      const isi = isiRaw != null && isiRaw > 0 ? isiRaw : 1
      const inr = Number((test / control) ** isi).toFixed(2)

      const ptSources = [byPt.control.id, byPt.test.id, byPt.isi?.id]
      if (byPt.index) setCalc(byPt.index.id, formatIndianNumber(index.toFixed(2)), ptSources)
      if (byPt.pti) setCalc(byPt.pti.id, formatIndianNumber(pti.toFixed(2)), ptSources)
      if (byPt.patient_ratio) {
        setCalc(byPt.patient_ratio.id, formatIndianNumber(patientRatio.toFixed(2)), ptSources)
      }
      if (byPt.inr) setCalc(byPt.inr.id, formatIndianNumber(String(inr)), ptSources)
    }
  }

  // --- Lipid profile ---
  const byLipid = {}
  list.forEach((r) => {
    const key = lipidFieldKey(r.name)
    if (key) byLipid[key] = r
  })
  const hasLipidInputs = byLipid.tc || byLipid.hdl || byLipid.tg
  const hasLipidOutputs = byLipid.ldl || byLipid.vldl || byLipid.non_hdl
    || byLipid.tc_hdl_ratio || byLipid.ldl_hdl_ratio || byLipid.total_lipids
  if (hasLipidInputs && hasLipidOutputs) {
    const readLipid = (key) => {
      const row = byLipid[key]
      if (!row) return null
      return parseNumber(row.id === changedId ? rawValue : next[row.id])
    }
    const tcRaw = readLipid('tc')
    const hdlRaw = readLipid('hdl')
    const tgRaw = readLipid('tg')
    // Recalculate when any input is present (empty treated as 0, matching lab software).
    if (tcRaw != null || hdlRaw != null || tgRaw != null) {
      const tc = tcRaw ?? 0
      const hdl = hdlRaw ?? 0
      const tg = tgRaw ?? 0
      const vldl = Number((tg / 5).toFixed(2))
      const ldl = Number((tc - hdl - vldl).toFixed(2))
      const nonHdl = Number((tc - hdl).toFixed(2))
      const totalLipids = Number((2 * tc + tg).toFixed(2))

      const tcHdlTg = [byLipid.tc?.id, byLipid.hdl?.id, byLipid.tg?.id]
      if (byLipid.vldl) {
        setCalc(byLipid.vldl.id, formatIndianNumber(vldl.toFixed(2)), [byLipid.tg?.id])
      }
      if (byLipid.ldl) setCalc(byLipid.ldl.id, formatIndianNumber(ldl.toFixed(2)), tcHdlTg)
      if (byLipid.non_hdl) {
        setCalc(byLipid.non_hdl.id, formatIndianNumber(nonHdl.toFixed(2)), [byLipid.tc?.id, byLipid.hdl?.id])
      }
      if (byLipid.total_lipids) {
        setCalc(
          byLipid.total_lipids.id,
          formatIndianNumber(totalLipids.toFixed(2)),
          [byLipid.tc?.id, byLipid.tg?.id],
        )
      }
      if (byLipid.tc_hdl_ratio) {
        setCalc(
          byLipid.tc_hdl_ratio.id,
          hdl ? formatIndianNumber((tc / hdl).toFixed(2)) : '',
          [byLipid.tc?.id, byLipid.hdl?.id],
        )
      }
      if (byLipid.ldl_hdl_ratio) {
        setCalc(
          byLipid.ldl_hdl_ratio.id,
          hdl ? formatIndianNumber((ldl / hdl).toFixed(2)) : '',
          tcHdlTg,
        )
      }
    }
  }

  const autofilledIds = Object.keys(next)
    .filter((key) => String(key) !== String(changedId) && next[key] !== afterManual[key])
    .map((key) => {
      const n = Number(key)
      return Number.isFinite(n) ? n : key
    })
  return { values: next, autofilledIds }
}

/** Returns 'in' | 'high' | 'low' | null when range cannot be compared.
 *  Lipid bands (Desirable / Normal / Optimal / Major risk) use that cutoff,
 *  so the user types 180 — not <180 or >180.
 */
function evaluateResultRange(value, referenceRange) {
  const num = parseNumber(value)
  if (num == null) return null
  const range = String(referenceRange || '').trim()
  if (!range) return null

  const majorRisk = range.match(/major risk\s*:\s*[<≤]\s*(-?\d+(?:\.\d+)?)/i)
  if (majorRisk) {
    const limit = parseNumber(majorRisk[1])
    if (limit == null) return null
    return num < limit ? 'low' : 'in'
  }

  const goodUpto = range.match(/(?:desirable|normal|optimal)\s*:\s*(?:upto|up to)\s*(-?\d+(?:\.\d+)?)/i)
  if (goodUpto) {
    const limit = parseNumber(goodUpto[1])
    if (limit == null) return null
    return num <= limit ? 'in' : 'high'
  }

  const goodLess = range.match(/(?:desirable|normal|optimal)\s*:\s*[<≤]\s*(-?\d+(?:\.\d+)?)/i)
  if (goodLess) {
    const limit = parseNumber(goodLess[1])
    if (limit == null) return null
    return num < limit ? 'in' : 'high'
  }

  const goodGreater = range.match(/(?:desirable|normal|optimal|negative risk)\s*:\s*[>≥]\s*(-?\d+(?:\.\d+)?)/i)
  if (goodGreater) {
    const limit = parseNumber(goodGreater[1])
    if (limit == null) return null
    const inclusive = /[≥]|>=/.test(goodGreater[0])
    return (inclusive ? num >= limit : num > limit) ? 'in' : 'low'
  }

  // Deficiency / insufficiency only (Vitamin D): good is above the highest bad limit.
  if (/deficiency|insufficiency/i.test(range) && !/(?:normal|desirable|optimal|sufficient)\s*:/i.test(range)) {
    let ceiling = null
    for (const match of range.matchAll(/(-?\d+(?:\.\d+)?)\s*(?:-|–|—|to)\s*(-?\d+(?:\.\d+)?)/gi)) {
      const high = parseNumber(match[2])
      if (high != null) ceiling = ceiling == null ? high : Math.max(ceiling, high)
    }
    for (const match of range.matchAll(/below\s*(-?\d+(?:\.\d+)?)/gi)) {
      const high = parseNumber(match[1])
      if (high != null) ceiling = ceiling == null ? high : Math.max(ceiling, high)
    }
    if (ceiling != null) return num > ceiling ? 'in' : 'low'
  }

  const between = range.match(/(-?\d+(?:\.\d+)?)\s*(?:-|–|—|to)\s*(-?\d+(?:\.\d+)?)/i)
  if (between) {
    const low = parseNumber(between[1])
    const high = parseNumber(between[2])
    if (low == null || high == null) return null
    const min = Math.min(low, high)
    const max = Math.max(low, high)
    if (num < min) return 'low'
    if (num > max) return 'high'
    return 'in'
  }

  const less = range.match(/[<≤]\s*(-?\d+(?:\.\d+)?)/)
  if (less) {
    const limit = parseNumber(less[1])
    if (limit == null) return null
    return num < limit ? 'in' : 'high'
  }

  const greaterEq = range.match(/≥\s*(-?\d+(?:\.\d+)?)/)
  if (greaterEq) {
    const limit = parseNumber(greaterEq[1])
    if (limit == null) return null
    return num >= limit ? 'in' : 'low'
  }

  const greater = range.match(/>\s*(-?\d+(?:\.\d+)?)/)
  if (greater) {
    const limit = parseNumber(greater[1])
    if (limit == null) return null
    return num > limit ? 'in' : 'low'
  }

  const upto = range.match(/(?:upto|up to)\s*(-?\d+(?:\.\d+)?)/i)
  if (upto) {
    const limit = parseNumber(upto[1])
    if (limit == null) return null
    return num <= limit ? 'in' : 'high'
  }

  return null
}

export default function ReportModal({ bookingId, onClose, onCommitted }) {
  const [catalog, setCatalog] = useState([])
  const [booking, setBooking] = useState(null)
  const [filter, setFilter] = useState('')
  const [values, setValues] = useState({})
  const [autofilledIds, setAutofilledIds] = useState(() => new Set())
  const [status, setStatus] = useState('booked')
  const [dragIndex, setDragIndex] = useState(null)
  const manualResultIdsRef = useRef(new Set())

  function applyResultChange(results, changedId, rawValue) {
    setValues((prev) => {
      const previous = prev[changedId] ?? ''
      if (String(rawValue) !== String(previous)) {
        manualResultIdsRef.current.add(changedId)
        manualResultIdsRef.current.add(String(changedId))
      }
      const { values: next, autofilledIds: filled } = applyCbcAutofill(
        results,
        prev,
        changedId,
        rawValue,
        manualResultIdsRef.current,
      )
      // Schedule after this updater so we don't nest setState calls.
      queueMicrotask(() => {
        setAutofilledIds((prevFilled) => {
          const nextFilled = new Set(prevFilled)
          nextFilled.delete(changedId)
          nextFilled.delete(String(changedId))
          manualResultIdsRef.current.forEach((id) => {
            nextFilled.delete(id)
            nextFilled.delete(String(id))
          })
          filled.forEach((id) => {
            nextFilled.add(id)
            nextFilled.add(String(id))
          })
          return nextFilled
        })
      })
      return next
    })
  }
  const [openPanels, setOpenPanels] = useState(() => new Set())
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [saveHint, setSaveHint] = useState('')
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const dirtyRef = useRef(false)
  const closingRef = useRef(false)
  const panelRefs = useRef({})
  const bookingRef = useRef(null)
  const saveHintTimer = useRef(null)
  const messageTimer = useRef(null)
  bookingRef.current = booking

  function flashSaveHint(text = 'Saved') {
    setSaveHint(text)
    if (saveHintTimer.current) window.clearTimeout(saveHintTimer.current)
    saveHintTimer.current = window.setTimeout(() => setSaveHint(''), 1400)
  }

  function flashMessage(text) {
    setMessage(text)
    if (messageTimer.current) window.clearTimeout(messageTimer.current)
    messageTimer.current = window.setTimeout(() => setMessage(''), 1800)
  }

  function applyBooking(detail, preferOpenId, { syncValues = true } = {}) {
    setBooking(detail)
    setStatus(detail.status || 'booked')
    if (syncValues) {
      setValues(valuesFromBooking(detail))
      setAutofilledIds(new Set())
      manualResultIdsRef.current = new Set()
    }
    // Keep accordions collapsed by default; only open a panel the user just added.
    if (preferOpenId) {
      setOpenPanels((prev) => new Set(prev).add(Number(preferOpenId)))
    }
  }

  async function load(testId) {
    const [cat, detail] = await Promise.all([
      LabAPI.catalog(),
      LabAPI.booking(bookingId, testId || undefined),
    ])
    setCatalog(cat.categories || [])
    applyBooking(detail, testId)
    return detail
  }

  useEffect(() => {
    load().catch((err) => setError(err.message))
  }, [bookingId])

  useEffect(() => {
    const frame = requestAnimationFrame(() => setOpen(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  function requestClose() {
    if (closingRef.current) return
    closingRef.current = true
    setOpen(false)
    window.setTimeout(onClose, 460)
  }

  useEffect(() => {
    if (!dirtyRef.current) return undefined
    const snapshot = values
    const statusSnap = status
    const handle = setTimeout(async () => {
      const tests = bookingRef.current?.tests || []
      if (!tests.length) return
      const isDraft = (bookingRef.current?.status || 'draft') === 'draft'
      try {
        setSaveHint('Saving…')
        for (const entry of tests) {
          const payload = {}
          ;(entry.results || []).forEach((r) => {
            payload[r.id] = snapshot[r.id] ?? ''
          })
          const body = {
            action: 'save_results',
            test_id: entry.test.id,
            results: payload,
          }
          // Keep drafts off the Reports list until Save and Print.
          if (!isDraft) body.status = statusSnap
          else body.status = 'draft'
          await LabAPI.updateBooking(bookingId, body)
        }
        dirtyRef.current = false
        flashSaveHint(isDraft ? 'Draft saved' : 'Saved')
      } catch (err) {
        setSaveHint('')
        setError(err.message)
      }
    }, 500)
    return () => clearTimeout(handle)
  }, [values, status, bookingId])

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') requestClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (saveHintTimer.current) window.clearTimeout(saveHintTimer.current)
      if (messageTimer.current) window.clearTimeout(messageTimer.current)
    }
  }, [onClose])

  function focusNextResultInput(current) {
    const inputs = Array.from(document.querySelectorAll('.report-page input.result-input'))
    const index = inputs.indexOf(current)
    if (index === -1) return
    const next = inputs[index + 1]
    if (!next) return
    next.focus()
    next.select()
  }

  const selectedIds = useMemo(() => new Set(booking?.selected_test_ids || []), [booking])
  const selectedTests = booking?.tests || []

  async function reorderTests(fromIndex, toIndex) {
    if (fromIndex == null || toIndex == null || fromIndex === toIndex) return
    const next = [...selectedTests]
    const [moved] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, moved)
    setBooking((current) => (
      current
        ? { ...current, tests: next, selected_test_ids: next.map((entry) => entry.test.id) }
        : current
    ))
    try {
      const detail = await LabAPI.updateBooking(bookingId, {
        action: 'reorder_tests',
        ordered_ids: next.map((entry) => entry.test.id),
      })
      if (!dirtyRef.current) setBooking(detail)
    } catch (err) {
      setError(err.message)
    }
  }

  function scrollToPanel(testId) {
    const node = panelRefs.current[testId]
    if (node) node.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function selectTest(testId) {
    setError('')
    setMessage('')
    if (selectedIds.has(testId)) {
      setOpenPanels((prev) => new Set(prev).add(testId))
      scrollToPanel(testId)
      return
    }
    setBusy(true)
    try {
      if (dirtyRef.current && selectedTests.length) {
        dirtyRef.current = false
        const keepDraft = (bookingRef.current?.status || 'draft') === 'draft'
        for (const entry of selectedTests) {
          const payload = {}
          ;(entry.results || []).forEach((r) => {
            payload[r.id] = values[r.id] ?? ''
          })
          await LabAPI.updateBooking(bookingId, {
            action: 'save_results',
            test_id: entry.test.id,
            status: keepDraft ? 'draft' : status,
            results: payload,
          })
        }
      }
      await load(testId)
      requestAnimationFrame(() => scrollToPanel(Number(testId)))
      flashSaveHint('Test added')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  function togglePanel(testId) {
    setOpenPanels((prev) => {
      const next = new Set(prev)
      if (next.has(testId)) next.delete(testId)
      else next.add(testId)
      return next
    })
  }

  async function saveAll({ commit = false } = {}) {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      let detail = null
      const nextStatus = commit
        ? 'completed'
        : (bookingRef.current?.status || 'draft') === 'draft'
          ? 'draft'
          : status
      for (const entry of selectedTests) {
        const payload = {}
        ;(entry.results || []).forEach((r) => {
          payload[r.id] = values[r.id] ?? ''
        })
        detail = await LabAPI.updateBooking(bookingId, {
          action: 'save_results',
          test_id: entry.test.id,
          status: nextStatus,
          results: payload,
        })
      }
      dirtyRef.current = false
      if (detail) applyBooking(detail, undefined, { syncValues: false })
      if (commit) {
        setStatus('completed')
        flashMessage('Report saved')
      } else {
        flashMessage('Results saved')
      }
      return true
    } catch (err) {
      setError(err.message)
      return false
    } finally {
      setBusy(false)
    }
  }

  async function saveAndPrint() {
    const id = bookingId
    const ok = await saveAll({ commit: true })
    if (!ok) return
    onCommitted?.()
    window.open(LabAPI.printUrl(id), '_blank', 'noopener,noreferrer')
  }

  async function removeTest(testId) {
    setBusy(true)
    setError('')
    try {
      const detail = await LabAPI.updateBooking(bookingId, {
        action: 'remove_test',
        test_id: testId,
      })
      applyBooking(detail)
      setOpenPanels((prev) => {
        const next = new Set(prev)
        next.delete(testId)
        return next
      })
      flashMessage('Test removed from report')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const filteredCatalog = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return catalog
    return catalog
      .map((c) => ({
        ...c,
        tests: (c.tests || []).filter((t) => t.name.toLowerCase().includes(q)),
      }))
      .filter((c) => c.tests.length)
  }, [catalog, filter])

  return createPortal(
    <div className={`report-page ${open ? 'open' : ''}`} role="dialog" aria-modal="true">
      <div className="report-page-inner">
        <header className="modal-titlebar">
          <div className="modal-titlebar-start">
            <button className="btn btn-secondary report-back-btn" type="button" onClick={requestClose}>
              ← Back
            </button>
            <div>
              <h2>Report Entry</h2>
              <p>
                {booking?.report_no} · {booking?.patient?.name} · Age {booking?.patient?.age ?? '—'} ·{' '}
                {booking?.patient?.gender_display}
              </p>
            </div>
          </div>
          <div className="modal-titlebar-actions">
            <button
              className="btn btn-primary report-save-print-btn"
              type="button"
              disabled={busy || !selectedTests.length}
              onClick={saveAndPrint}
            >
              Save and Print
            </button>
          </div>
        </header>

        {error ? <div className="error-banner" style={{ margin: '0.75rem 1rem 0' }}>{error}</div> : null}
        {message ? <div className="success-banner" style={{ margin: '0.75rem 1rem 0' }}>{message}</div> : null}

        <div className="modal-body">
          <aside className="workspace-tests">
            <div className="workspace-tests-head">
              <h3>All Tests</h3>
              <input
                className="field-input"
                placeholder="Filter tests…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
            <div className="workspace-tests-list">
              {filteredCatalog.map((category) => (
                <details key={category.id} className="workspace-cat" open>
                  <summary>{category.name}</summary>
                  <ul>
                    {category.tests.map((test) => (
                      <li key={test.id}>
                        <button
                          type="button"
                          className={`workspace-test-link ${selectedIds.has(test.id) ? 'selected active' : ''}`}
                          onClick={() => selectTest(test.id)}
                          disabled={busy}
                        >
                          <span className="dot" />
                          <span className="label">{test.name}</span>
                          {selectedIds.has(test.id) ? <span className="pill">On report</span> : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          </aside>

          <section className="workspace-editor">
            <div className="result-toolbar">
              <div>
                <h3 className="panel-title result-section-heading" style={{ margin: 0 }}>Selected tests</h3>
                <p className="result-toolbar-meta">
                  {selectedTests.length
                    ? `${selectedTests.length} test${selectedTests.length === 1 ? '' : 's'} · drag to reorder · CBC stays first until you move it`
                    : 'No tests on this report yet'}
                  {saveHint ? <span className="autosave-state"> · {saveHint}</span> : null}
                </p>
              </div>
              <div className="field" style={{ minWidth: 180, margin: 0 }}>
                <label>Status</label>
                {status === 'draft' ? (
                  <div className="field-input" style={{ display: 'flex', alignItems: 'center', opacity: 0.85 }}>
                    Draft · not in Reports until Save and Print
                  </div>
                ) : (
                  <select
                    className="field-input"
                    value={status}
                    onChange={(e) => {
                      dirtyRef.current = true
                      setStatus(e.target.value)
                    }}
                  >
                    <option value="booked">Booked</option>
                    <option value="sample_collected">Sample Collected</option>
                    <option value="completed">Completed</option>
                  </select>
                )}
              </div>
            </div>

            {!selectedTests.length ? (
              <div className="workspace-empty">
                <h3>No selected tests</h3>
                <p>Choose a test from the left to add it and fill Result, Unit, and Range.</p>
              </div>
            ) : (
              <div className="result-accordion-list">
                {selectedTests.map((entry, index) => {
                  const testId = entry.test.id
                  const isOpen = openPanels.has(testId)
                  const filled = (entry.results || []).filter((r) => (values[r.id] || '').trim()).length
                  const total = (entry.results || []).length
                  return (
                    <div
                      key={entry.booking_test_id || testId}
                      className={`result-accordion ${isOpen ? 'open' : ''} ${dragIndex === index ? 'dragging' : ''}`}
                      ref={(node) => {
                        panelRefs.current[testId] = node
                      }}
                      onDragOver={(e) => {
                        e.preventDefault()
                        e.dataTransfer.dropEffect = 'move'
                      }}
                      onDrop={(e) => {
                        e.preventDefault()
                        const from = Number(e.dataTransfer.getData('text/plain'))
                        reorderTests(Number.isFinite(from) ? from : dragIndex, index)
                        setDragIndex(null)
                      }}
                    >
                      <button
                        type="button"
                        className="result-accordion-head"
                        onClick={() => togglePanel(testId)}
                        aria-expanded={isOpen}
                      >
                        <span
                          className="result-drag-handle"
                          draggable
                          title="Drag to reorder"
                          aria-label={`Reorder ${entry.test.name}`}
                          onClick={(e) => e.stopPropagation()}
                          onDragStart={(e) => {
                            e.stopPropagation()
                            e.dataTransfer.effectAllowed = 'move'
                            e.dataTransfer.setData('text/plain', String(index))
                            setDragIndex(index)
                          }}
                          onDragEnd={() => setDragIndex(null)}
                        >
                          ⋮⋮
                        </span>
                        <span className="result-accordion-chevron" aria-hidden="true">
                          {isOpen ? '▾' : '▸'}
                        </span>
                        <span className="result-accordion-title">
                          <strong>{entry.test.name}</strong>
                          <span>
                            {entry.test.category_name} · ₹{entry.test.price}
                          </span>
                        </span>
                        <span className="result-accordion-fill">{filled}/{total} filled</span>
                      </button>

                      {isOpen ? (
                        <div className="result-accordion-body">
                          {isWidalTest(entry.test) ? (
                            <div className="widal-matrix-wrap">
                              <table className="widal-matrix">
                                <thead>
                                  <tr>
                                    <th className="widal-antigen" />
                                    {WIDAL_COLS.map((col) => (
                                      <th key={col}>{col}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {WIDAL_ROWS.map((row) => (
                                    <tr key={row}>
                                      <td className="widal-antigen"><strong>{row}</strong></td>
                                      {WIDAL_COLS.map((col) => {
                                        const r = (entry.results || []).find(
                                          (x) => x.name === widalCellName(row, col),
                                        )
                                        if (!r) {
                                          return <td key={col} className="widal-cell muted">*</td>
                                        }
                                        const current = values[r.id] ?? ''
                                        return (
                                          <td key={col} className="widal-cell">
                                            <button
                                              type="button"
                                              className={`widal-toggle result-input ${current === '+' ? 'pos' : ''} ${current === '-' ? 'neg' : ''}`}
                                              title="Click to cycle +, −, blank"
                                              disabled={busy}
                                              aria-label={`${row} ${col}`}
                                              onClick={() => {
                                                dirtyRef.current = true
                                                setError('')
                                                setValues((v) => ({
                                                  ...v,
                                                  [r.id]: cycleAgglutination(v[r.id]),
                                                }))
                                              }}
                                            >
                                              {current || '*'}
                                            </button>
                                          </td>
                                        )
                                      })}
                                    </tr>
                                  ))}
                                  <tr className="widal-result-row">
                                    <td className="widal-antigen"><strong>RESULT</strong></td>
                                    <td colSpan={WIDAL_COLS.length}>
                                      {(() => {
                                        const r = (entry.results || []).find((x) => x.name === WIDAL_RESULT)
                                        if (!r) return <span className="muted">RESULT parameter missing — re-seed / refresh test</span>
                                        const current = values[r.id] ?? ''
                                        return (
                                          <input
                                            className="field-input result-input widal-result-input"
                                            value={current}
                                            disabled={busy}
                                            placeholder="e.g. NEGATIVE / POSITIVE"
                                            onChange={(e) => {
                                              dirtyRef.current = true
                                              setError('')
                                              setValues((v) => ({ ...v, [r.id]: e.target.value }))
                                            }}
                                            onKeyDown={(e) => {
                                              if (e.key !== 'Enter') return
                                              e.preventDefault()
                                              focusNextResultInput(e.currentTarget)
                                            }}
                                          />
                                        )
                                      })()}
                                    </td>
                                  </tr>
                                </tbody>
                              </table>
                              <p className="widal-hint">Click a cell to cycle + / − / blank, or type a value. Enter the overall RESULT below.</p>
                            </div>
                          ) : (
                            <div className="table-wrap">
                              <table className="data">
                                <thead>
                                  <tr>
                                    <th>Parameter</th>
                                    <th>Result</th>
                                    <th>Unit</th>
                                    <th className="range-cell">Range</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {(entry.results || []).map((r) => {
                                    const current = values[r.id] ?? ''
                                    const rangeState = evaluateResultRange(current, r.reference_range)
                                    const outClass = rangeState === 'high' || rangeState === 'low' ? 'result-out-range' : ''
                                    return (
                                      <tr key={r.id}>
                                        <td><strong>{r.name}</strong></td>
                                        <td>
                                          <div className="result-value-wrap">
                                            <input
                                              className={[
                                                'field-input',
                                                'result-input',
                                                autofilledIds.has(r.id) || autofilledIds.has(String(r.id))
                                                  ? 'result-autofilled'
                                                  : '',
                                                !autofilledIds.has(r.id) && !autofilledIds.has(String(r.id)) && rangeState === 'in'
                                                  ? 'result-in-range'
                                                  : '',
                                                !autofilledIds.has(r.id) && !autofilledIds.has(String(r.id)) && outClass
                                                  ? outClass
                                                  : '',
                                              ].filter(Boolean).join(' ')}
                                              value={current}
                                              inputMode="decimal"
                                              onChange={(e) => {
                                                dirtyRef.current = true
                                                setError('')
                                                const cleaned = bareNumericResult(e.target.value).replace(/,/g, '')
                                                let next = e.target.value
                                                if (cleaned === '' || cleaned === '-' || /^-?\d+\.$/.test(cleaned)) {
                                                  next = cleaned
                                                } else if (/^-?\d+(\.\d+)?$/.test(cleaned)) {
                                                  next = formatIndianNumber(cleaned)
                                                }
                                                applyResultChange(entry.results, r.id, next)
                                              }}
                                              onBlur={(e) => {
                                                const formatted = formatIndianNumber(bareNumericResult(e.target.value))
                                                dirtyRef.current = true
                                                applyResultChange(entry.results, r.id, formatted)
                                              }}
                                              onKeyDown={(e) => {
                                                if (e.key !== 'Enter') return
                                                e.preventDefault()
                                                const formatted = formatIndianNumber(bareNumericResult(e.currentTarget.value))
                                                dirtyRef.current = true
                                                applyResultChange(entry.results, r.id, formatted)
                                                focusNextResultInput(e.currentTarget)
                                              }}
                                              placeholder="Enter result"
                                            />
                                            {!autofilledIds.has(r.id) && !autofilledIds.has(String(r.id)) && rangeState === 'in' ? (
                                              <span className="result-flag result-flag-ok" title="Within range">✓</span>
                                            ) : null}
                                            {!autofilledIds.has(r.id) && !autofilledIds.has(String(r.id)) && (rangeState === 'high' || rangeState === 'low') ? (
                                              <span
                                                className="result-flag result-flag-bad"
                                                title={rangeState === 'high' ? 'Above range' : 'Below range'}
                                              >
                                                ✖
                                              </span>
                                            ) : null}
                                          </div>
                                        </td>
                                        <td>{r.unit || '—'}</td>
                                        <td className="range-cell">{r.reference_range || '—'}</td>
                                      </tr>
                                    )
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}
                          <div className="result-accordion-actions">
                            <button
                              className="btn btn-danger btn-sm"
                              type="button"
                              disabled={busy}
                              onClick={() => removeTest(testId)}
                            >
                              Remove test
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            )}

          </section>
        </div>
      </div>
    </div>,
    document.body,
  )
}
