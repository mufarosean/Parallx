// uniqueName.ts — a name that does not collide in a folder, for a copy:
// "file.txt", then "file - Copy.txt", then "file - Copy 2.txt".

/**
 * Generate a unique name in a directory if the target name already exists.
 * For copy operations: "file.txt" → "file - Copy.txt" → "file - Copy 2.txt" etc.
 */
export async function getUniqueDestName(
  destFolder: string,
  name: string,
  electronFs: any,
): Promise<string> {
  // Check if the name conflicts
  const destPath = destFolder + '/' + name;
  const exists = await electronFs.stat(destPath).then(
    (r: any) => !r?.error,
    () => false,
  );
  if (!exists) return name;

  // Split into stem and extension
  const dotIdx = name.lastIndexOf('.');
  const hasDot = dotIdx > 0;
  const stem = hasDot ? name.slice(0, dotIdx) : name;
  const ext = hasDot ? name.slice(dotIdx) : '';

  // Try "stem - Copy.ext", "stem - Copy 2.ext", etc.
  let candidate = `${stem} - Copy${ext}`;
  let checkPath = destFolder + '/' + candidate;
  let checkExists = await electronFs.stat(checkPath).then(
    (r: any) => !r?.error,
    () => false,
  );
  if (!checkExists) return candidate;

  for (let i = 2; i < 100; i++) {
    candidate = `${stem} - Copy ${i}${ext}`;
    checkPath = destFolder + '/' + candidate;
    checkExists = await electronFs.stat(checkPath).then(
      (r: any) => !r?.error,
      () => false,
    );
    if (!checkExists) return candidate;
  }

  // Fallback: timestamp
  return `${stem} - Copy ${Date.now()}${ext}`;
}
