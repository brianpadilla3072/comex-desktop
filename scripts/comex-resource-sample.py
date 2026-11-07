#!/usr/bin/env python3
"""Read-only Linux process-tree CPU/RAM sampler. 100% CPU = one logical core."""
import argparse
import json
import os
from pathlib import Path
import statistics
import time


def processes():
    result = {}
    for entry in Path('/proc').iterdir():
        if not entry.name.isdecimal():
            continue
        try:
            text = (entry / 'stat').read_text()
            fields = text[text.rfind(')') + 2:].split()
            result[int(entry.name)] = {'ppid': int(fields[1]), 'pgrp': int(fields[2]), 'ticks': int(fields[11]) + int(fields[12]), 'start': int(fields[19]), 'rssMiB': int(fields[21]) * os.sysconf('SC_PAGE_SIZE') / 1048576}
        except (OSError, ValueError, IndexError):
            continue
    return result


def category(pid, roots):
    try:
        args = Path(f'/proc/{pid}/cmdline').read_bytes().decode(errors='replace').split('\0')
        executable = Path(os.readlink(f'/proc/{pid}/exe')).name
        command = ' '.join(args)
        if '--type=renderer' in command or '--renderer-client-id=' in command:
            return 'renderer'
        if '--type=gpu-process' in command or '--gpu-preferences=' in command:
            return 'gpu'
        if '--type=' in command or '--utility-sub-type=' in command:
            return 'browser-utility'
        if 'opencode' in executable:
            return 'agent-engine'
        if pid in roots:
            return 'app-root'
        return executable
    except OSError:
        return 'exited'


def host_cpu():
    values = list(map(int, Path('/proc/stat').read_text().splitlines()[0].split()[1:]))
    # guest times are already included in user/nice.
    return sum(values[:8]), values[3] + values[4]


def sample_tree(roots, duration, interval):
    ticks_per_second = os.sysconf('SC_CLK_TCK')
    known = {}
    previous = {}
    samples = []
    start = time.monotonic()
    last_time = start
    last_host = host_cpu()
    while True:
        now = time.monotonic()
        table = processes()
        for pid in roots:
            if pid in table and pid not in known:
                known[pid] = table[pid]['start']
        selected = {pid for pid, identity in known.items() if pid in table and table[pid]['start'] == identity}
        isolated_groups = {pid for pid in roots if pid in selected and table[pid]['pgrp'] == pid}
        selected.update(pid for pid, data in table.items() if data['pgrp'] in isolated_groups)
        while True:
            children = {pid for pid, data in table.items() if data['ppid'] in selected}
            if children <= selected:
                break
            selected.update(children)
        for pid in selected:
            known[pid] = table[pid]['start']
        by_category = {}
        elapsed = now - last_time
        for pid in selected:
            data = table[pid]
            group = by_category.setdefault(category(pid, roots), {'processes': 0, 'rssMiB': 0, 'pssMiB': 0, 'pssUnavailable': 0, 'cpuPercentOneCore': 0})
            group['processes'] += 1
            group['rssMiB'] += data['rssMiB']
            try:
                lines = Path(f'/proc/{pid}/smaps_rollup').read_text().splitlines()
                group['pssMiB'] += next(int(line.split()[1]) for line in lines if line.startswith('Pss:')) / 1024
            except (OSError, StopIteration, ValueError):
                group['pssUnavailable'] += 1
            before = previous.get(pid)
            if before and before['start'] == data['start'] and elapsed > 0:
                group['cpuPercentOneCore'] += max(0, data['ticks'] - before['ticks']) / ticks_per_second / elapsed * 100
        host = host_cpu()
        host_total = host[0] - last_host[0]
        samples.append({'elapsedSeconds': round(now - start, 3), 'processCount': len(selected), 'groups': by_category,
                        'rssMiB': sum(g['rssMiB'] for g in by_category.values()), 'pssMiB': sum(g['pssMiB'] for g in by_category.values()),
                        'pssUnavailable': sum(g['pssUnavailable'] for g in by_category.values()),
                        'cpuPercentOneCore': sum(g['cpuPercentOneCore'] for g in by_category.values()) if samples else None,
                        'hostCpuPercent': (1 - (host[1] - last_host[1]) / host_total) * 100 if host_total else None})
        previous = {pid: table[pid] for pid in selected}
        last_time, last_host = now, host
        if now - start >= duration:
            break
        time.sleep(min(interval, max(0, duration - (time.monotonic() - start))))
    return samples


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pid', action='append', type=int, required=True)
    parser.add_argument('--seconds', type=float, default=30)
    parser.add_argument('--interval', type=float, default=1)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    if args.seconds <= 0 or args.interval <= 0 or any(pid <= 0 for pid in args.pid):
        parser.error('PIDs, duration and interval must be positive')
    if args.out.exists():
        parser.error('Output exists; choose a fresh report path')
    table = processes()
    if any(pid not in table for pid in args.pid):
        parser.error('A root process does not exist')
    samples = sample_tree(set(args.pid), args.seconds, args.interval)
    cpu = [s['cpuPercentOneCore'] for s in samples if s['cpuPercentOneCore'] is not None]
    report = {'scope': 'Linux process tree; excludes sampler and unrelated applications', 'logicalCores': os.cpu_count(),
              'cpuConvention': '100% = one logical core; host-normalized value divides by logicalCores',
              'ramConvention': 'MiB; PSS apportions shared pages; summed RSS may double-count shared memory',
              'durationSeconds': samples[-1]['elapsedSeconds'], 'summary': {'pssMeanMiB': statistics.mean(s['pssMiB'] for s in samples),
              'pssPeakMiB': max(s['pssMiB'] for s in samples), 'rssMeanMiB': statistics.mean(s['rssMiB'] for s in samples),
              'cpuMeanPercentOneCore': statistics.mean(cpu), 'cpuPeakPercentOneCore': max(cpu),
              'hostCpuMeanPercent': statistics.mean(s['hostCpuPercent'] for s in samples if s['hostCpuPercent'] is not None),
              'pssUnavailableSamples': sum(bool(s['pssUnavailable']) for s in samples)}, 'samples': samples}
    categories = set().union(*(sample['groups'] for sample in samples))
    report['perCategory'] = {name: {
        'pssMeanMiB': statistics.mean(sample['groups'].get(name, {}).get('pssMiB', 0) for sample in samples),
        'rssMeanMiB': statistics.mean(sample['groups'].get(name, {}).get('rssMiB', 0) for sample in samples),
        'cpuMeanPercentOneCore': statistics.mean(sample['groups'].get(name, {}).get('cpuPercentOneCore', 0) for sample in samples[1:]),
        'peakProcesses': max(sample['groups'].get(name, {}).get('processes', 0) for sample in samples)
    } for name in sorted(categories)}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report['summary'], indent=2))

if __name__ == '__main__':
    main()
