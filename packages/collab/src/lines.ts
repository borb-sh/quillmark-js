// The longest common run of two sequences, and the runs that differ between them: the line
// diff behind the writer's splices, the hunks a change reports and the ranges a conflict compares.

/** The longest common subsequence of `a` and `b`, as index pairs in order. */
export function commonRun(a: readonly string[], b: readonly string[]): [number, number][] {
	let p = 0;
	while (p < a.length && p < b.length && a[p] === b[p]) p++;
	let s = 0;
	while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
	const n = a.length - p - s;
	const m = b.length - p - s;
	const len = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
	for (let i = n - 1; i >= 0; i--)
		for (let j = m - 1; j >= 0; j--)
			len[i][j] =
				a[p + i] === b[p + j] ? len[i + 1][j + 1] + 1 : Math.max(len[i + 1][j], len[i][j + 1]);
	const out: [number, number][] = [];
	for (let i = 0; i < p; i++) out.push([i, i]);
	for (let i = 0, j = 0; i < n && j < m;) {
		if (a[p + i] === b[p + j]) out.push([p + i++, p + j++]);
		else if (len[i + 1][j] >= len[i][j + 1]) i++;
		else j++;
	}
	for (let k = 0; k < s; k++) out.push([a.length - s + k, b.length - s + k]);
	return out;
}

/** A run of `a`, `[from, to)`, that `b` holds as `[at, end)` instead. */
export interface Run {
	from: number;
	to: number;
	at: number;
	end: number;
}

/** The runs between the common ones: where `a` and `b` differ, in order. */
export function changedRuns(a: readonly string[], b: readonly string[]): Run[] {
	const out: Run[] = [];
	let i = 0;
	let j = 0;
	for (const [x, y] of [...commonRun(a, b), [a.length, b.length]]) {
		if (x > i || y > j) out.push({ from: i, to: x, at: j, end: y });
		i = x + 1;
		j = y + 1;
	}
	return out;
}

/** Whether two runs of one base meet: they share a line, or both insert at one place, or one
 *  inserts inside the other. */
export function meet(x: Run, y: Run): boolean {
	if (Math.max(x.from, y.from) < Math.min(x.to, y.to)) return true;
	if (x.from === x.to && y.from === y.to) return x.from === y.from;
	if (x.from === x.to) return y.from < x.from && x.from < y.to;
	if (y.from === y.to) return x.from < y.from && y.from < x.to;
	return false;
}
