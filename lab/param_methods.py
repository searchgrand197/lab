"""Default methodology text shown under parameter names on printed reports."""

from __future__ import annotations

import re


def _norm(name: str) -> str:
    return re.sub(r'[^a-z0-9]+', ' ', (name or '').lower()).strip()


# Exact / near-exact normalized name → method (matches typical CBC printouts).
_EXACT = {
    'haemoglobin female': 'Cynmeth Photometric Measurement',
    'hemoglobin female': 'Cynmeth Photometric Measurement',
    'haemoglobin male': 'Cynmeth Photometric Measurement',
    'hemoglobin male': 'Cynmeth Photometric Measurement',
    'haemoglobin hb': 'Cynmeth Photometric Measurement',
    'haemoglobin': 'Cynmeth Photometric Measurement',
    'hemoglobin': 'Cynmeth Photometric Measurement',
    'hemoglobin hb': 'Cynmeth Photometric Measurement',
    'total leucocytes wbc count': 'Whole Blood EDTA Flow Cytometry',
    'total leucocyte count': 'Whole Blood EDTA Flow Cytometry',
    'total leukocyte count': 'Whole Blood EDTA Flow Cytometry',
    'tlc': 'Whole Blood EDTA Flow Cytometry',
    'wbc count': 'Whole Blood EDTA Flow Cytometry',
    'neutrophils': 'VCSn Technology',
    'lymphocytes': 'VCSn Technology',
    'monocytes': 'VCSn Technology',
    'eosinophils': 'VCSn Technology',
    'basophils': 'VCSn Technology',
    'red blood cells rbc count': 'Impedance Measurement',
    'rbc count': 'Impedance Measurement',
    'packed cell volume pcv hematocrit': 'Calculated',
    'p c v hematocrit': 'Calculated',
    'mean cell volume mcv': 'Calculated',
    'mcv': 'Calculated',
    'mean cell haemoglobin mch': 'Calculated',
    'mean cell hemoglobin mch': 'Calculated',
    'mch': 'Calculated',
    'mean corpuscular hb concn mchc': 'Calculated',
    'mchc': 'Calculated',
    'red cell distribution width rdw cv': 'Impedance Measurement',
    'red cell distribution width rdw sd': 'Impedance Measurement',
    'absolute neutrophil count': 'Calculated',
    'absolute lymphocyte count': 'Calculated',
    'absolute monocyte count': 'Calculated',
    'absolute eosinophil count': 'Calculated',
    'absolute basophils count': 'Calculated',
    'platelet count': 'Impedance Measurement',
    'platelets count': 'Impedance Measurement',
    'platelet large cell coefficient p lcc': 'Calculated',
    'mean platelet volume mpv': 'Impedance Measurement',
    'pct': 'Calculated',
    'pdw cv': 'Impedance Measurement',
    'e s r': 'Westergren Method',
}


def default_method_for_param(name: str) -> str:
    """Best-effort methodology for a parameter name when none is stored."""
    key = _norm(name)
    if key in _EXACT:
        return _EXACT[key]
    # Soft matches for gender-specific haemoglobin / common aliases.
    if 'haemoglobin' in key or 'hemoglobin' in key:
        if 'foetal' in key or 'fetal' in key:
            return ''
        return 'Cynmeth Photometric Measurement'
    if 'neutrophil' in key or 'lymphocyte' in key or 'monocyte' in key:
        if 'absolute' in key:
            return 'Calculated'
        return 'VCSn Technology'
    if 'eosinophil' in key or 'basophil' in key:
        if 'absolute' in key:
            return 'Calculated'
        return 'VCSn Technology'
    if 'leucocyte' in key or 'leukocyte' in key or key in ('tlc', 'wbc'):
        return 'Whole Blood EDTA Flow Cytometry'
    return ''


def resolve_param_method(param) -> str:
    stored = (getattr(param, 'method', None) or '').strip()
    if stored:
        return stored
    return default_method_for_param(getattr(param, 'name', '') or '')


def unpack_param_tuple(item):
    """Support (name, unit, range) or (name, unit, range, method) catalog rows."""
    name = item[0]
    unit = item[1] if len(item) > 1 else ''
    reference_range = item[2] if len(item) > 2 else ''
    method = item[3] if len(item) > 3 else ''
    if not method:
        method = default_method_for_param(name)
    return name, unit or '', reference_range or '', method or ''
