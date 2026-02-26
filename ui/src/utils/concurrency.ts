export async function mapWithConcurrency<T, R>(
	items: T[],
	limit: number,
	worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	if (items.length === 0) return [];
	const concurrency = Math.max(1, Math.min(limit, items.length));
	const results: R[] = new Array(items.length);
	let cursor = 0;

	const runner = async () => {
		while (true) {
			const idx = cursor;
			cursor += 1;
			if (idx >= items.length) return;
			results[idx] = await worker(items[idx], idx);
		}
	};

	await Promise.all(Array.from({ length: concurrency }, () => runner()));

	return results;
}
