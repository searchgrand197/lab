"""Widal Test matrix layout: antigens × dilutions + overall RESULT."""

LAYOUT = 'widal_matrix'

ROWS = [
    'SALMONELLA TYPHI O',
    'SALMONELLA TYPHI H',
    'SALMONELLA PARATYPHI (AH)',
    'SALMONELLA PARATYPHI (BH)',
]

COLS = ['1/20', '1/40', '1/80', '1/160', '1/320']

RESULT_NAME = 'RESULT'


def cell_name(row, col):
    return f'{row} @ {col}'


def matrix_parameters():
    """Seed tuples: (name, unit, reference_range)."""
    params = []
    for row in ROWS:
        for col in COLS:
            params.append((cell_name(row, col), '', ''))
    params.append((RESULT_NAME, '', 'NEGATIVE'))
    return params


def is_widal_test(test):
    layout = getattr(test, 'layout', '') or ''
    if layout == LAYOUT:
        return True
    name = (getattr(test, 'name', '') or '').strip().lower()
    return name == 'widal test' or name == 'widal'


def results_by_name(results):
    """Map parameter name → result object or dict with .name / ['name']."""
    out = {}
    for r in results:
        name = getattr(r, 'name', None)
        if name is None and hasattr(r, 'parameter'):
            name = r.parameter.name
        if isinstance(r, dict):
            name = r.get('name')
        if name:
            out[name] = r
    return out
