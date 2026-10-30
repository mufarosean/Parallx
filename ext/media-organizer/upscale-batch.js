// upscale-batch.js — the library's Upscale (Section 38B of main.js), the part
// that runs the engine. Every photo of a batch goes through one engine run,
// so the model loads once for the batch, not once a photo
// (enhance-engine.js, moEnhanceRunMany). A single photo goes through
// moEnhanceRun, as the editor's Enhance does.
//
// Each result is a new PNG beside its original, under a name no file has and
// no other photo of the batch takes; the original is only read. The work
// folder (pieces, converted copies) is removed however the run ends, and each
// photo's pieces as soon as that photo is finished. Everything outside comes
// in through `deps`, so tests/unit/moUpscaleBatch.test.ts runs it without
// the engine.

/** "photo.jpg" -> "photo-2x.png"; n > 1 adds " (n)" before the extension. */
export function moUpscaleOutputName(basename, scale, n = 1) {
  const dot = basename.lastIndexOf('.');
  const stem = dot > 0 ? basename.slice(0, dot) : basename;
  return `${stem}-${scale}x${n > 1 ? ` (${n})` : ''}.png`;
}

/** A free name beside `srcPath`: no file there (`exists`) and not in `taken`. Null after 99 tries. */
export async function moUpscaleUniqueOutputPath(srcPath, scale, exists, taken = null) {
  const sep = srcPath.includes('\\') ? '\\' : '/';
  const dir = srcPath.slice(0, srcPath.lastIndexOf(sep));
  const base = srcPath.slice(srcPath.lastIndexOf(sep) + 1);
  for (let n = 1; n < 100; n++) {
    const candidate = dir + sep + moUpscaleOutputName(base, scale, n);
    if (taken && taken.has(candidate)) continue;
    if (!(await exists(candidate))) return candidate;
  }
  return null;
}

const messageOf = (err) => (err && err.message) || String(err);

/**
 * Upscale `targets` ({ path, basename, ... }) `scale` times. deps:
 *   exists(path), readsDirectly(path): can the engine read it as it is,
 *   convert(src, png): write a PNG the engine reads (throws on failure),
 *   withTemp(work): run work(dir) in a fresh work folder, removed afterwards,
 *   dispose(paths): remove temporary files and folders the user's way,
 *   runOne(input, output, scale, onProgress, opts): moEnhanceRun,
 *   runMany(jobs, scale, onProgress, opts): moEnhanceRunMany,
 *   onRunId(id), isCancelled(),
 *   onProgress({ target, label, fraction }): fraction over the whole batch,
 *   finish(target, output): bring a written result into the library.
 * finish runs once for each written photo, one at a time, while the engine
 * goes on with the rest. Resolves { written, failures: [{ target, message }],
 * stopped }; photos left when it is stopped are neither written nor failed.
 */
export async function moUpscaleBatch(targets, scale, deps) {
  const failures = [];
  let written = 0;
  let stopped = false;
  let finishing = Promise.resolve();
  const fail = (job, message) => { job.settled = true; failures.push({ target: job.target, message }); };
  // A written result: into the library, in the order they come.
  const keep = (job) => {
    job.settled = true;
    finishing = finishing.then(async () => {
      if (!(await deps.exists(job.output))) { failures.push({ target: job.target, message: 'no picture was written' }); return; }
      job.written = true;
      try { await deps.finish(job.target, job.output); written++; } catch (err) { failures.push({ target: job.target, message: messageOf(err) }); }
    });
  };

  const jobs = [];
  const taken = new Set();
  for (const target of targets) {
    const output = await moUpscaleUniqueOutputPath(target.path, scale, deps.exists, taken);
    if (!output) { failures.push({ target, message: 'no free output name' }); continue; }
    taken.add(output);
    jobs.push({ target, input: target.path, output, settled: false, written: false });
  }

  await deps.withTemp(async (dir) => {
    const sep = dir.includes('\\') ? '\\' : '/';
    // What the engine cannot read (HEIC, a RAW preview) becomes a PNG in the work folder first.
    const ready = [];
    for (const [i, job] of jobs.entries()) {
      if (deps.isCancelled()) { stopped = true; return; }
      if (!deps.readsDirectly(job.input)) {
        deps.onProgress({ target: job.target, label: 'Converting to PNG', fraction: 0 });
        const png = `${dir}${sep}source-${i}.png`;
        try { await deps.convert(job.input, png); job.input = png; } catch (err) { fail(job, messageOf(err)); continue; }
      }
      ready.push(job);
    }
    if (!ready.length) return;
    if (deps.isCancelled()) { stopped = true; return; }

    if (ready.length === 1) {
      const job = ready[0];
      try {
        await deps.runOne(job.input, job.output, scale, (p) => deps.onProgress({ target: job.target, label: p.label, fraction: p.fraction }), { workDir: dir, onRunId: deps.onRunId });
      } catch (err) {
        if (err && err.stopped) stopped = true; else fail(job, messageOf(err));
        return;
      }
      keep(job);
      return;
    }

    const disposing = [];
    let r;
    try {
      r = await deps.runMany(ready.map((j) => ({ input: j.input, output: j.output })), scale,
        (p) => { const job = ready[p.index]; if (job) deps.onProgress({ target: job.target, label: p.label, fraction: p.fraction }); },
        {
          workDir: dir,
          onRunId: deps.onRunId,
          onPhoto: (photo) => {
            const job = ready[photo.index];
            if (!job || job.settled) return;
            // Its pieces are done with: they go now, not at the end of a long batch.
            if (photo.work) disposing.push(Promise.resolve(deps.dispose([photo.work])).catch(() => {}));
            if (photo.ok) keep(job); else fail(job, photo.error);
          },
        });
    } catch (err) {
      r = { ok: false, stopped: false, error: messageOf(err) };
    }
    if (r.stopped) stopped = true;
    for (const job of ready) {
      if (job.settled) continue;
      // A result under its real name is whole (the engine renames it there when it is written).
      if (await deps.exists(job.output)) keep(job);
      else if (!r.stopped) fail(job, r.error || 'no picture was written');
    }
    await finishing;
    // A result cut off while it was being written, under its ".part" name.
    const unfinished = ready.filter((j) => !j.written).map((j) => `${j.output}.part`);
    if (unfinished.length) disposing.push(Promise.resolve(deps.dispose(unfinished)).catch(() => {}));
    await Promise.all(disposing);
  });
  await finishing;
  return { written, failures, stopped };
}
