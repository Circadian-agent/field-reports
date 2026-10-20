"""Dependency-free bid proof. Minutes are local wall time on a single dated shift.
Travel matrices in the demo are SYNTHETIC, not measured road times.
"""
from datetime import date, timedelta
import math


def travel(matrix, origin, destination):
    value = matrix.get(origin, {}).get(destination)
    if value is None or isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
        return None
    return value


def schedule(crew, jobs, matrix):
    """Earliest feasible schedule, requiring service completion within the window."""
    now, location, drive, stops = crew['start'], crew['depot'], 0, []
    for job in jobs:
        if not set(job['skills']).issubset(crew['skills']):
            return None
        leg = travel(matrix, location, job['node'])
        if leg is None:
            return None
        start = max(now + leg, job['window'][0])
        end = start + job['duration']
        if end > min(crew['end'], job['window'][1]):
            return None
        stops.append({'job': job['id'], 'node': job['node'], 'start': start, 'end': end})
        now, location, drive = end, job['node'], drive + leg
    home = travel(matrix, location, crew['depot'])
    if home is None or now + home > crew['end']:
        return None
    return {'stops': stops, 'drive_minutes': drive + home, 'return_at': now + home}


def validate(crews, jobs):
    for name, rows in [('crew', crews), ('job', jobs)]:
        ids = [r['id'] for r in rows]
        if len(ids) != len(set(ids)):
            raise ValueError(f'duplicate {name} ID')
    for crew in crews:
        date.fromisoformat(crew['date'])
        if not 0 <= crew['start'] < crew['end'] <= 1440:
            raise ValueError('invalid shift')
    for job in jobs:
        date.fromisoformat(job['date'])
        if not 0 <= job['window'][0] < job['window'][1] <= 1440 or job['duration'] <= 0 or not math.isfinite(job['duration']):
            raise ValueError('invalid job duration or window')


def plan(crews, jobs, matrix, minimum_gap=30):
    validate(crews, jobs)
    if minimum_gap <= 0:
        raise ValueError('minimum gap must be positive')
    routes = {c['id']: [] for c in crews}
    unassigned = []
    for job in jobs:
        choices = []
        eligible = [c for c in crews if c['date'] == job['date'] and set(job['skills']).issubset(c['skills'])]
        for crew in eligible:
            current = routes[crew['id']]
            before = schedule(crew, current, matrix)
            if before is None:
                continue
            for i in range(len(current) + 1):
                candidate = current[:i] + [job] + current[i:]
                result = schedule(crew, candidate, matrix)
                if result is not None:
                    choices.append((result['drive_minutes'] - before['drive_minutes'], crew['id'], i, candidate))
        if not choices:
            unassigned.append({'job': job['id'], 'reason': 'no crew with required skills on date' if not eligible else 'no feasible insertion: travel, windows or shift; heuristic, not proof of infeasibility'})
            continue
        _, crew_id, _, best = min(choices, key=lambda row: row[:3])
        routes[crew_id] = best
    result = {'routes': [], 'unassigned': unassigned, 'gaps': [], 'matrix_source': 'caller supplied; demo uses synthetic directed minutes', 'method': 'greedy feasible insertion, no global optimum guarantee'}
    for crew in crews:
        ordered = routes[crew['id']]
        route = schedule(crew, ordered, matrix)
        if route is None:
            raise ValueError('crew depot needs a reachable self entry, even on an empty day')
        selected = {j['id'] for j in ordered}
        baseline = schedule(crew, [j for j in jobs if j['id'] in selected], matrix)
        comparison = {'scope': 'same assigned jobs and crew, original input order', 'input_order_minutes': baseline['drive_minutes'] if baseline else None}
        comparison['explanation'] = ('input order violates constraints; numerical comparison unavailable' if baseline is None else 'drive time reduced' if route['drive_minutes'] < baseline['drive_minutes'] else 'no improvement found by insertion heuristic')
        result['routes'].append({'crew': crew['id'], 'date': crew['date'], **route, 'comparison': comparison})
        left_time, left_node = crew['start'], crew['depot']
        right_stops = route['stops'] + [{'start': crew['end'], 'node': crew['depot']}]
        for index, right in enumerate(right_stops):
            leg = travel(matrix, left_node, right['node'])
            slack = right['start'] - left_time - leg
            if slack >= minimum_gap:
                result['gaps'].append({'crew': crew['id'], 'date': crew['date'], 'index': index, 'from_time': left_time, 'to_time': right['start'], 'from_node': left_node, 'to_node': right['node'], 'direct_drive': leg, 'usable_minutes_before_detour': slack})
            if 'end' in right:
                left_time, left_node = right['end'], right['node']
    return result


def customer_groups(customers):
    """Conservative connected-component identity match by ID or normalized email.
    Duplicates require human resolution; opt-out propagates across the component.
    """
    parents = list(range(len(customers)))
    def root(i):
        while parents[i] != i:
            parents[i] = parents[parents[i]]
            i = parents[i]
        return i
    seen = {}
    for i, c in enumerate(customers):
        keys = [('id', c['id'])]
        if c.get('email', '').strip():
            keys.append(('email', c['email'].strip().casefold()))
        for key in keys:
            if key in seen:
                parents[root(i)] = root(seen[key])
            seen[key] = i
    groups = {}
    for i, c in enumerate(customers):
        groups.setdefault(root(i), []).append(c)
    return list(groups.values())


def due_evidence(customer, on_date):
    try:
        if customer.get('due_date'):
            due = date.fromisoformat(customer['due_date'])
            evidence = 'buyer supplied due date ' + customer['due_date']
        elif customer.get('last_service') and customer.get('interval_days'):
            interval = customer['interval_days']
            if not isinstance(interval, int) or isinstance(interval, bool) or interval <= 0:
                return None
            last = date.fromisoformat(customer['last_service'])
            if last > on_date:
                return None
            due = last + timedelta(days=interval)
            evidence = f'buyer supplied {interval}-day plan after {last.isoformat()}'
        else:
            return None
        return ((on_date - due).days, evidence)
    except (ValueError, OverflowError, TypeError):
        return None


def backfill(report, crews, customers, matrix):
    by_id = {c['id']: c for c in crews}
    clean, excluded = [], []
    for group in customer_groups(customers):
        reason = None
        if any(c.get('do_not_contact') is not False or c.get('opted_out') is not False for c in group):
            reason = 'opt-out or unknown contact permission across matched records'
        elif len(group) > 1:
            reason = 'duplicate identity requires buyer review'
        elif not group[0].get('address_validated') or not group[0].get('node'):
            reason = 'address needs correction or validation'
        if reason:
            excluded.extend({'customer': c['id'], 'reason': reason} for c in group)
        else:
            clean.append(group[0])
    suggestions = []
    for gap in report['gaps']:
        crew = by_id[gap['crew']]
        day = date.fromisoformat(gap['date'])
        alternatives = []
        for c in clean:
            due = due_evidence(c, day)
            if due is None or due[0] < 0 or not set(c['skills']).issubset(crew['skills']):
                continue
            duration = c.get('duration')
            if isinstance(duration, bool) or not isinstance(duration, (int, float)) or not math.isfinite(duration) or duration <= 0:
                continue
            there, onward = travel(matrix, gap['from_node'], c['node']), travel(matrix, c['node'], gap['to_node'])
            if there is None or onward is None:
                continue
            window = c.get('window', [crew['start'], crew['end']])
            start = max(gap['from_time'] + there, window[0])
            end = start + duration
            if end > window[1] or end + onward > gap['to_time']:
                continue
            clock = lambda minute: f'{int(minute)//60:02d}:{int(minute)%60:02d}'
            alternatives.append({'customer': c['id'], 'node': c['node'], 'start': start, 'end': end, 'overdue_days': due[0], 'due_reason': due[1], 'additional_drive_minutes': there + onward - gap['direct_drive'], 'draft': f'Hello, we have a possible service slot on {gap["date"]} at {clock(start)}. Would that suit you? Please confirm before we book it.'})
        alternatives.sort(key=lambda c: (-c['overdue_days'], c['additional_drive_minutes'], c['customer']))
        suggestions.append({'crew': gap['crew'], 'date': gap['date'], 'gap_index': gap['index'], 'alternatives': alternatives, 'warning': 'Each alternative fits independently. Selecting one requires replanning all remaining suggestions.'})
    needs_review = [{'customer': c['id'], 'reason': 'no usable explicit due evidence for any planning date'} for c in clean if not any(due_evidence(c, date.fromisoformat(crew['date'])) for crew in crews)]
    return {'suggestions': suggestions, 'excluded': excluded, 'needs_review': needs_review, 'messages_sent': 0}
